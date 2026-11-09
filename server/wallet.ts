/** Wallet intelligence from live RPC reads and event-log scans. Native (18 decimals) and ERC-20 (6 decimals) are never merged. */
import { addressToTopic, blockTimestamps, decodeTransfer, getLogsAdaptive, headInfo, tokenMeta, type DecodedTransfer } from './chain'
import { ARC, TRANSFER_TOPIC } from './env'
import { hexToBigInt, hexToNumber, rpcBatch } from './rpc'

const BALANCE_OF = '0x70a08231'

export async function walletSummary(address: string) {
  const [native, erc20, nonce, code] = await rpcBatch([
    { method: 'eth_getBalance', params: [address, 'latest'] },
    { method: 'eth_call', params: [{ to: ARC.usdc, data: `${BALANCE_OF}${addressToTopic(address).slice(2)}` }, 'latest'] },
    { method: 'eth_getTransactionCount', params: [address, 'latest'] },
    { method: 'eth_getCode', params: [address, 'latest'] },
  ])
  for (const r of [native, erc20, nonce, code]) {
    if (r?.error) throw new Error(`RPC read failed: ${r.error.message}`)
  }
  const nativeRaw = hexToBigInt(native?.result)
  const erc20Raw = hexToBigInt(erc20?.result)
  const codeHex = typeof code?.result === 'string' ? code.result : '0x'
  return {
    address,
    native: { raw: nativeRaw.toString(), decimals: ARC.nativeDecimals, label: 'Native USDC (gas view, 18 decimals)' },
    erc20: { raw: erc20Raw.toString(), decimals: ARC.usdcDecimals, token: ARC.usdc, label: 'ERC-20 USDC (6 decimals)' },
    /** Both views describe one pool of funds; a mismatch beyond sub-micro dust would signal an RPC problem. */
    viewsAgree: nativeRaw / 10n ** BigInt(ARC.nativeDecimals - ARC.usdcDecimals) === erc20Raw,
    nonce: hexToNumber(nonce?.result),
    isContract: codeHex.length > 2,
    codeBytes: Math.max(0, (codeHex.length - 2) / 2),
  }
}

export interface ScanOptions {
  direction: 'in' | 'out' | 'both'
  beforeBlock?: number
  limit: number
  budgetMs: number
  /** Stop once this many distinct non-native token contracts have been seen. */
  maxTokens?: number
}

export interface ScanResult {
  events: DecodedTransfer[]
  scannedFromBlock: number
  scannedToBlock: number
  reachedGenesis: boolean
  headBlock: number
}

