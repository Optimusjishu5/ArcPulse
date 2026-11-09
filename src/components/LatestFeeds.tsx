import { Card, AddressLink, Badge, ErrorState, Skeleton, TxLink, type Nav } from '@/components/ui'
import { useApi } from '@/lib/api'
import { blockUrl, fmtInt, fmtRaw, TX_TYPE_LABEL, timeAgo } from '@/lib/format'

interface Block {
  number: number
  timestamp: number
  txCount: number
  gasUsed: number
  gasLimit: number
}

export interface LiveTx {
  hash: string
  block: number
  timestamp: number
  from: string
  to: string | null
  type: string
  usdcTransfer: { to: string; raw: string } | null
  nativeValueRaw: string
  status: 'success' | 'failed' | 'unknown'
  feeNativeRaw: string | null
}

export function LatestBlocks() {
  const { data, error, refetch } = useApi<Block[]>('/api/blocks?limit=12', { refetchMs: 4000 })
  return (
    <Card title="Latest blocks" subtitle="Read live from Arc Mainnet">
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Block</th><th>Age</th><th className="text-right">Txs</th><th className="text-right">Gas used</th></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.number}>
                  <td><a className="link mono" target="_blank" rel="noopener noreferrer" href={blockUrl(b.number)}>#{fmtInt(b.number)}</a></td>
                  <td className="text-[var(--subtle)]">{timeAgo(b.timestamp)}</td>
                  <td className="text-right">{b.txCount}</td>
                  <td className="text-right">{((b.gasUsed / b.gasLimit) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function TxAmount({ tx }: { tx: Pick<LiveTx, 'type' | 'usdcTransfer' | 'nativeValueRaw'> }) {
  if (tx.type === 'usdc-transfer' && tx.usdcTransfer) return <span>{fmtRaw(tx.usdcTransfer.raw, 6, 2)} <span className="text-[var(--subtle)]">USDC (ERC-20)</span></span>
  if (BigInt(tx.nativeValueRaw) > 0n) return <span>{fmtRaw(tx.nativeValueRaw, 18, 4)} <span className="text-[var(--subtle)]">USDC (native)</span></span>
  return <span className="text-[var(--subtle)]">n/a</span>
}

export function LatestTxs({ nav }: { nav: Nav }) {
  const { data, error, refetch } = useApi<LiveTx[]>('/api/txs?limit=12', { refetchMs: 5000 })
  return (
    <Card title="Latest transactions" subtitle="Native and ERC-20 USDC amounts are labelled separately">
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Tx</th><th>Type</th><th>From</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.hash}>
                  <td><TxLink hash={t.hash} nav={nav} /></td>
                  <td><Badge tone={t.type === 'contract-call' || t.type === 'creation' ? 'accent' : 'neutral'}>{TX_TYPE_LABEL[t.type] ?? t.type}</Badge></td>
                  <td><AddressLink address={t.from} nav={nav} /></td>
                  <td className="text-right"><TxAmount tx={t} /></td>
                  <td><Badge tone={t.status === 'success' ? 'good' : t.status === 'failed' ? 'bad' : 'warn'}>{t.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
