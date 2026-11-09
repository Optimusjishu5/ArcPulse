/**
 * ArcPulse server configuration. Arc Mainnet only.
 * Every chain fact comes from the generated @/onchain-facts module.
 */
import { getUsdc, requireChain } from '../src/onchain-facts'

const chain = requireChain(5042)
const usdc = getUsdc(5042)

if (chain.isTestnet || chain.chainId !== 5042 || !usdc) {
  throw new Error('ArcPulse is configured for Arc Mainnet (chain 5042) only. Refusing to start.')
}

const num = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`)
  return n
}

export const ARC = {
  chainId: chain.chainId,
  chainIdHex: '0x13b2',
  name: 'Arc Mainnet',
  explorer: chain.explorerBase,
  publicRpc: chain.rpcUrls[0] as string,
  usdc: usdc.address.toLowerCase(),
  usdcDecimals: usdc.decimals,
  nativeDecimals: chain.nativeCurrency.decimals,
  // arc-studio-allow-onchain-literal
  /** System emitter of native USDC Transfer events (18-decimal accounting), observed on Arc Mainnet receipts. */
  nativeEmitter: '0xfffffffffffffffffffffffffffffffffffffffe',
} as const

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export const CONFIG = {
  // Hugging Face Spaces route traffic to port 7860 and only /tmp is reliably writable there.
  port: num('PORT', process.env.SPACE_ID ? 7860 : 3001),
  databasePath: process.env.DATABASE_PATH || (process.env.SPACE_ID ? '/tmp/arcpulse/arcpulse.db' : 'data/arcpulse.db'),
  adminToken: process.env.ARCPULSE_ADMIN_TOKEN || '',
  errorWebhook: process.env.ERROR_WEBHOOK_URL || '',
  rateLimitPerMinute: num('API_RATE_LIMIT_PER_MINUTE', 240),
  indexerEnabled: process.env.INDEXER_ENABLED !== 'false',
  historyDays: num('INDEX_HISTORY_DAYS', 90),
  backfillConcurrency: Math.max(1, Math.floor(num('INDEX_BACKFILL_CONCURRENCY', 3))),
  /** Transfers at or above this USDC amount are stored row by row (whale tracker). */
  transferStoreFloor: num('INDEX_MIN_TRANSFER_USDC', 1000),
  batchBlocks: 250,
  staleAfterSeconds: num('LIVE_STALE_AFTER_SECONDS', 20),
}

export interface ProviderConfig {
  name: string
  url: string
  /** True when the URL embeds credentials and must never be logged or returned. */
  secret: boolean
}

/**
 * Provider order: ARC_MAINNET_RPC_URL, RPC_URL_Arc, the Arc Studio sandbox proxy (sandbox only),
 * ARC_MAINNET_RPC_FALLBACK_URL, then the public Arc Mainnet RPC from the facts registry.
 * Every provider is verified with eth_chainId === 0x13b2 before it serves a request.
 */
export function providerConfigs(): ProviderConfig[] {
  const list: ProviderConfig[] = []
  const add = (name: string, url: string | undefined, secret: boolean) => {
    if (!url) return
    if (list.some((p) => p.url === url)) return
    list.push({ name, url, secret })
  }
  add('primary', process.env.ARC_MAINNET_RPC_URL, true)
  add('primary', process.env.RPC_URL_Arc, true)
  const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (process.env.RPC_PROXY_BASE_URL && process.env.RPC_PROXY_TOKEN && proxyChains.includes('Arc')) {
    add('sandbox-proxy', `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc?_rpc_token=${process.env.RPC_PROXY_TOKEN}`, true)
  }
  add('fallback', process.env.ARC_MAINNET_RPC_FALLBACK_URL, true)
  add('public', ARC.publicRpc, false)
  return list
}
