/**
 * Arc Mainnet JSON-RPC pool.
 * - Every provider is verified with eth_chainId === 0x13b2 before it serves any request.
 * - Failed, rate-limited or mismatched providers are skipped; the next verified provider is used.
 * - Nothing here caches chain state: callers decide what may be cached (immutable facts only).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { ARC, providerConfigs, type ProviderConfig } from './env'
import { redact, reportError } from './log'

export type RpcErrorKind = 'range' | 'node' | 'unavailable' | 'chain'

export class RpcError extends Error {
  readonly code: number | null
  readonly kind: RpcErrorKind
  constructor(message: string, kind: RpcErrorKind, code: number | null = null) {
    super(redact(message))
    this.name = 'RpcError'
    this.kind = kind
    this.code = code
  }
}

interface ProviderState {
  cfg: ProviderConfig
  verifiedAt: number
  chainMismatch: boolean
  mismatchRecheckAt: number
  failures: number
  openUntil: number
  bgOpenUntil: number
  lastError: string | null
  lastLatencyMs: number | null
  lastOkAt: number | null
  requests: number
  errors: number
  rateLimited: number
}

const providers: ProviderState[] = providerConfigs().map((cfg) => ({
  cfg,
  verifiedAt: 0,
  chainMismatch: false,
  mismatchRecheckAt: 0,
  failures: 0,
  openUntil: 0,
  bgOpenUntil: 0,
  lastError: null,
  lastLatencyMs: null,
  lastOkAt: null,
  requests: 0,
  errors: 0,
  rateLimited: 0,
}))

const VERIFY_TTL_MS = 5 * 60_000
const MAX_IN_FLIGHT = 8
const MAX_BACKGROUND = 4
let inFlight = 0
let bgInFlight = 0
const waiters: Array<() => void> = []
const bgWaiters: Array<() => void> = []
const bgContext = new AsyncLocalStorage<boolean>()

/** Marks RPC calls made inside `fn` as background (indexer) work. Interactive API calls always go first. */
export const runBackground = <T>(fn: () => Promise<T>): Promise<T> => bgContext.run(true, fn)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function acquire(bg: boolean): Promise<void> {
  for (;;) {
    if (inFlight < MAX_IN_FLIGHT && (!bg || bgInFlight < MAX_BACKGROUND)) {
      inFlight += 1
      if (bg) bgInFlight += 1
      return
    }
    await new Promise<void>((resolve) => (bg ? bgWaiters : waiters).push(resolve))
  }
}

function release(bg: boolean): void {
  inFlight -= 1
  if (bg) bgInFlight -= 1
  const next = waiters.shift() ?? bgWaiters.shift()
  if (next) next()
}

export interface RawResponse {
  result?: unknown
  error?: { code: number; message: string }
}

class ProviderFailure extends Error {
  readonly rateLimited: boolean
  readonly retryAfterMs: number
  constructor(message: string, rateLimited = false, retryAfterMs = 0) {
    super(redact(message))
    this.rateLimited = rateLimited
    this.retryAfterMs = retryAfterMs
  }
}

async function post(p: ProviderState, body: unknown): Promise<unknown> {
  p.requests += 1
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(p.cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new ProviderFailure(`network error: ${err instanceof Error ? err.message : String(err)}`)
  }
  p.lastLatencyMs = Date.now() - started
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new ProviderFailure('HTTP 429 rate limited', true, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500)
  }
  if (res.status >= 500) throw new ProviderFailure(`HTTP ${res.status}`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ProviderFailure(`HTTP ${res.status} with a non-JSON body`)
  }
  return json
}

async function ensureVerified(p: ProviderState): Promise<void> {
  const now = Date.now()
  if (p.chainMismatch) {
    if (now < p.mismatchRecheckAt) throw new RpcError(`Provider ${p.cfg.name} reports a different chain`, 'chain')
    p.chainMismatch = false
  }
  if (now - p.verifiedAt < VERIFY_TTL_MS) return
  const json = (await post(p, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })) as RawResponse
  const id = typeof json.result === 'string' ? json.result.toLowerCase() : ''
  if (id !== ARC.chainIdHex) {
    p.chainMismatch = true
    p.mismatchRecheckAt = now + 10 * 60_000
    p.lastError = `eth_chainId returned ${id || 'nothing'}, expected ${ARC.chainIdHex}`
    reportError('rpc', new Error(`Provider ${p.cfg.name} failed chain verification: ${p.lastError}`))
    throw new RpcError(p.lastError, 'chain')
  }
  p.verifiedAt = now
}

function markFailure(p: ProviderState, err: ProviderFailure, bg: boolean): void {
  p.errors += 1
  p.failures += 1
  p.lastError = err.message
  p.verifiedAt = 0
  if (err.rateLimited) {
    p.rateLimited += 1
    // Background work backs off on its own so it never starves interactive requests.
    if (bg) p.bgOpenUntil = Date.now() + Math.max(err.retryAfterMs, 2000)
    else p.openUntil = Date.now() + Math.max(err.retryAfterMs, 800)
  } else {
    p.openUntil = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(p.failures, 5))
  }
}

function markOk(p: ProviderState): void {
  p.failures = 0
  p.openUntil = 0
  p.lastOkAt = Date.now()
}

