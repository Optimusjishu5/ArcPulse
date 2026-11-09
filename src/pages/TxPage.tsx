import { ExternalLink } from 'lucide-react'
import { AddressLink, Badge, Card, ErrorState, Skeleton, type Nav } from '@/components/ui'
import { ApiError, useApi } from '@/lib/api'
import { fmtDateTime, fmtInt, fmtRaw, isHash, TX_TYPE_LABEL, txUrl } from '@/lib/format'

interface Tx {
  hash: string
  status: 'success' | 'failed' | 'pending'
  block: number | null
  timestamp: number | null
  confirmations: number
  from: string
  to: string | null
  contractCreated: string | null
  type: string
  selector: string | null
  nativeValueRaw: string
  gasLimit: number
  gasUsed: number | null
  feeNativeRaw: string | null
  nonce: number
  logCount: number
  transfers: Array<{ kind: 'native' | 'usdc-erc20' | 'token'; token: string | null; symbol: string | null; decimals: number | null; from: string; to: string; raw: string; logIndex: number }>
}

const KIND_LABEL = { native: 'Native USDC', 'usdc-erc20': 'ERC-20 USDC', token: 'Token' } as const

export default function TxPage({ nav, hash }: { nav: Nav; hash: string }) {
  const valid = isHash(hash)
  const { data: tx, error, refetch } = useApi<Tx>(valid ? `/api/tx/${hash.toLowerCase()}` : null)
  if (!valid) return <ErrorState error={new ApiError(400, 'BAD_HASH', 'That is not a valid transaction hash.')} />
  if (error) return <ErrorState error={error} onRetry={refetch} />
  if (!tx) return <Skeleton rows={6} />
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-0 sm:flex-row sm:gap-6">
      <dt className="label w-44 shrink-0 pt-0.5">{k}</dt>
      <dd className="min-w-0 break-all text-sm">{v}</dd>
    </div>
  )
  return (
    <div className="space-y-6">
      <h1 className="display text-3xl font-bold text-balance">Transaction</h1>
      <Card
        title={TX_TYPE_LABEL[tx.type] ?? tx.type}
        subtitle={<span className="mono break-all">{tx.hash}</span>}
        action={<div className="flex items-center gap-2"><Badge tone={tx.status === 'success' ? 'good' : tx.status === 'failed' ? 'bad' : 'warn'}>{tx.status}</Badge><a className="btn btn-ghost !min-h-9" href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer">Explorer <ExternalLink size={14} /></a></div>}
      >
        <dl>
          {row('Block', tx.block !== null ? `#${fmtInt(tx.block)} · ${fmtInt(tx.confirmations)} confirmations` : 'Pending')}
          {row('Time', fmtDateTime(tx.timestamp))}
          {row('From', <AddressLink address={tx.from} nav={nav} label={tx.from} />)}
          {row('To', tx.to ? <AddressLink address={tx.to} nav={nav} label={tx.to} /> : tx.contractCreated ? <>Created <AddressLink address={tx.contractCreated} nav={nav} label={tx.contractCreated} /></> : 'n/a')}
          {tx.selector && row('Method id', <span className="mono">{tx.selector}</span>)}
          {row('Native value', `${fmtRaw(tx.nativeValueRaw, 18, 6)} USDC (native view, 18 decimals)`)}
          {row('Gas', tx.gasUsed !== null ? `${fmtInt(tx.gasUsed)} used of ${fmtInt(tx.gasLimit)}` : `${fmtInt(tx.gasLimit)} limit`)}
          {row('Fee paid', tx.feeNativeRaw ? `${fmtRaw(tx.feeNativeRaw, 18, 6)} USDC (native view)` : 'n/a')}
          {row('Nonce', fmtInt(tx.nonce))}
        </dl>
      </Card>
      <Card title="Decoded transfers" subtitle={`${tx.logCount} logs in the receipt. Native and ERC-20 USDC events are listed separately.`}>
        {tx.transfers.length === 0 ? (
          <p className="text-sm text-[var(--subtle)]">No Transfer events in this transaction.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Asset</th><th>From</th><th>To</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {tx.transfers.map((t) => (
                  <tr key={t.logIndex}>
                    <td><Badge tone={t.kind === 'token' ? 'neutral' : 'accent'}>{t.kind === 'token' ? t.symbol ?? 'Token' : KIND_LABEL[t.kind]}</Badge></td>
                    <td><AddressLink address={t.from} nav={nav} /></td>
                    <td><AddressLink address={t.to} nav={nav} /></td>
                    <td className="text-right">{t.decimals === null ? `${t.raw} (raw)` : fmtRaw(t.raw, t.decimals, t.kind === 'native' ? 6 : 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
