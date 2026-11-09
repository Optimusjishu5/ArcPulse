/**
 * Arc Mainnet indexer.
 *
 * The chain produces roughly two blocks per second, so history is indexed in fixed 250-block batches.
 * Each batch is written atomically and idempotently (INSERT OR REPLACE keyed by batch id), which makes
 * reprocessing and duplicate delivery safe. Workers always take the newest missing batch first, so live
 * data arrives first and history fills backwards until INDEX_HISTORY_DAYS is covered. A separate tail
 * scanner stores large transfers from the not-yet-complete batch so the whale feed stays current.
 */
import { Amount } from '../src/onchain-money'
import { blockTimestamps, decodeTransfer, getBlocks, getLogsAdaptive, headInfo, type RpcTx } from './chain'
import { db, getMeta, setMeta } from './db'
import { ARC, CONFIG, TRANSFER_TOPIC } from './env'
import { info, reportError } from './log'
import { hexToBigInt, hexToNumber, runBackground } from './rpc'

const B = CONFIG.batchBlocks
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const units = (raw: bigint, decimals: number): number => Number(Amount.fromRaw(raw, decimals).toString())
const nowSec = () => Math.floor(Date.now() / 1000)

const have = new Set<number>()
const inflight = new Set<number>()
const retryAt = new Map<number, number>()
const failCount = new Map<number, number>()
const completions: number[] = []
let floorId = -1
let running = false
let latestHead = 0
let latestHeadTs = 0
let lastError: { at: string; message: string } | null = null
let errorsTotal = 0
let tailScanned = 0
let tailError: string | null = null