function classify(error: { code: number; message: string }): RpcError | ProviderFailure {
  const msg = error.message || 'RPC error'
  const lower = msg.toLowerCase()
  if (error.code === -32005 || lower.includes('rate limit')) return new ProviderFailure(msg, true, 1500)
  if (lower.includes('range') || lower.includes('max results') || lower.includes('too large') || lower.includes('exceeds')) {
    return new RpcError(msg, 'range', error.code)
  }
  return new RpcError(msg, 'node', error.code)
}

async function send(body: unknown): Promise<unknown> {
  const bg = bgContext.getStore() === true
  await acquire(bg)
  try {
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const usable = providers.filter((p) => !p.chainMismatch || Date.now() >= p.mismatchRecheckAt)
      if (usable.length === 0) throw new RpcError('No verified Arc Mainnet RPC provider is available', 'unavailable')
      const ready = usable.filter((p) => p.openUntil <= Date.now() && (!bg || p.bgOpenUntil <= Date.now()))
      if (ready.length === 0) {
        const soonest = Math.min(...usable.map((p) => Math.max(p.openUntil, bg ? p.bgOpenUntil : 0)))
        await sleep(Math.max(100, Math.min(soonest - Date.now(), 2500)))
        continue
      }
      for (const p of ready) {
        try {
          await ensureVerified(p)
          const json = await post(p, body)
          const items = Array.isArray(json) ? (json as RawResponse[]) : [json as RawResponse]
          const limited = items.find((i) => i.error && classify(i.error) instanceof ProviderFailure)
          if (limited?.error) throw classify(limited.error)
          markOk(p)
          return json
        } catch (err) {
          if (err instanceof ProviderFailure) {
            markFailure(p, err, bg)
            lastErr = err
          } else if (err instanceof RpcError && err.kind === 'chain') {
            lastErr = err
          } else {
            throw err
          }
        }
      }
    }
    throw new RpcError(`Arc Mainnet RPC unavailable: ${lastErr instanceof Error ? lastErr.message : 'unknown error'}`, 'unavailable')
  } finally {
    release(bg)
  }
}

let nextId = 1

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const id = nextId++
  const json = (await send({ jsonrpc: '2.0', id, method, params })) as RawResponse
  if (json.error) {
    const c = classify(json.error)
    throw c instanceof ProviderFailure ? new RpcError(c.message, 'unavailable', json.error.code) : c
  }
  return json.result as T
}

export interface BatchCall {
  method: string
  params: unknown[]
}

/** Batches are sent in groups of 50. Individual call errors are returned, not thrown. */
export async function rpcBatch(calls: BatchCall[]): Promise<RawResponse[]> {
  const out: RawResponse[] = []
  for (let i = 0; i < calls.length; i += 50) {
    const slice = calls.slice(i, i + 50)
    const base = nextId
    nextId += slice.length
    const body = slice.map((c, k) => ({ jsonrpc: '2.0', id: base + k, method: c.method, params: c.params }))
    const json = (await send(body)) as Array<RawResponse & { id: number }>
    if (!Array.isArray(json)) throw new RpcError('RPC provider did not return a batch response', 'unavailable')
    const byId = new Map(json.map((r) => [r.id, r]))
    for (let k = 0; k < slice.length; k += 1) {
      out.push(byId.get(base + k) ?? { error: { code: -32603, message: 'missing batch response' } })
    }
  }
  return out
}

export const hexToNumber = (hex: unknown): number => (typeof hex === 'string' ? Number.parseInt(hex, 16) : 0)
export const hexToBigInt = (hex: unknown): bigint => (typeof hex === 'string' && hex !== '0x' ? BigInt(hex) : 0n)
export const toHex = (n: number | bigint): string => `0x${n.toString(16)}`

export function providerStatus() {
  return providers.map((p) => ({
    name: p.cfg.name,
    credentialed: p.cfg.secret,
    chainVerified: !p.chainMismatch && Date.now() - p.verifiedAt < VERIFY_TTL_MS,
    chainMismatch: p.chainMismatch,
    healthy: p.openUntil <= Date.now() && !p.chainMismatch,
    lastLatencyMs: p.lastLatencyMs,
    lastOkAt: p.lastOkAt ? new Date(p.lastOkAt).toISOString() : null,
    lastError: p.lastError,
    requests: p.requests,
    errors: p.errors,
    rateLimited: p.rateLimited,
  }))
}

/** Fresh active probe used by /api/health: verifies chain id of every provider. */
export async function probeProviders(): Promise<void> {
  await Promise.all(
    providers.map(async (p) => {
      try {
        p.verifiedAt = 0
        await ensureVerified(p)
        markOk(p)
      } catch (err) {
        if (err instanceof ProviderFailure) markFailure(p, err, false)
      }
    }),
  )
}

const memoStore = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>()

/** Short-lived memo for live reads; entries carry no data beyond ttlMs. */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memoStore.get(key)
  const now = Date.now()
  if (hit && !hit.pending && now - hit.at < ttlMs) return hit.value as T
  if (hit?.pending) return hit.pending as Promise<T>
  const pending = fn().then(
    (value) => {
      memoStore.set(key, { at: Date.now(), value })
      return value
    },
    (err) => {
      memoStore.delete(key)
      throw err
    },
  )
  memoStore.set(key, { at: hit?.at ?? 0, value: hit?.value, pending })
  return pending
}
