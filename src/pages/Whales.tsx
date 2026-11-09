import { useState } from 'react'
import { AddressLink, Badge, Card, CoverageBar, Empty, ErrorState, Segmented, SnapshotNote, Skeleton, Stat, TxLink, type Nav } from '@/components/ui'
import { ApiError, apiGet, useApi } from '@/lib/api'
import { fmtCompact, fmtDateTime, fmtInt, fmtRaw, timeAgo } from '@/lib/format'

interface Transfer {
  txHash: string
  logIndex: number
  kind: 'native' | 'erc20'
  block: number
  timestamp: number
  from: string
  to: string
  raw: string
  decimals: number
  status: 'success'
}

interface KindSummary {
  count: number
  volume: number
  largest: number
}

interface WhaleData {
  minUsdc: number
  storeFloorUsdc: number
  coverage: number
  transfers: Transfer[]
  nextCursor: string | null
  summary: { native: KindSummary; erc20: KindSummary }
}

const THRESHOLDS = [1_000, 10_000, 100_000, 1_000_000]

export default function Whales({ nav, search }: { nav: Nav; search: URLSearchParams }) {
  const [min, setMin] = useState(Number(search.get('min')) || 10_000)
  const [custom, setCustom] = useState('')
  const [kind, setKind] = useState<'all' | 'native' | 'erc20'>('all')
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h')
  const [paged, setPaged] = useState<{ key: string; rows: Transfer[]; cursor: string | null }>({ key: '', rows: [], cursor: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  const base = `/api/whales?min=${min}&kind=${kind}&range=${range}&limit=40`
  const { data, error, refetch, meta } = useApi<WhaleData>(base, { refetchMs: 6000 })

  // Older pages belong to the filter set they were loaded under; a filter change discards them.
  const key = `${min}|${kind}|${range}`
  const older = paged.key === key ? paged.rows : []
  const nextCursor = paged.key === key ? paged.cursor : data?.nextCursor ?? null
  const rows = data ? [...data.transfers, ...older.filter((o) => !data.transfers.some((t) => t.txHash === o.txHash && t.logIndex === o.logIndex))] : []

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = (await apiGet<WhaleData>(`${base}&cursor=${nextCursor}`)).data
      setPaged((prev) => ({ key, rows: [...(prev.key === key ? prev.rows : []), ...page.transfers], cursor: page.nextCursor }))
    } catch (e) {
      setMoreError(e instanceof ApiError ? e.message : 'Could not load more')
    } finally {
      setLoadingMore(false)
    }
  }

  const applyCustom = () => {
    const v = Number(custom)
    if (Number.isFinite(v) && v > 0) setMin(Math.max(v, data?.storeFloorUsdc ?? 1000))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-balance sm:text-4xl">Whale tracker</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--subtle)] text-pretty">
          Large USDC transfers decoded from Arc Mainnet Transfer events. Native USDC (18 decimals) and ERC-20 USDC (6 decimals) are tracked separately because one transaction can emit both.
        </p>
      </div>

      <Card>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="label">Minimum transfer (USDC)</div>
            <div className="flex flex-wrap items-center gap-2">
              {THRESHOLDS.map((t) => (
                <button key={t} className="chip" aria-pressed={min === t} onClick={() => setMin(t)}>
                  {fmtCompact(t, 0)}+
                </button>
              ))}
              <input className="input !w-36" inputMode="decimal" placeholder="Custom" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyCustom()} aria-label="Custom minimum in USDC" />
              <button className="btn btn-ghost !min-h-9" onClick={applyCustom}>Apply</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="space-y-2">
              <div className="label">Transfer type</div>
              <Segmented label="Transfer type" value={kind} onChange={setKind} options={[{ id: 'all', label: 'All' }, { id: 'native', label: 'Native USDC' }, { id: 'erc20', label: 'ERC-20 USDC' }]} />
            </div>
            <div className="space-y-2">
              <div className="label">Window</div>
              <Segmented label="Window" value={range} onChange={setRange} options={[{ id: '24h', label: '24H' }, { id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '90d', label: '90D' }]} />
            </div>
          </div>
          {data && <CoverageBar coverage={data.coverage} label={range.toUpperCase()} />}
          {data && <p className="text-xs text-[var(--subtle)]">The indexer stores transfers of {fmtInt(data.storeFloorUsdc)} USDC or more, so lower thresholds are raised to that floor.</p>}
        </div>
      </Card>

      <SnapshotNote at={meta?.snapshotAt} />

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Native transfers" value={fmtInt(data.summary.native.count)} sub={`${fmtCompact(data.summary.native.volume, 2)} USDC moved`} />
            <Stat label="Largest native" value={fmtCompact(data.summary.native.largest, 2)} sub="USDC, 18-decimal view" />
            <Stat label="ERC-20 transfers" value={fmtInt(data.summary.erc20.count)} sub={`${fmtCompact(data.summary.erc20.volume, 2)} USDC moved`} />
            <Stat label="Largest ERC-20" value={fmtCompact(data.summary.erc20.largest, 2)} sub="USDC, 6-decimal view" />
          </div>
          <Card title={`Transfers of ${fmtInt(data.minUsdc)} USDC or more`} subtitle={meta ? `Newest first. Indexed through the chain head (block ${meta.headBlock ? fmtInt(meta.headBlock) : 'n/a'}).` : undefined}>
            {rows.length === 0 ? (
              <Empty>No transfers at this threshold in the indexed part of this window yet. Lower the minimum or choose a longer window.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Time</th><th>Type</th><th className="text-right">Amount (USDC)</th><th>From</th><th>To</th><th>Tx</th><th>Block</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={`${t.txHash}:${t.logIndex}`}>
                        <td title={fmtDateTime(t.timestamp)} className="text-[var(--subtle)]">{timeAgo(t.timestamp)}</td>
                        <td><Badge tone={t.kind === 'native' ? 'accent' : 'neutral'}>{t.kind === 'native' ? 'Native' : 'ERC-20'}</Badge></td>
                        <td className="text-right font-semibold" title={`${t.raw} raw, ${t.decimals} decimals`}>{fmtRaw(t.raw, t.decimals, 2)}</td>
                        <td><AddressLink address={t.from} nav={nav} /></td>
                        <td><AddressLink address={t.to} nav={nav} /></td>
                        <td><TxLink hash={t.txHash} nav={nav} /></td>
                        <td className="mono text-[var(--subtle)]">{fmtInt(t.block)}</td>
                        <td><Badge tone="good">success</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {moreError && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{moreError}</p>}
            {nextCursor && (
              <div className="mt-4 flex justify-center">
                <button className="btn btn-ghost" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load older transfers'}</button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
