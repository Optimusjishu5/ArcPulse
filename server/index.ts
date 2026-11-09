/**
 * ArcPulse API + static host + indexer (single process, so the SQLite file has one owner).
 * Arc Mainnet only: every request path that touches chain data goes through the chain-verified RPC pool.
 */
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { AmountError } from '../src/onchain-money'
import { activeTokens, contractDetail, usdcOverview } from './contract'
import { headInfo, isAddress, isHash } from './chain'
import { CONFIG, ARC } from './env'
import { estimateTransfer, latestBlocks, latestTxs, networkSnapshot, txDetail } from './live'
import { info, recentErrors, redact, reportError } from './log'
import { analytics, topContracts, whales } from './queries'
import { indexerStatus, requestReindex, startIndexer, windowSeconds } from './indexer'
import { probeProviders, providerStatus, rpc, RpcError } from './rpc'
import { walletHoldings, walletSummary, walletTransfers } from './wallet'

const RANGES = ['24h', '7d', '30d', '90d']
const DIST = join(process.cwd(), 'dist')
const hits = new Map<string, { count: number; resetAt: number }>()

// Short response cache with in-flight de-duplication, so many viewers share one RPC/database read.
// Live endpoints are held for 2 seconds at most, indexed history for a few seconds more.
const TTL_MS: Record<string, number> = {
  '/api/blocks': 700,
  '/api/network': 1500,
  '/api/txs': 1500,
  '/api/whales': 2000,
  '/api/health': 8000,
  '/api/analytics': 15_000,
  '/api/usdc': 15_000,
  '/api/contracts/top': 30_000,
}
const respCache = new Map<string, { at: number; status: number; body: string }>()
const respPending = new Map<string, Promise<{ status: number; body: string }>>()

async function cachedJson(key: string, ttl: number, produce: () => Promise<Response>): Promise<Response> {
  const hit = respCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < ttl) return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  let pending = respPending.get(key)
  if (!pending) {
    pending = produce()
      .then(async (res) => {
        const body = await res.text()
        if (res.status === 200) respCache.set(key, { at: Date.now(), status: 200, body })
        if (respCache.size > 500) respCache.clear()
        return { status: res.status, body }
      })
      .finally(() => respPending.delete(key))
    respPending.set(key, pending)
  }
  const out = await pending
  return new Response(out.body, { status: out.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

const COMPRESSIBLE = /\.(js|css|html|svg|json|txt|map)$/
const gzCache = new Map<string, Uint8Array>()
const asBody = (u: Uint8Array): BodyInit => u as unknown as BodyInit

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })

/** Wraps a payload with the chain and freshness metadata every client must check before showing it as live. */
async function envelope(data: unknown, source: 'rpc' | 'indexer' | 'rpc+indexer') {
  let head: Awaited<ReturnType<typeof headInfo>> | null = null
  try {
    head = await headInfo()
  } catch {
    head = null
  }
  const ageSeconds = head ? Math.max(0, Math.floor(Date.now() / 1000) - head.timestamp) : null
  return json({
    meta: {
      chainId: ARC.chainId,
      chainName: ARC.name,
      chainVerified: head !== null,
      source,
      headBlock: head?.number ?? null,
      headTimestamp: head?.timestamp ?? null,
      headAgeSeconds: ageSeconds,
      fetchedAt: new Date().toISOString(),
      live: head !== null && ageSeconds !== null && ageSeconds <= CONFIG.staleAfterSeconds,
    },
    data,
  })
}

function limited(ip: string, cost: number): boolean {
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: cost, resetAt: now + 60_000 })
    return false
  }
  entry.count += cost
  return entry.count > CONFIG.rateLimitPerMinute
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k)
}, 60_000)

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function requireAdmin(req: Request): void {
  if (!CONFIG.adminToken) throw new HttpError(503, 'ADMIN_DISABLED', 'Set ARCPULSE_ADMIN_TOKEN to enable admin endpoints')
  const supplied = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!timingSafeEqual(supplied, CONFIG.adminToken)) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid admin token')
}

