/**
 * Builds the Vercel deployment folder (vercel-out/):
 *   1. exports a snapshot of the indexed history from the running local ArcPulse server,
 *   2. bundles the shared API code into one Node function (no database, no indexer),
 *   3. copies the built interface (dist/) next to it.
 * Run `bun run build` and `bun run server` first.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '../..')
const LOCAL = process.env.ARCPULSE_LOCAL_API ?? 'http://localhost:3001'
const RANGES = ['24h', '7d', '30d', '90d']
const OUT = join(ROOT, 'vercel-out')

async function get<T>(path: string): Promise<{ meta: Record<string, unknown>; data: T }> {
  const res = await fetch(`${LOCAL}${path}`)
  if (!res.ok) throw new Error(`${path} returned ${res.status}. Is "bun run server" running?`)
  return (await res.json()) as { meta: Record<string, unknown>; data: T }
}

interface WhalePage {
  transfers: Array<{ raw: string; decimals: number } & Record<string, unknown>>
  nextCursor: string | null
}

async function exportSnapshot() {
  const health = (await get<{ indexer: Record<string, unknown> }>('/api/health')).data
  const analytics: Record<string, unknown> = {}
  const top: Record<string, unknown> = {}
  const usdcSenders: Record<string, unknown> = {}
  let headBlock: number | null = null
  for (const r of RANGES) {
    const a = await get<unknown>(`/api/analytics?range=${r}`)
    analytics[r] = a.data
    headBlock = (a.meta.headBlock as number | null) ?? headBlock
    top[r] = (await get<unknown>(`/api/contracts/top?range=${r}`)).data
    usdcSenders[r] = (await get<{ topSenders: unknown }>(`/api/usdc?range=${r}`)).data.topSenders
  }
  const whales: Array<Record<string, unknown>> = []
  let cursor = ''
  for (let i = 0; i < 40; i += 1) {
    const page = (await get<WhalePage>(`/api/whales?min=1000&range=90d&kind=all&limit=200${cursor}`)).data
    for (const t of page.transfers) whales.push({ ...t, usdc: Number(BigInt(t.raw) / 10n ** BigInt(t.decimals - 6)) / 1e6 })
    if (!page.nextCursor) break
    cursor = `&cursor=${page.nextCursor}`
  }
  const tokens = (await get<unknown>('/api/tokens/active')).data
  const { coverage } = health.indexer as { coverage: Record<string, number> }
  const snapshot = { at: new Date().toISOString(), headBlock, coverage, indexer: null, analytics, top, usdcSenders, whales, tokens }
  writeFileSync(join(ROOT, 'server/vercel/snapshot.generated.json'), JSON.stringify(snapshot))
  console.log(`snapshot: ${whales.length} whale rows, coverage`, coverage)
}

await exportSnapshot()

const swap = (re: RegExp, to: string) => ({
  name: `swap-${to}`,
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: re }, (args) => (args.importer.includes('/server/') && !args.importer.includes('/server/vercel/') ? { path: join(ROOT, to) } : undefined))
  },
})

const built = await Bun.build({
  entrypoints: [join(ROOT, 'server/vercel/entry.ts')],
  target: 'node',
  format: 'cjs',
  minify: true,
  plugins: [swap(/^\.\/db$/, 'server/vercel/db-shim.ts'), swap(/^\.\/queries$/, 'server/vercel/queries-snapshot.ts'), swap(/^\.\/indexer$/, 'server/vercel/indexer-stub.ts')],
})
if (!built.success) {
  for (const l of built.logs) console.error(l)
  throw new Error('Function bundle failed')
}
const code = await (built.outputs[0] as Bun.BuildArtifact).text()

if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('dist/ is missing. Run "bun run build" first.')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'api'), { recursive: true })
cpSync(join(ROOT, 'dist'), OUT, { recursive: true })
writeFileSync(join(OUT, 'api/index.js'), `${code}\nmodule.exports = module.exports.default || module.exports;\n`)
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ name: 'arcpulse', private: true }, null, 2))
writeFileSync(
  join(OUT, 'vercel.json'),
  JSON.stringify(
    {
      rewrites: [
        { source: '/api/:path*', destination: '/api/index?__p=:path*' },
        { source: '/((?!api/|assets/).*)', destination: '/index.html' },
      ],
      functions: { 'api/*.js': { maxDuration: 30 } },
      headers: [{ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }],
    },
    null,
    2,
  ),
)
console.log(`vercel-out ready (${(code.length / 1024).toFixed(0)} KB function, ${JSON.parse(readFileSync(join(ROOT, 'server/vercel/snapshot.generated.json'), 'utf8')).at})`)
