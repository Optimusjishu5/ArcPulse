/** Serverless build: indexed history comes from a snapshot exported from the running indexer at deploy time. */
import type { WhaleQuery } from '../queries'
import { coverageFor, windowSeconds } from './indexer-stub'
import { snapshot } from './snapshot'

const nowSec = () => Math.floor(Date.now() / 1000)
const FLOOR = 1000

export const snapshotInfo = (): { at: string } | null => (snapshot.at ? { at: snapshot.at } : { at: 'unavailable' })

const emptyAnalytics = (range: string) => ({
  range,
  bucketSeconds: range === '24h' ? 3600 : range === '7d' ? 21600 : 86400,
  coverage: 0,
  series: [],
  totals: { blocks: 0, txs: 0, gasUsed: 0, gasUtilization: 0, avgBaseFeeGwei: 0, contractCreations: 0, nativeTransfers: 0, nativeVolumeUsdc: 0, erc20Transfers: 0, erc20VolumeUsdc: 0, avgTxPerSecond: 0, avgBlockTimeSeconds: 0 },
})

export function analytics(range: string) {
  if (!windowSeconds(range)) return null
  return snapshot.analytics[range] ?? emptyAnalytics(range)
}

export function whales(q: WhaleQuery) {
  const window = windowSeconds(q.range) ?? 86400
  const since = nowSec() - window
  const min = Math.max(q.min, FLOOR)
  // The snapshot window ends when it was taken, so filter relative to that moment, not to now.
  const anchor = snapshot.at ? Math.floor(new Date(snapshot.at).getTime() / 1000) : nowSec()
  const lo = Math.min(since, anchor - window)
  const rows = snapshot.whales
    .filter((w) => w.usdc >= min && w.timestamp >= lo && (q.kind === 'all' || w.kind === q.kind))
    .sort((a, b) => b.block - a.block || b.logIndex - a.logIndex)
  const before = q.before
  const afterCursor = before ? rows.filter((w) => w.block < before.block || (w.block === before.block && w.logIndex < before.logIndex)) : rows
  const page = afterCursor.slice(0, q.limit)
  const last = page[page.length - 1]
  const sum = (kind: 'native' | 'erc20') => {
    const set = rows.filter((w) => w.kind === kind)
    return { kind, count: set.length, volume: set.reduce((n, w) => n + w.usdc, 0), largest: set.reduce((n, w) => Math.max(n, w.usdc), 0) }
  }
  return {
    minUsdc: min,
    storeFloorUsdc: FLOOR,
    range: q.range,
    coverage: coverageFor(q.range),
    transfers: page.map(({ usdc: _usdc, ...w }) => w),
    nextCursor: afterCursor.length > q.limit && last ? `${last.block}:${last.logIndex}` : null,
    summary: { native: sum('native'), erc20: sum('erc20') },
  }
}

export function topContracts(range: string, limit = 15) {
  if (!windowSeconds(range)) return null
  const t = snapshot.top[range]
  return { range, coverage: coverageFor(range), contracts: (t?.contracts ?? []).slice(0, limit), note: t?.note ?? '' }
}

/** Per-contract call counts are only known for the most active contracts in the snapshot. */
export function contractCalls(address: string, range: string) {
  if (!windowSeconds(range)) return null
  const hit = snapshot.top[range]?.contracts.find((c) => c.address === address.toLowerCase())
  return hit ? { range, calls: hit.calls, batchesWithActivity: 0, coverage: coverageFor(range) } : null
}

export const usdcTopSenders = (range: string, limit = 10) => (snapshot.usdcSenders[range] ?? []).slice(0, limit)

export const tokensSnapshot = (): unknown => snapshot.tokens