const intParam = (url: URL, name: string, def: number, min: number, max: number): number => {
  const raw = url.searchParams.get(name)
  if (raw === null) return def
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, 'BAD_PARAM', `${name} must be a number`)
  return Math.min(max, Math.max(min, Math.floor(n)))
}

const rangeParam = (url: URL): string => {
  const r = (url.searchParams.get('range') ?? '24h').toLowerCase()
  if (!RANGES.includes(r) || windowSeconds(r) === null) throw new HttpError(400, 'BAD_RANGE', `range must be one of ${RANGES.join(', ')}`)
  return r
}

const addrParam = (raw: string): string => {
  if (!isAddress(raw)) throw new HttpError(400, 'BAD_ADDRESS', 'Not a valid 0x-prefixed 20-byte address')
  return raw.toLowerCase()
}

function dependencies() {
  const providers = providerStatus()
  const configured = (name: string) => providers.some((p) => p.name === name)
  const dep = (name: string, ok: boolean, requirement: string) => ({ name, status: ok ? 'ok' : 'missing', requirement })
  return [
    dep('Dedicated primary RPC', configured('primary') || configured('sandbox-proxy'), 'Set ARC_MAINNET_RPC_URL to a dedicated Arc Mainnet RPC endpoint. The public endpoint is rate limited.'),
    dep('Verified fallback RPC', providers.filter((p) => p.chainVerified || p.healthy).length >= 2, 'Set ARC_MAINNET_RPC_FALLBACK_URL to a second provider; it is verified with eth_chainId 0x13b2 before use.'),
    dep('Admin API token', Boolean(CONFIG.adminToken), 'Set ARCPULSE_ADMIN_TOKEN to enable /api/admin endpoints.'),
    dep('Error alerting webhook', Boolean(CONFIG.errorWebhook), 'Set ERROR_WEBHOOK_URL to forward server errors to your alerting service.'),
    dep('WalletConnect project id', Boolean(process.env.VITE_WALLETCONNECT_PROJECT_ID), 'Set VITE_WALLETCONNECT_PROJECT_ID (cloud.walletconnect.com) to enable WalletConnect wallets.'),
    dep('Persistent database volume', CONFIG.databasePath !== ':memory:', 'Point DATABASE_PATH at a persistent volume in production.'),
  ]
}