const insertBatch = db.query(`INSERT OR REPLACE INTO batches
  (id,start_block,end_block,ts_start,ts_end,blocks,txs,gas_used,gas_limit,base_fee_sum,creations,native_count,native_vol,erc20_count,erc20_vol,indexed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const insertTransfer = db.query(
  'INSERT OR REPLACE INTO transfers (tx_hash,log_index,kind,block,ts,from_addr,to_addr,raw,usdc) VALUES (?,?,?,?,?,?,?,?,?)',
)
const insertActivity = db.query('INSERT OR REPLACE INTO contract_activity (batch_id,address,tx_count) VALUES (?,?,?)')

interface StoredBatch {
  tsEnd: number
}

export async function processBatch(id: number): Promise<StoredBatch> {
  const start = id * B
  const end = start + B - 1
  const numbers = Array.from({ length: B }, (_, i) => start + i)
  const [blocks, logs] = await Promise.all([
    Promise.all(
      Array.from({ length: Math.ceil(B / 50) }, (_, i) => getBlocks(numbers.slice(i * 50, i * 50 + 50), true)),
    ).then((parts) => parts.flat()),
    getLogsAdaptive({ address: [ARC.usdc, ARC.nativeEmitter], topics: [TRANSFER_TOPIC] }, start, end),
  ])

  const tsByBlock = new Map<number, number>()
  let txs = 0
  let gasUsed = 0
  let gasLimit = 0
  let baseFeeSum = 0
  let creations = 0
  const activity = new Map<string, number>()
  for (const b of blocks) {
    const n = hexToNumber(b.number)
    tsByBlock.set(n, hexToNumber(b.timestamp))
    gasUsed += hexToNumber(b.gasUsed)
    gasLimit += hexToNumber(b.gasLimit)
    baseFeeSum += Number(hexToBigInt(b.baseFeePerGas))
    for (const t of b.transactions) {
      const tx = t as RpcTx
      txs += 1
      if (tx.to === null) creations += 1
      else activity.set(tx.to.toLowerCase(), (activity.get(tx.to.toLowerCase()) ?? 0) + 1)
    }
  }

  let nativeCount = 0
  let nativeVol = 0
  let erc20Count = 0
  let erc20Vol = 0
  const stored: Array<[string, number, string, number, number, string, string, string, number]> = []
  for (const log of logs) {
    if (log.removed) continue
    const t = decodeTransfer(log)
    if (!t) continue
    const decimals = t.kind === 'native' ? ARC.nativeDecimals : ARC.usdcDecimals
    if (t.kind === 'erc20' && t.token !== ARC.usdc) continue
    const value = units(t.raw, decimals)
    if (t.kind === 'native') {
      nativeCount += 1
      nativeVol += value
    } else {
      erc20Count += 1
      erc20Vol += value
    }
    if (value >= CONFIG.transferStoreFloor) {
      const ts = tsByBlock.get(t.block)
      if (ts === undefined) throw new Error(`Log in block ${t.block} outside batch ${id}`)
      stored.push([t.txHash, t.logIndex, t.kind, t.block, ts, t.from, t.to, t.raw.toString(), value])
    }
  }

  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (!first || !last) throw new Error(`Batch ${id} returned no blocks`)
  const tsStart = hexToNumber(first.timestamp)
  const tsEnd = hexToNumber(last.timestamp)
  const top = [...activity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  db.transaction(() => {
    db.query('DELETE FROM transfers WHERE block BETWEEN ? AND ?').run(start, end)
    db.query('DELETE FROM contract_activity WHERE batch_id = ?').run(id)
    for (const row of stored) insertTransfer.run(...row)
    for (const [address, count] of top) insertActivity.run(id, address, count)
    insertBatch.run(
      id, start, end, tsStart, tsEnd, blocks.length, txs, gasUsed, gasLimit, baseFeeSum, creations,
      nativeCount, nativeVol, erc20Count, erc20Vol, nowSec(),
    )
  })()
  return { tsEnd }
}

function pickNext(): number | null {
  if (latestHead === 0) return null
  const top = Math.floor((latestHead + 1) / B) - 1
  const now = Date.now()
  for (let id = top; id > floorId && id >= 0; id -= 1) {
    if (have.has(id) || inflight.has(id)) continue
    if ((retryAt.get(id) ?? 0) > now) continue
    return id
  }
  return null
}

async function worker(): Promise<void> {
  while (running) {
    const id = pickNext()
    if (id === null) {
      await sleep(2000)
      continue
    }
    inflight.add(id)
    try {
      const { tsEnd } = await runBackground(() => processBatch(id))
      have.add(id)
      failCount.delete(id)
      completions.push(Date.now())
      while (completions.length > 200) completions.shift()
      if (tsEnd < nowSec() - CONFIG.historyDays * 86400) floorId = Math.max(floorId, id)
    } catch (err) {
      errorsTotal += 1
      const fails = (failCount.get(id) ?? 0) + 1
      failCount.set(id, fails)
      retryAt.set(id, Date.now() + Math.min(60_000, 1500 * 2 ** Math.min(fails, 5)))
      lastError = { at: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) }
      // Provider rate limits are expected while backfilling: the batch is retried with backoff, not alerted on.
      if (!lastError.message.toLowerCase().includes('rate limit')) reportError('indexer', err, `batch ${id} attempt ${fails}`)
    } finally {
      inflight.delete(id)
    }
    const nearHead = latestHead - id * B < B * 3
    await sleep(nearHead ? 0 : Number(process.env.INDEX_BACKFILL_DELAY_MS ?? 150))
  }
}

/** Stores large transfers from blocks newer than the last complete batch, so the whale feed is current. */
async function tailScan(): Promise<void> {
  const head = await headInfo()
  latestHead = head.number
  latestHeadTs = head.timestamp
  const batchStart = Math.floor((head.number + 1) / B) * B
  if (tailScanned < batchStart - 1) tailScanned = batchStart - 1
  if (tailScanned >= head.number) return
  const from = tailScanned + 1
  const to = head.number
  const logs = await getLogsAdaptive({ address: [ARC.usdc, ARC.nativeEmitter], topics: [TRANSFER_TOPIC] }, from, to)
  const big = logs.flatMap((log) => {
    const t = decodeTransfer(log)
    if (!t || log.removed || (t.kind === 'erc20' && t.token !== ARC.usdc)) return []
    const value = units(t.raw, t.kind === 'native' ? ARC.nativeDecimals : ARC.usdcDecimals)
    return value >= CONFIG.transferStoreFloor ? [{ t, value }] : []
  })
  if (big.length > 0) {
    const ts = await blockTimestamps(big.map((b) => b.t.block))
    db.transaction(() => {
      for (const { t, value } of big) {
        insertTransfer.run(t.txHash, t.logIndex, t.kind, t.block, ts.get(t.block) ?? 0, t.from, t.to, t.raw.toString(), value)
      }
    })()
  }
  tailScanned = to
}

async function tailLoop(): Promise<void> {
  while (running) {
    try {
      await tailScan()
      tailError = null
    } catch (err) {
      tailError = err instanceof Error ? err.message : String(err)
      reportError('indexer-tail', err)
    }
    await sleep(2000)
  }
}

function prune(): void {
  const cutoff = nowSec() - CONFIG.historyDays * 86400
  const old = db.query('SELECT id FROM batches WHERE ts_end < ?').all(cutoff) as Array<{ id: number }>
  db.transaction(() => {
    db.query('DELETE FROM transfers WHERE ts < ?').run(cutoff)
    db.query('DELETE FROM contract_activity WHERE batch_id IN (SELECT id FROM batches WHERE ts_end < ?)').run(cutoff)
    db.query('DELETE FROM batches WHERE ts_end < ?').run(cutoff)
  })()
  for (const row of old) have.delete(row.id)
  db.exec('PRAGMA wal_checkpoint(PASSIVE)')
}

export function startIndexer(): void {
  if (!CONFIG.indexerEnabled || running) return
  running = true
  for (const row of db.query('SELECT id FROM batches').all() as Array<{ id: number }>) have.add(row.id)
  floorId = Number(getMeta('floor_id') ?? -1)
  info('indexer', 'starting', { indexedBatches: have.size, historyDays: CONFIG.historyDays, floorId })
  void tailLoop()
  for (let i = 0; i < CONFIG.backfillConcurrency; i += 1) void worker()
  setInterval(() => {
    try {
      setMeta('floor_id', String(floorId))
      prune()
    } catch (err) {
      reportError('indexer-prune', err)
    }
  }, 10 * 60_000)
}

/** Admin: mark a block range for reprocessing. Workers rebuild it idempotently. */
export function requestReindex(fromBlock: number, toBlock: number): number {
  const lo = Math.floor(fromBlock / B)
  const hi = Math.floor(toBlock / B)
  let count = 0
  for (let id = lo; id <= hi; id += 1) {
    if (have.delete(id)) count += 1
    retryAt.delete(id)
  }
  return count
}

const WINDOWS: Record<string, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400 }

export function windowSeconds(range: string): number | null {
  return WINDOWS[range] ?? null
}

export function coverageFor(range: string): number {
  const w = WINDOWS[range]
  if (!w) return 0
  const since = nowSec() - w
  const row = db.query('SELECT COALESCE(SUM(ts_end - ts_start + 1), 0) AS covered FROM batches WHERE ts_start >= ?').get(since) as {
    covered: number
  }
  return Math.min(1, row.covered / w)
}

export function indexerStatus() {
  const agg = db
    .query('SELECT MIN(ts_start) AS oldest, MAX(ts_end) AS newest, MAX(end_block) AS newestBlock, MIN(start_block) AS oldestBlock, COUNT(*) AS n FROM batches')
    .get() as { oldest: number | null; newest: number | null; newestBlock: number | null; oldestBlock: number | null; n: number }
  const stored = db.query('SELECT COUNT(*) AS n FROM transfers').get() as { n: number }
  const recent = completions.filter((t) => Date.now() - t < 5 * 60_000).length
  const cutoff = nowSec() - CONFIG.historyDays * 86400
  const covered = agg.oldest === null ? 0 : Math.min(1, Math.max(0, (nowSec() - agg.oldest) / (nowSec() - cutoff)))
  return {
    enabled: CONFIG.indexerEnabled,
    running,
    headBlock: latestHead || null,
    headTimestamp: latestHeadTs || null,
    newestIndexedBlock: agg.newestBlock,
    oldestIndexedBlock: agg.oldestBlock,
    oldestIndexedTimestamp: agg.oldest,
    newestIndexedTimestamp: agg.newest,
    lagBlocks: agg.newestBlock !== null && latestHead ? Math.max(0, latestHead - agg.newestBlock) : null,
    batchBlocks: B,
    batchesIndexed: agg.n,
    inFlight: inflight.size,
    batchesPerMinute: Math.round((recent / 5) * 10) / 10,
    historyDays: CONFIG.historyDays,
    historyTargetCovered: covered,
    historyComplete: floorId >= 0,
    transferStoreFloorUsdc: CONFIG.transferStoreFloor,
    transfersStored: stored.n,
    tailScannedBlock: tailScanned || null,
    tailError,
    errorsTotal,
    lastError,
    coverage: { '24h': coverageFor('24h'), '7d': coverageFor('7d'), '30d': coverageFor('30d'), '90d': coverageFor('90d') },
  }
}
