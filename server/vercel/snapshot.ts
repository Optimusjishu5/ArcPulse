import raw from './snapshot.generated.json'

export interface SnapshotWhale {
  txHash: string
  logIndex: number
  kind: 'native' | 'erc20'
  block: number
  timestamp: number
  from: string
  to: string
  raw: string
  decimals: number
  usdc: number
  status: 'success'
}

interface Snapshot {
  at: string | null
  headBlock: number | null
  coverage: Record<string, number>
  indexer: Record<string, unknown> | null
  analytics: Record<string, unknown>
  top: Record<string, { contracts: Array<{ address: string; calls: number }>; note: string }>
  usdcSenders: Record<string, Array<{ address: string; transfers: number; volume: number }>>
  whales: SnapshotWhale[]
  tokens: unknown
}

export const snapshot = raw as unknown as Snapshot