async function health() {
  await probeProviders()
  let reported: string | null = null
  let head: Awaited<ReturnType<typeof headInfo>> | null = null
  let error: string | null = null
  try {
    reported = await rpc<string>('eth_chainId')
    head = await headInfo()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  const age = head ? Math.max(0, Math.floor(Date.now() / 1000) - head.timestamp) : null
  const chainOk = reported?.toLowerCase() === ARC.chainIdHex
  return {
    ok: chainOk && age !== null && age <= CONFIG.staleAfterSeconds,
    chain: { expectedChainId: ARC.chainId, expectedHex: ARC.chainIdHex, reportedHex: reported, verified: chainOk },
    head: head ? { number: head.number, timestamp: head.timestamp, ageSeconds: age } : null,
    error: error ? redact(error) : null,
    providers: providerStatus(),
    indexer: indexerStatus(),
    dependencies: dependencies(),
    explorer: ARC.explorer,
  }
}

async function route(req: Request, url: URL): Promise<Response> {
  const path = url.pathname
  const m = (re: RegExp) => re.exec(path)
  if (path === '/api/health') return json({ data: await health() })
  if (path === '/api/network') return envelope(await networkSnapshot(), 'rpc')
  if (path === '/api/blocks') return envelope(await latestBlocks(intParam(url, 'limit', 12, 1, 30)), 'rpc')
  if (path === '/api/txs') return envelope(await latestTxs(intParam(url, 'limit', 25, 1, 50)), 'rpc')
  let r: RegExpExecArray | null
  if ((r = m(/^\/api\/tx\/(0x[0-9a-fA-F]+)$/))) {
    if (!isHash(r[1] as string)) throw new HttpError(400, 'BAD_HASH', 'Not a valid transaction hash')
    const tx = await txDetail((r[1] as string).toLowerCase())
    if (!tx) throw new HttpError(404, 'TX_NOT_FOUND', 'Transaction not found on Arc Mainnet')
    return envelope(tx, 'rpc')
  }
  if ((r = m(/^\/api\/wallet\/(0x[0-9a-fA-F]+)$/))) return envelope(await walletSummary(addrParam(r[1] as string)), 'rpc')
  if ((r = m(/^\/api\/wallet\/(0x[0-9a-fA-F]+)\/transfers$/))) {
    const before = url.searchParams.get('before')
    return envelope(await walletTransfers(addrParam(r[1] as string), before ? intParam(url, 'before', 0, 0, 2 ** 40) : undefined, intParam(url, 'limit', 50, 1, 200)), 'rpc')
  }
  if ((r = m(/^\/api\/wallet\/(0x[0-9a-fA-F]+)\/holdings$/))) return envelope(await walletHoldings(addrParam(r[1] as string)), 'rpc')
  if (path === '/api/analytics') {
    const data = analytics(rangeParam(url))
    return envelope(data, 'indexer')
  }
  if (path === '/api/whales') {
    const kind = url.searchParams.get('kind') ?? 'all'
    if (!['all', 'native', 'erc20'].includes(kind)) throw new HttpError(400, 'BAD_KIND', 'kind must be all, native or erc20')
    const cursor = url.searchParams.get('cursor')
    const [b, l] = cursor ? cursor.split(':').map(Number) : [undefined, undefined]
    const min = Number(url.searchParams.get('min') ?? 10_000)
    if (!Number.isFinite(min) || min < 0) throw new HttpError(400, 'BAD_PARAM', 'min must be a non-negative number')
    return envelope(
      whales({ min, kind: kind as 'all' | 'native' | 'erc20', range: rangeParam(url), limit: intParam(url, 'limit', 50, 1, 200), before: b !== undefined && l !== undefined && Number.isFinite(b) && Number.isFinite(l) ? { block: b, logIndex: l } : undefined }),
      'indexer',
    )
  }
  if (path === '/api/tokens/active') return envelope(await activeTokens(), 'rpc')
  if (path === '/api/usdc') return envelope(await usdcOverview(rangeParam(url)), 'rpc+indexer')
  if (path === '/api/contracts/top') return envelope(topContracts(rangeParam(url)), 'indexer')
  if ((r = m(/^\/api\/contract\/(0x[0-9a-fA-F]+)$/))) return envelope(await contractDetail(addrParam(r[1] as string)), 'rpc+indexer')
  if (path === '/api/gas/estimate') {
    const kind = url.searchParams.get('kind') === 'usdc' ? 'usdc' : 'native'
    return envelope(await estimateTransfer({ kind, from: addrParam(url.searchParams.get('from') ?? ''), to: addrParam(url.searchParams.get('to') ?? ''), amount: url.searchParams.get('amount') || '0' }), 'rpc')
  }
  if (path === '/api/client-errors' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as { message?: unknown; stack?: unknown } | null
    reportError('client', new Error(String(body?.message ?? 'unknown').slice(0, 300)), String(body?.stack ?? '').slice(0, 800))
    return json({ ok: true }, 202)
  }
  if (path === '/api/admin/status') {
    requireAdmin(req)
    return json({ data: { health: await health(), errors: recentErrors() } })
  }
  if (path === '/api/admin/reindex' && req.method === 'POST') {
    requireAdmin(req)
    const from = intParam(url, 'from', 0, 0, 2 ** 40)
    const to = intParam(url, 'to', from, from, from + 250 * 2000)
    return json({ data: { requeuedBatches: requestReindex(from, to) } })
  }
  throw new HttpError(404, 'NOT_FOUND', 'Unknown API route')
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status)
  if (err instanceof AmountError) return json({ error: { code: 'BAD_AMOUNT', message: err.message } }, 400)
  if (err instanceof RpcError) {
    if (err.kind === 'range') return json({ error: { code: 'RANGE_TOO_LARGE', message: err.message } }, 422)
    if (err.kind === 'node') return json({ error: { code: 'RPC_REJECTED', message: err.message } }, 422)
    if (err.kind === 'chain') return json({ error: { code: 'CHAIN_MISMATCH', message: 'The RPC provider is not Arc Mainnet (chain 5042). Data withheld.' } }, 503)
    reportError('api', err)
    return json({ error: { code: 'RPC_UNAVAILABLE', message: 'Arc Mainnet RPC is unavailable. No data is shown rather than stale data.' } }, 503)
  }
  reportError('api', err)
  return json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } }, 500)
}

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://studio.arc.io https://studio-staging.arc.io https://huggingface.co https://*.huggingface.co"

