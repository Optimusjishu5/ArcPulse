/** Serverless build: there is no running indexer. Status reports the snapshot that was bundled with this deployment. */
import { snapshot } from './snapshot'

const WINDOWS: Record<string, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400 }

export const windowSeconds = (range: string): number | null => WINDOWS[range] ?? null
export const coverageFor = (range: string): number => snapshot.coverage[range] ?? 0
export const startIndexer = (): void => undefined
export const requestReindex = (): number => 0

export function indexerStatus() {
  return {
    batchesIndexed: 0,
    batchesPerMinute: 0,
    historyDays: 90,
    historyTargetCovered: 0,
    oldestIndexedTimestamp: null,
    lagBlocks: null,
    errorsTotal: 0,
    lastError: null,
    transferStoreFloorUsdc: 1000,
    ...(snapshot.indexer ?? {}),
    enabled: false,
    running: false,
    snapshot: true,
    snapshotAt: snapshot.at,
    headBlock: snapshot.headBlock,
    transfersStored: snapshot.whales.length,
    coverage: { '24h': coverageFor('24h'), '7d': coverageFor('7d'), '30d': coverageFor('30d'), '90d': coverageFor('90d') },
  }
}
