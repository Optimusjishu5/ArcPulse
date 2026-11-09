/** Contract and token analytics from live RPC reads, event logs, Sourcify and the ArcPulse index. */
import { toEventSelector } from 'viem'
import { blockTimestamps, decodeTransfer, getLogsAdaptive, headInfo, tokenMeta, type RpcTx } from './chain'
import { ARC, TRANSFER_TOPIC } from './env'
import { contractCalls, topContracts, usdcTopSenders, analytics } from './queries'
import { classifyTx } from './live'
import { hexToBigInt, hexToNumber, memo, rpcBatch } from './rpc'

const KNOWN_EVENTS: Record<string, string> = {
  [TRANSFER_TOPIC]: 'Transfer',
  [toEventSelector('Approval(address,address,uint256)')]: 'Approval',
  [toEventSelector('OwnershipTransferred(address,address)')]: 'OwnershipTransferred',
  [toEventSelector('Upgraded(address)')]: 'Upgraded',
  [toEventSelector('Deposit(address,uint256)')]: 'Deposit',
  [toEventSelector('Withdrawal(address,uint256)')]: 'Withdrawal',
}

export interface Verification {
  status: 'verified' | 'not-verified' | 'unknown'
  match: string | null
  source: 'sourcify'
  checkedUrl: string
}

/** Source verification is read from Sourcify. Nothing is assumed: a lookup failure is reported as unknown. */
export function verification(address: string): Promise<Verification> {
  const url = `https://sourcify.dev/server/v2/contract/${ARC.chainId}/${address}`
  return memo(`verify:${address}`, 5 * 60_000, async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (res.status === 404) return { status: 'not-verified' as const, match: null, source: 'sourcify' as const, checkedUrl: url }
      if (!res.ok) return { status: 'unknown' as const, match: null, source: 'sourcify' as const, checkedUrl: url }
      const body = (await res.json()) as { match?: string | null }
      return {
        status: body.match ? ('verified' as const) : ('not-verified' as const),
        match: body.match ?? null,
        source: 'sourcify' as const,
        checkedUrl: url,
      }
    } catch {
      return { status: 'unknown' as const, match: null, source: 'sourcify' as const, checkedUrl: url }
    }
  })
}

