/** Read queries over the ArcPulse index. Every result states the coverage it was computed from. */
import { db } from './db'
import { ARC, CONFIG } from './env'
import { coverageFor, windowSeconds } from './indexer'

const nowSec = () => Math.floor(Date.now() / 1000)

const BUCKET: Record<string, number> = { '24h': 3600, '7d': 6 * 3600, '30d': 86400, '90d': 86400 }

interface SeriesRow {
  t: number
  blocks: number
  txs: number
  gasUsed: number
  gasLimit: number
  baseFeeSum: number
  creations: number
  nativeCount: number
  nativeVol: number
  erc20Count: number
  erc20Vol: number
  batches: number
  covered: number
}

export function analytics(range: string) {
  const window = windowSeconds(range)
  if (!window) return null
  const bucket = BUCKET[range] as number
  const since = nowSec() - window
  const rows = db
    .query(
      `SELECT (ts_start / ?1) * ?1 AS t, SUM(blocks) AS blocks, SUM(txs) AS txs, SUM(gas_used) AS gasUsed, SUM(gas_limit) AS gasLimit,
        SUM(base_fee_sum) AS baseFeeSum, SUM(creations) AS creations, SUM(native_count) AS nativeCount, SUM(native_vol) AS nativeVol,
        SUM(erc20_count) AS erc20Count, SUM(erc20_vol) AS erc20Vol, COUNT(*) AS batches, SUM(ts_end - ts_start + 1) AS covered
       FROM batches WHERE ts_start >= ?2 GROUP BY t ORDER BY t`,
    )
    .all(bucket, since) as SeriesRow[]
  const totals = rows.reduce(
    (a, r) => ({
      blocks: a.blocks + r.blocks,
      txs: a.txs + r.txs,
      gasUsed: a.gasUsed + r.gasUsed,
      gasLimit: a.gasLimit + r.gasLimit,
      baseFeeSum: a.baseFeeSum + r.baseFeeSum,
      creations: a.creations + r.creations,
      nativeCount: a.nativeCount + r.nativeCount,
      nativeVol: a.nativeVol + r.nativeVol,
      erc20Count: a.erc20Count + r.erc20Count,
      erc20Vol: a.erc20Vol + r.erc20Vol,
      covered: a.covered + r.covered,
    }),
    { blocks: 0, txs: 0, gasUsed: 0, gasLimit: 0, baseFeeSum: 0, creations: 0, nativeCount: 0, nativeVol: 0, erc20Count: 0, erc20Vol: 0, covered: 0 },
  )
  return {
    range,
    bucketSeconds: bucket,
    coverage: coverageFor(range),
    series: rows.map((r) => ({
      t: r.t,
      blocks: r.blocks,
      txs: r.txs,
      gasUsed: r.gasUsed,
      gasUtilization: r.gasLimit > 0 ? r.gasUsed / r.gasLimit : 0,
      avgBaseFeeGwei: r.blocks > 0 ? r.baseFeeSum / r.blocks / 1e9 : 0,
      contractCreations: r.creations,
      nativeTransfers: r.nativeCount,
      nativeVolumeUsdc: r.nativeVol,
      erc20Transfers: r.erc20Count,
      erc20VolumeUsdc: r.erc20Vol,
    })),
    totals: {
      blocks: totals.blocks,
      txs: totals.txs,
      gasUsed: totals.gasUsed,
      gasUtilization: totals.gasLimit > 0 ? totals.gasUsed / totals.gasLimit : 0,
      avgBaseFeeGwei: totals.blocks > 0 ? totals.baseFeeSum / totals.blocks / 1e9 : 0,
      contractCreations: totals.creations,
      nativeTransfers: totals.nativeCount,
      nativeVolumeUsdc: totals.nativeVol,
      erc20Transfers: totals.erc20Count,
      erc20VolumeUsdc: totals.erc20Vol,
      avgTxPerSecond: totals.covered > 0 ? totals.txs / totals.covered : 0,
      avgBlockTimeSeconds: totals.blocks > 0 ? totals.covered / totals.blocks : 0,
    },
  }
}

export interface WhaleQuery {
  min: number
  kind: 'native' | 'erc20' | 'all'
  range: string
  limit: number
  before?: { block: number; logIndex: number }
}

interface TransferRow {
  tx_hash: string
  log_index: number
  kind: 'native' | 'erc20'
  block: number
  ts: number
  from_addr: string
  to_addr: string
  raw: string
  usdc: number
}