/** Scans Transfer events involving `address` backwards from `beforeBlock`, until a limit or time budget is reached. */
export async function scanTransfers(address: string, opt: ScanOptions): Promise<ScanResult> {
  const head = await headInfo()
  const pad = addressToTopic(address)
  const started = Date.now()
  let hi = opt.beforeBlock !== undefined ? opt.beforeBlock - 1 : head.number
  const top = hi
  let span = 50_000
  const seen = new Set<string>()
  const events: DecodedTransfer[] = []
  const tokens = new Set<string>()
  while (hi >= 0 && Date.now() - started < opt.budgetMs && events.length < opt.limit && (!opt.maxTokens || tokens.size < opt.maxTokens)) {
    const lo = Math.max(0, hi - span + 1)
    const queries = []
    if (opt.direction !== 'in') queries.push(getLogsAdaptive({ topics: [TRANSFER_TOPIC, pad] }, lo, hi))
    if (opt.direction !== 'out') queries.push(getLogsAdaptive({ topics: [TRANSFER_TOPIC, null, pad] }, lo, hi))
    const found = (await Promise.all(queries)).flat()
    let added = 0
    for (const log of found) {
      const d = decodeTransfer(log)
      if (!d || log.removed) continue
      const key = `${d.txHash}:${d.logIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      events.push(d)
      if (d.kind === 'erc20') tokens.add(d.token)
      added += 1
    }
    hi = lo - 1
    span = added < 20 ? Math.min(span * 2, 400_000) : Math.max(25_000, Math.floor(span / 2))
  }
  events.sort((a, b) => b.block - a.block || b.logIndex - a.logIndex)
  return { events, scannedFromBlock: Math.max(0, hi + 1), scannedToBlock: top, reachedGenesis: hi < 0, headBlock: head.number }
}

export async function walletTransfers(address: string, beforeBlock: number | undefined, limit: number) {
  const scan = await scanTransfers(address, { direction: 'both', beforeBlock, limit, budgetMs: 7000 })
  // A scan window can hold far more events than one page. Keep whole blocks only, and resume from the last kept block.
  let cut = Math.min(limit, scan.events.length)
  while (cut < scan.events.length && scan.events[cut]?.block === scan.events[cut - 1]?.block) cut += 1
  const truncated = cut < scan.events.length
  const page = scan.events.slice(0, cut)
  const lastBlock = page[page.length - 1]?.block ?? scan.scannedFromBlock
  const ts = await blockTimestamps(page.map((e) => e.block))
  const metas = await tokenMeta(page.filter((e) => e.kind === 'erc20' && e.token !== ARC.usdc).map((e) => e.token))
  return {
    address,
    scannedFromBlock: truncated ? lastBlock : scan.scannedFromBlock,
    scannedToBlock: scan.scannedToBlock,
    reachedGenesis: !truncated && scan.reachedGenesis,
    nextBefore: !truncated && scan.reachedGenesis ? null : truncated ? lastBlock : scan.scannedFromBlock,
    transfers: page.map((e) => {
      const isUsdc = e.kind === 'erc20' && e.token === ARC.usdc
      const meta = metas.get(e.token)
      return {
        txHash: e.txHash,
        logIndex: e.logIndex,
        block: e.block,
        timestamp: ts.get(e.block) ?? null,
        direction: e.from === address && e.to === address ? 'self' : e.from === address ? 'out' : 'in',
        counterparty: e.from === address ? e.to : e.from,
        asset: e.kind === 'native' ? 'native-usdc' : isUsdc ? 'erc20-usdc' : 'token',
        token: e.kind === 'native' ? null : e.token,
        symbol: e.kind === 'native' || isUsdc ? 'USDC' : meta?.symbol ?? null,
        decimals: e.kind === 'native' ? ARC.nativeDecimals : isUsdc ? ARC.usdcDecimals : meta?.decimals ?? null,
        raw: e.raw.toString(),
      }
    }),
  }
}

export async function walletHoldings(address: string) {
  const scan = await scanTransfers(address, { direction: 'in', limit: 5000, budgetMs: 8000, maxTokens: 60 })
  const candidates = [...new Set(scan.events.filter((e) => e.kind === 'erc20' && e.token !== ARC.usdc).map((e) => e.token))].slice(0, 60)
  const metas = await tokenMeta(candidates)
  const known = candidates.filter((t) => metas.has(t))
  const balances = await rpcBatch(
    known.map((t) => ({ method: 'eth_call', params: [{ to: t, data: `${BALANCE_OF}${addressToTopic(address).slice(2)}` }, 'latest'] })),
  )
  const holdings = known.flatMap((t, i) => {
    const raw = hexToBigInt(balances[i]?.result)
    const m = metas.get(t)
    return raw > 0n && m ? [{ token: t, symbol: m.symbol, name: m.name, decimals: m.decimals, raw: raw.toString() }] : []
  })
  return {
    address,
    holdings,
    discovery: {
      method: 'Tokens that appear in incoming Transfer events, balances read live from each token contract',
      scannedFromBlock: scan.scannedFromBlock,
      scannedToBlock: scan.scannedToBlock,
      scannedBlocks: scan.scannedToBlock - scan.scannedFromBlock + 1,
      complete: scan.reachedGenesis,
    },
  }
}