export async function contractDetail(address: string) {
  const head = await headInfo()
  const calls = await rpcBatch([
    { method: 'eth_getCode', params: [address, 'latest'] },
    { method: 'eth_getBalance', params: [address, 'latest'] },
    { method: 'eth_call', params: [{ to: address, data: '0x18160ddd' }, 'latest'] },
  ])
  const code = typeof calls[0]?.result === 'string' ? calls[0].result : '0x'
  const isContract = code.length > 2
  const [meta, verified] = await Promise.all([
    isContract ? tokenMeta([address]) : Promise.resolve(new Map<string, never>()),
    isContract ? verification(address) : null,
  ])
  const tokenInfo = meta.get(address) ?? null
  const supplyHex = calls[2]?.result
  const from = Math.max(0, head.number - 3000)
  const logs = isContract ? await getLogsAdaptive({ address, topics: [] }, from, head.number).catch(() => null) : []
  const eventCounts = new Map<string, number>()
  for (const l of logs ?? []) eventCounts.set(l.topics[0] ?? 'anonymous', (eventCounts.get(l.topics[0] ?? 'anonymous') ?? 0) + 1)
  const recent = (logs ?? []).slice(-25).reverse()
  const txHashes = [...new Set(recent.map((l) => l.transactionHash))].slice(0, 15)
  const txRes = await rpcBatch(txHashes.map((h) => ({ method: 'eth_getTransactionByHash', params: [h] })))
  const interactions = txRes.flatMap((r) => {
    const tx = r.result as RpcTx | null
    if (!tx) return []
    const c = classifyTx(tx)
    return [{ hash: tx.hash, block: hexToNumber(tx.blockNumber), from: tx.from, selector: c.selector, type: c.type, nativeValueRaw: hexToBigInt(tx.value).toString() }]
  })
  const ts = await blockTimestamps([...recent.map((l) => hexToNumber(l.blockNumber)), ...interactions.map((i) => i.block)])
  return {
    address,
    isContract,
    codeBytes: Math.max(0, (code.length - 2) / 2),
    nativeBalanceRaw: hexToBigInt(calls[1]?.result).toString(),
    nativeDecimals: ARC.nativeDecimals,
    verification: verified,
    explorerUrl: `${ARC.explorer}/address/${address}`,
    token: tokenInfo
      ? { name: tokenInfo.name, symbol: tokenInfo.symbol, decimals: tokenInfo.decimals, totalSupplyRaw: hexToBigInt(supplyHex).toString(), isUsdc: address === ARC.usdc }
      : null,
    eventWindow: { fromBlock: from, toBlock: head.number, complete: logs !== null, events: logs?.length ?? 0 },
    eventSummary: [...eventCounts.entries()].map(([topic0, count]) => ({ topic0, name: KNOWN_EVENTS[topic0] ?? null, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    recentEvents: recent.map((l) => {
      const d = decodeTransfer(l)
      return {
        txHash: l.transactionHash, block: hexToNumber(l.blockNumber), timestamp: ts.get(hexToNumber(l.blockNumber)) ?? null,
        topic0: l.topics[0] ?? null, name: KNOWN_EVENTS[l.topics[0] ?? ''] ?? null,
        transfer: d && tokenInfo ? { from: d.from, to: d.to, raw: d.raw.toString() } : null,
      }
    }),
    interactions: interactions.map((i) => ({ ...i, timestamp: ts.get(i.block) ?? null })),
    indexedCalls: { '24h': contractCalls(address, '24h'), '7d': contractCalls(address, '7d'), '30d': contractCalls(address, '30d') },
  }
}

/** Tokens with the most Transfer events in a recent block window. A sample, labelled with its exact window. */
export function activeTokens() {
  return memo('active-tokens', 60_000, async () => {
    const head = await headInfo()
    const from = head.number - 1200
    const logs = await getLogsAdaptive({ topics: [TRANSFER_TOPIC] }, from, head.number)
    const byToken = new Map<string, { transfers: number; senders: Set<string>; receivers: Set<string> }>()
    for (const l of logs) {
      const d = decodeTransfer(l)
      if (!d || d.kind === 'native') continue
      const e = byToken.get(d.token) ?? { transfers: 0, senders: new Set<string>(), receivers: new Set<string>() }
      e.transfers += 1
      e.senders.add(d.from)
      e.receivers.add(d.to)
      byToken.set(d.token, e)
    }
    const top = [...byToken.entries()].sort((a, b) => b[1].transfers - a[1].transfers).slice(0, 30)
    const metas = await tokenMeta(top.map(([a]) => a))
    const ts = await blockTimestamps([from, head.number])
    return {
      window: { fromBlock: from, toBlock: head.number, fromTimestamp: ts.get(from) ?? null, toTimestamp: ts.get(head.number) ?? null },
      asOf: new Date().toISOString(),
      tokens: top.flatMap(([address, e]) => {
        const m = metas.get(address)
        return m
          ? [{ address, symbol: m.symbol, name: m.name, decimals: m.decimals, transfers: e.transfers, uniqueSenders: e.senders.size, uniqueReceivers: e.receivers.size, isUsdc: address === ARC.usdc }]
          : []
      }),
    }
  })
}

export async function usdcOverview(range: string) {
  const supply = await rpcBatch([{ method: 'eth_call', params: [{ to: ARC.usdc, data: '0x18160ddd' }, 'latest'] }])
  const meta = await tokenMeta([ARC.usdc])
  return {
    token: ARC.usdc,
    meta: meta.get(ARC.usdc) ?? null,
    totalSupplyRaw: hexToBigInt(supply[0]?.result).toString(),
    decimals: ARC.usdcDecimals,
    analytics: analytics(range),
    topSenders: usdcTopSenders(range),
    topContracts: topContracts(range),
  }
}
