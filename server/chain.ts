/**
 * Shared Arc Mainnet read helpers: typed block/log access, immutable-fact caches, Transfer decoding.
 */
import { decodeAbiParameters, hexToString } from 'viem'
import { ARC, TRANSFER_TOPIC } from './env'
import { db } from './db'
import { hexToNumber, memo, rpc, rpcBatch, RpcError, toHex } from './rpc'

export interface RpcTx {
  hash: string
  from: string
  to: string | null
  value: string
  input: string
  gas: string
  gasPrice?: string
  type?: string
  blockNumber: string
  transactionIndex: string
  nonce: string
}

export interface RpcBlock {
  number: string
  hash: string
  parentHash: string
  timestamp: string
  gasUsed: string
  gasLimit: string
  baseFeePerGas?: string
  miner: string
  transactions: Array<string | RpcTx>
}

export interface RpcLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
  removed?: boolean
}

export interface RpcReceipt {
  status: string
  gasUsed: string
  effectiveGasPrice?: string
  contractAddress: string | null
  blockNumber: string
  transactionHash: string
  logs: RpcLog[]
}

export interface HeadInfo {
  number: number
  timestamp: number
  hash: string
  fetchedAt: number
}

/** Latest block, read from the verified provider. Never served from a cache older than ~1 second. */
export function headInfo(): Promise<HeadInfo> {
  return memo('head', 700, async () => {
    const block = await rpc<RpcBlock | null>('eth_getBlockByNumber', ['latest', false])
    if (!block) throw new RpcError('RPC returned no latest block', 'unavailable')
    return { number: hexToNumber(block.number), timestamp: hexToNumber(block.timestamp), hash: block.hash, fetchedAt: Date.now() }
  })
}

export async function getBlocks(numbers: number[], full: boolean): Promise<RpcBlock[]> {
  const res = await rpcBatch(numbers.map((n) => ({ method: 'eth_getBlockByNumber', params: [toHex(n), full] })))
  return res.map((r, i) => {
    if (r.error || !r.result) throw new RpcError(`Block ${numbers[i]} unavailable: ${r.error?.message ?? 'not found'}`, 'unavailable')
    return r.result as RpcBlock
  })
}

const tsCache = new Map<number, number>()

/** Block timestamps are immutable (Arc has deterministic finality), so they are cached indefinitely. */
export async function blockTimestamps(numbers: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const missing: number[] = []
  for (const n of new Set(numbers)) {
    const hit = tsCache.get(n)
    if (hit !== undefined) out.set(n, hit)
    else missing.push(n)
  }
  if (missing.length > 0) {
    const blocks = await getBlocks(missing, false)
    blocks.forEach((b, i) => {
      const ts = hexToNumber(b.timestamp)
      out.set(missing[i] as number, ts)
      if (tsCache.size > 100_000) tsCache.clear()
      tsCache.set(missing[i] as number, ts)
    })
  }
  return out
}

export interface LogFilter {
  address?: string | string[]
  topics: Array<string | string[] | null>
}

/** eth_getLogs that bisects the block range whenever the provider rejects it as too large. */
export async function getLogsAdaptive(filter: LogFilter, from: number, to: number, depth = 0): Promise<RpcLog[]> {
  try {
    return await rpc<RpcLog[]>('eth_getLogs', [{ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }])
  } catch (err) {
    if (err instanceof RpcError && err.kind === 'range' && from < to && depth < 14) {
      const mid = Math.floor((from + to) / 2)
      const left = await getLogsAdaptive(filter, from, mid, depth + 1)
      const right = await getLogsAdaptive(filter, mid + 1, to, depth + 1)
      return left.concat(right)
    }
    throw err
  }
}

export const topicToAddress = (topic: string): string => `0x${topic.slice(26)}`.toLowerCase()
export const addressToTopic = (address: string): string => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`

export type TransferKind = 'native' | 'erc20'

export interface DecodedTransfer {
  /** 'native' = 18-decimal native USDC event, 'erc20' = any ERC-20 Transfer event (token = emitting contract). */
  kind: TransferKind
  token: string
  from: string
  to: string
  raw: bigint
  block: number
  logIndex: number
  txHash: string
}

/** Decodes an ERC-20 style Transfer(address,address,uint256) log. ERC-721 logs (4 topics) are rejected. */
export function decodeTransfer(log: RpcLog): DecodedTransfer | null {
  if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC) return null
  if (typeof log.data !== 'string' || log.data.length !== 66) return null
  const address = log.address.toLowerCase()
  return {
    kind: address === ARC.nativeEmitter ? 'native' : 'erc20',
    token: address,
    from: topicToAddress(log.topics[1] as string),
    to: topicToAddress(log.topics[2] as string),
    raw: BigInt(log.data),
    block: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex),
    txHash: log.transactionHash,
  }
}

export interface TokenMeta {
  address: string
  name: string | null
  symbol: string | null
  decimals: number
}

const noToken = new Map<string, number>()

function decodeString(hex: unknown): string | null {
  if (typeof hex !== 'string' || hex.length < 66) return null
  try {
    if (hex.length === 66) return hexToString(hex as `0x${string}`, { size: 32 }).replace(/\0/g, '').trim() || null
    const [value] = decodeAbiParameters([{ type: 'string' }], hex as `0x${string}`)
    return value.slice(0, 64)
  } catch {
    return null
  }
}

/** Token name/symbol/decimals read from the contracts. Positive results are immutable and persisted. */
export async function tokenMeta(addresses: string[]): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>()
  const need: string[] = []
  for (const raw of new Set(addresses.map((a) => a.toLowerCase()))) {
    const row = db.query('SELECT address, name, symbol, decimals FROM token_meta WHERE address = ?').get(raw) as TokenMeta | null
    if (row) out.set(raw, row)
    else if (Date.now() - (noToken.get(raw) ?? 0) > 10 * 60_000) need.push(raw)
  }
  if (need.length === 0) return out
  const calls = need.flatMap((to) =>
    ['0x06fdde03', '0x95d89b41', '0x313ce567'].map((data) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] })),
  )
  const res = await rpcBatch(calls)
  need.forEach((address, i) => {
    const [n, s, d] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]]
    const decimalsHex = d?.result
    if (typeof decimalsHex !== 'string' || decimalsHex.length !== 66) {
      noToken.set(address, Date.now())
      return
    }
    const decimals = Number(BigInt(decimalsHex))
    if (!Number.isInteger(decimals) || decimals > 36) {
      noToken.set(address, Date.now())
      return
    }
    const meta: TokenMeta = { address, name: decodeString(n?.result), symbol: decodeString(s?.result), decimals }
    db.query('INSERT OR REPLACE INTO token_meta(address, name, symbol, decimals, fetched_at) VALUES(?,?,?,?,?)').run(
      address,
      meta.name,
      meta.symbol,
      meta.decimals,
      Date.now(),
    )
    out.set(address, meta)
  })
  return out
}

export const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v)
export const isHash = (v: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(v)
