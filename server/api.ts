/**
 * ArcPulse API routes. Runtime-neutral (no Bun APIs): used by the Bun server and by the Vercel function.
 */
import { AmountError } from '../src/onchain-money'
import { activeTokens, contractDetail, usdcOverview } from './contract'
import { headInfo, isAddress, isHash } from './chain'
import { CONFIG, ARC } from './env'
import { estimateTransfer, latestBlocks, latestTxs, networkSnapshot, txDetail } from './live'
import { recentErrors, redact, reportError } from './log'
import { analytics, snapshotInfo, tokensSnapshot, topContracts, whales } from './queries'
import { indexerStatus, requestReindex, windowSeconds } from './indexer'
import { probeProviders, providerStatus, rpc, RpcError } from './rpc'
import { walletHoldings, walletSummary, walletTransfers } from './wallet'

const RANGES = ['24h', '7d', '30d', '90d']

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
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
      // Present only on deployments without a running indexer: indexed history is then a labelled snapshot.
      snapshotAt: source !== 'rpc' ? (snapshotInfo()?.at ?? null) : null,
    },
    data,
  })
}


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

export async function route(req: Request, url: URL): Promise<Response> {
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
  if (path === '/api/tokens/active') {
    try {
      return await envelope(await activeTokens(), 'rpc')
    } catch (err) {
      // Serverless deployments on a shared public endpoint can be rate limited on this broad scan:
      // fall back to the labelled snapshot rather than showing an error or unlabelled old data.
      const snap = err instanceof RpcError ? tokensSnapshot() : null
      if (!snap) throw err
      return envelope(snap, 'indexer')
    }
  }
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

export function errorResponse(err: unknown): Response {
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

