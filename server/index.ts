/**
 * ArcPulse API + static host + indexer (single process, so the SQLite file has one owner).
 * Arc Mainnet only: every request path that touches chain data goes through the chain-verified RPC pool.
 */
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { errorResponse, json, route } from './api'
import { CONFIG, ARC } from './env'
import { info } from './log'
import { startIndexer } from './indexer'
import { providerStatus } from './rpc'

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