export function whales(q: WhaleQuery) {
  const window = windowSeconds(q.range) ?? 86400
  const since = nowSec() - window
  const min = Math.max(q.min, CONFIG.transferStoreFloor)
  const kindClause = q.kind === 'all' ? '' : 'AND kind = @kind'
  const cursor = q.before ? 'AND (block < @bblock OR (block = @bblock AND log_index < @blog))' : ''
  const params: Record<string, string | number> = { '@min': min, '@since': since, '@limit': q.limit + 1 }
  if (q.kind !== 'all') params['@kind'] = q.kind
  if (q.before) {
    params['@bblock'] = q.before.block
    params['@blog'] = q.before.logIndex
  }
  const rows = db
    .query(
      `SELECT * FROM transfers WHERE usdc >= @min AND ts >= @since ${kindClause} ${cursor} ORDER BY block DESC, log_index DESC LIMIT @limit`,
    )
    .all(params) as TransferRow[]
  const hasMore = rows.length > q.limit
  const page = rows.slice(0, q.limit)
  const summary = db
    .query(
      `SELECT kind, COUNT(*) AS count, COALESCE(SUM(usdc),0) AS volume, COALESCE(MAX(usdc),0) AS largest
       FROM transfers WHERE usdc >= ? AND ts >= ? GROUP BY kind`,
    )
    .all(min, since) as Array<{ kind: 'native' | 'erc20'; count: number; volume: number; largest: number }>
  const last = page[page.length - 1]
  return {
    minUsdc: min,
    storeFloorUsdc: CONFIG.transferStoreFloor,
    range: q.range,
    coverage: coverageFor(q.range),
    transfers: page.map((r) => ({
      txHash: r.tx_hash,
      logIndex: r.log_index,
      kind: r.kind,
      block: r.block,
      timestamp: r.ts,
      from: r.from_addr,
      to: r.to_addr,
      raw: r.raw,
      decimals: r.kind === 'native' ? ARC.nativeDecimals : ARC.usdcDecimals,
      status: 'success' as const,
    })),
    nextCursor: hasMore && last ? `${last.block}:${last.log_index}` : null,
    summary: {
      native: summary.find((s) => s.kind === 'native') ?? { kind: 'native', count: 0, volume: 0, largest: 0 },
      erc20: summary.find((s) => s.kind === 'erc20') ?? { kind: 'erc20', count: 0, volume: 0, largest: 0 },
    },
  }
}

export function topContracts(range: string, limit = 15) {
  const window = windowSeconds(range)
  if (!window) return null
  const since = nowSec() - window
  const rows = db
    .query(
      `SELECT ca.address AS address, SUM(ca.tx_count) AS calls FROM contract_activity ca
       JOIN batches b ON b.id = ca.batch_id WHERE b.ts_start >= ? GROUP BY ca.address ORDER BY calls DESC LIMIT ?`,
    )
    .all(since, limit) as Array<{ address: string; calls: number }>
  return { range, coverage: coverageFor(range), contracts: rows, note: 'Counts include only each batch\'s eight most-called addresses, so they are lower bounds.' }
}

export function contractCalls(address: string, range: string) {
  const window = windowSeconds(range)
  if (!window) return null
  const since = nowSec() - window
  const row = db
    .query(
      `SELECT COALESCE(SUM(ca.tx_count),0) AS calls, COUNT(*) AS batches FROM contract_activity ca
       JOIN batches b ON b.id = ca.batch_id WHERE ca.address = ? AND b.ts_start >= ?`,
    )
    .get(address.toLowerCase(), since) as { calls: number; batches: number }
  return { range, calls: row.calls, batchesWithActivity: row.batches, coverage: coverageFor(range) }
}

export function usdcTopSenders(range: string, limit = 10) {
  const window = windowSeconds(range)
  if (!window) return []
  const since = nowSec() - window
  return db
    .query(
      `SELECT from_addr AS address, COUNT(*) AS transfers, SUM(usdc) AS volume FROM transfers
       WHERE kind = 'erc20' AND ts >= ? GROUP BY from_addr ORDER BY volume DESC LIMIT ?`,
    )
    .all(since, limit) as Array<{ address: string; transfers: number; volume: number }>
}

/** Set only by the serverless deployment, where indexed history is a labelled snapshot. */
export const snapshotInfo = (): { at: string } | null => null

/** Serverless build only: last known active-token scan, labelled as a snapshot. */
export const tokensSnapshot = (): unknown => null
