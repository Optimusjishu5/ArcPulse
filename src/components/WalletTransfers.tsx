import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { TokenLogo } from '@/components/TokenLogo'
import { getUsdc } from '@/onchain-facts'
import { AddressLink, Badge, Card, Empty, ErrorState, Segmented, Skeleton, TxLink, type Nav } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { fmtDateTime, fmtInt, fmtRaw, timeAgo } from '@/lib/format'

export interface WalletEvent {
  txHash: string
  logIndex: number
  block: number
  timestamp: number | null
  direction: 'in' | 'out' | 'self'
  counterparty: string
  asset: 'native-usdc' | 'erc20-usdc' | 'token'
  token: string | null
  symbol: string | null
  decimals: number | null
  raw: string
}

const usdcAddress = getUsdc(5042)?.address ?? ''

const ASSET_LABEL = { 'native-usdc': 'Native USDC', 'erc20-usdc': 'ERC-20 USDC', token: 'Token' } as const

export function WalletTransfers({ address, nav, events, loading, error, scannedFrom, hasMore, onMore, onRetry }: { address: string; nav: Nav; events: WalletEvent[]; loading: boolean; error: ApiError | undefined; scannedFrom: number | null; hasMore: boolean; onMore: () => void; onRetry: () => void }) {
  const [asset, setAsset] = useState<'all' | WalletEvent['asset']>('all')
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const shown = events.filter((e) => (asset === 'all' || e.asset === asset) && (dir === 'all' || e.direction === dir))
  const sum = (a: WalletEvent['asset'], d: 'in' | 'out') =>
    events.filter((e) => e.asset === a && e.direction === d && e.decimals !== null).reduce((n, e) => n + BigInt(e.raw), 0n)

  return (
    <Card title="Transfers" subtitle={`Incoming and outgoing Transfer events for ${address.slice(0, 8)}…. Native and ERC-20 USDC are separate events.`}>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-3">
        <Segmented label="Asset" value={asset} onChange={setAsset} options={[{ id: 'all', label: 'All' }, { id: 'erc20-usdc', label: 'ERC-20 USDC' }, { id: 'native-usdc', label: 'Native USDC' }, { id: 'token', label: 'Other tokens' }]} />
        <Segmented label="Direction" value={dir} onChange={setDir} options={[{ id: 'all', label: 'In + out' }, { id: 'in', label: 'Incoming' }, { id: 'out', label: 'Outgoing' }]} />
      </div>
      {events.length > 0 && (
        <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-2xl bg-field p-3">
            <div className="label">ERC-20 USDC in the loaded events</div>
            <div className="num mt-1">In {fmtRaw(sum('erc20-usdc', 'in'), 6, 2)} · Out {fmtRaw(sum('erc20-usdc', 'out'), 6, 2)}</div>
          </div>
          <div className="rounded-2xl bg-field p-3">
            <div className="label">Native USDC in the loaded events</div>
            <div className="num mt-1">In {fmtRaw(sum('native-usdc', 'in'), 18, 4)} · Out {fmtRaw(sum('native-usdc', 'out'), 18, 4)}</div>
          </div>
        </div>
      )}
      {error && events.length === 0 ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : loading && events.length === 0 ? (
        <Skeleton rows={6} />
      ) : shown.length === 0 ? (
        <Empty>{events.length === 0 ? 'No transfers found in the scanned blocks.' : 'No loaded transfers match these filters.'}{hasMore ? ' Scan older blocks to look further back.' : ''}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Time</th><th>Direction</th><th>Asset</th><th className="text-right">Amount</th><th>Counterparty</th><th>Tx</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={`${e.txHash}:${e.logIndex}`}>
                  <td className="text-[var(--subtle)]" title={fmtDateTime(e.timestamp)}>{timeAgo(e.timestamp)}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 font-semibold ${e.direction === 'in' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                      {e.direction === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                      {e.direction === 'self' ? 'self' : e.direction}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <TokenLogo address={e.token ?? usdcAddress} symbol={e.symbol} size={22} />
                      <Badge tone={e.asset === 'token' ? 'neutral' : 'accent'}>{e.asset === 'token' ? e.symbol ?? 'Token' : ASSET_LABEL[e.asset]}</Badge>
                    </div>
                  </td>
                  <td className="text-right" title={`${e.raw} raw`}>{e.decimals === null ? `${e.raw} (raw)` : fmtRaw(e.raw, e.decimals, e.asset === 'token' ? 4 : e.asset === 'native-usdc' ? 4 : 2)}</td>
                  <td><AddressLink address={e.counterparty} nav={nav} /></td>
                  <td><TxLink hash={e.txHash} nav={nav} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && events.length > 0 && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error.message}</p>}
      <div className="mt-4 flex flex-col items-center gap-2">
        {scannedFrom !== null && <p className="text-xs text-[var(--subtle)]">Scanned from block #{fmtInt(scannedFrom)} to the chain head.</p>}
        {hasMore && (
          <button className="btn btn-ghost" disabled={loading} onClick={onMore}>{loading ? 'Scanning…' : 'Scan older blocks'}</button>
        )}
        {!hasMore && events.length > 0 && !loading && <p className="text-xs text-[var(--subtle)]">Reached the first block. This is the full history.</p>}
      </div>
    </Card>
  )
}