async function serveStatic(pathname: string, acceptsGzip: boolean): Promise<Response> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const target = rel !== '/' && !rel.includes('..') && (await Bun.file(join(DIST, rel)).exists()) && !(await Bun.file(join(DIST, rel, 'index.html')).exists()) ? rel : null
  const path = target ?? '/index.html'
  const file = Bun.file(join(DIST, path))
  const isHtml = target === null
  const headers: Record<string, string> = isHtml
    ? { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': CSP }
    : { 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'content-type': file.type }
  if (acceptsGzip && COMPRESSIBLE.test(path) && file.size < 3_000_000) {
    let gz = gzCache.get(path)
    if (!gz) {
      gz = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()))
      gzCache.set(path, gz)
    }
    return new Response(asBody(gz), { headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' } })
  }
  return new Response(file, { headers })
}

const server = Bun.serve({
  port: CONFIG.port,
  hostname: '0.0.0.0',
  idleTimeout: 60,
  async fetch(req, srv) {
    const url = new URL(req.url)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || srv.requestIP(req)?.address || 'unknown'
    const origin = req.headers.get('origin')
    const allowed = process.env.ARCPULSE_ALLOWED_ORIGIN
    const corsOk = Boolean(origin && allowed && allowed.split(',').map((o) => o.trim()).includes(origin))
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: corsOk ? 204 : 403,
        headers: corsOk ? { 'access-control-allow-origin': origin as string, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin' } : {},
      })
    }
    let res: Response
    try {
      if (url.pathname.startsWith('/api/')) {
        const heavy = /\/(transfers|holdings)$|\/contract\/|\/usdc/.test(url.pathname)
        if (limited(ip, heavy ? 6 : 1)) {
          res = json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Retry in a minute.' } }, 429, { 'retry-after': '60' })
        } else {
          const ttl = req.method === 'GET' ? TTL_MS[url.pathname] : undefined
          res = ttl ? await cachedJson(url.pathname + url.search, ttl, () => route(req, url)) : await route(req, url)
        }
      } else if (existsSync(join(DIST, 'index.html'))) {
        res = await serveStatic(url.pathname, (req.headers.get('accept-encoding') ?? '').includes('gzip'))
      } else {
        res = new Response('ArcPulse API is running. Build the frontend with `bun run build` to serve it from here.', { status: 200 })
      }
    } catch (err) {
      res = errorResponse(err)
    }
    if (url.pathname.startsWith('/api/') && !res.headers.has('content-encoding') && (req.headers.get('accept-encoding') ?? '').includes('gzip') && res.headers.get('content-type')?.includes('json')) {
      const raw = new Uint8Array(await res.arrayBuffer())
      if (raw.length > 1024) {
        const headers = new Headers(res.headers)
        headers.set('content-encoding', 'gzip')
        headers.set('vary', 'accept-encoding')
        res = new Response(asBody(Bun.gzipSync(raw)), { status: res.status, headers })
      } else {
        res = new Response(asBody(raw), { status: res.status, headers: res.headers })
      }
    }
    if (corsOk && url.pathname.startsWith('/api/')) {
      res.headers.set('access-control-allow-origin', origin as string)
      res.headers.append('vary', 'origin')
    }
    res.headers.set('x-content-type-options', 'nosniff')
    res.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
    return res
  },
})

info('server', `ArcPulse listening on :${server.port}`, { chainId: ARC.chainId, providers: providerStatus().map((p) => p.name) })
startIndexer()
