import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Blocks, Cable, Coins, Gauge as GaugeIcon, Layers, Info, TrendingDown, TrendingUp } from 'lucide-react'
import { GasEstimator } from '@/components/GasEstimator'
import { LatestBlocks, LatestTxs, type LiveTx } from '@/components/LatestFeeds'
import { Card, ErrorState, Segmented, SnapshotNote, Skeleton, type Nav } from '@/components/ui'
import { Donut, GlowChart, RainbowBars, Sparkline, Gauge } from '@/components/viz'
import { useApi } from '@/lib/api'
import { fmtCompact, fmtInt, fmtRaw } from '@/lib/format'

type Range = '24h' | '7d' | '30d' | '90d'

interface Network {
  head: { number: number; timestamp: number }
  blockTimeSeconds: number
  txPerSecond: number
  gasUtilization: number
  baseFeeGwei: number
  transferCostNativeRaw: string
  nativeDecimals: number
}

interface Point {
  t: number
  txs: number
  gasUtilization: number
  nativeTransfers: number
  nativeVolumeUsdc: number
  erc20Transfers: number
  erc20VolumeUsdc: number
}

interface Analytics {
  bucketSeconds: number
  coverage: number
  series: Point[]
  totals: {
    txs: number
    blocks: number
    contractCreations: number
    nativeTransfers: number
    nativeVolumeUsdc: number
    erc20Transfers: number
    erc20VolumeUsdc: number
    gasUtilization: number
  }
}

interface Health {
  providers: Array<{ name: string; chainVerified: boolean; chainMismatch: boolean; healthy: boolean; lastLatencyMs: number | null }>
  indexer: { running: boolean; snapshot?: boolean; batchesPerMinute: number; lagBlocks: number | null }
}

interface TopContracts {
  contracts: Array<{ address: string; calls: number }>
}

const PROVIDER_LABEL: Record<string, string> = { primary: 'Primary RPC', 'sandbox-proxy': 'Primary RPC', fallback: 'Fallback RPC', public: 'Public RPC' }

/** Change between the first and second half of the window. Null when the first half is empty. */
function halfDelta(values: number[]): number | null {
  if (values.length < 4) return null
  const mid = Math.floor(values.length / 2)
  const a = values.slice(0, mid).reduce((n, v) => n + v, 0)
  const b = values.slice(mid).reduce((n, v) => n + v, 0)
  return a > 0 ? ((b - a) / a) * 100 : null
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  return (
    <span title="Second half of the window compared with the first half" className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${up ? 'bg-arc-success/12 text-[var(--success)]' : 'bg-arc-danger/12 text-[var(--danger)]'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function Kpi({ i, icon, title, hint, value, unit, badge, children }: { i: number; icon: ReactNode; title: string; hint: string; value: ReactNode; unit?: string; badge?: ReactNode; children?: ReactNode }) {
  return (
    <section className="card rise flex flex-col justify-between gap-3 p-4 sm:p-5" style={{ ['--i' as string]: i }}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-soft text-[var(--accent)]">{icon}</span>
          <h3 className="truncate text-sm font-semibold text-[var(--ink-2)]">{title}</h3>
        </div>
        <span title={hint} className="text-[var(--subtle)]"><Info size={14} aria-label={hint} /></span>
      </header>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="display num text-[2rem] font-semibold leading-none">{value}{unit && <span className="ml-1.5 text-sm font-medium text-[var(--subtle)]">{unit}</span>}</div>
          <div className="mt-2 min-h-5">{badge}</div>
        </div>
      </div>
      {children}
    </section>
  )
}

function csv(an: Analytics, range: string) {
  const rows = ['period_start_utc,transactions,gas_utilization,native_usdc_transfers,native_usdc_volume,erc20_usdc_transfers,erc20_usdc_volume']
  for (const p of an.series) rows.push([new Date(p.t * 1000).toISOString(), p.txs, p.gasUtilization.toFixed(6), p.nativeTransfers, p.nativeVolumeUsdc.toFixed(6), p.erc20Transfers, p.erc20VolumeUsdc.toFixed(6)].join(','))
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `arcpulse-${range}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function TypeMix() {
  const { data, error, refetch } = useApi<LiveTx[]>('/api/txs?limit=50', { refetchMs: 8000 })
  const slices = useMemo(() => {
    const count = (t: string) => data?.filter((x) => x.type === t).length ?? 0
    return [
      { label: 'Native USDC transfer', value: count('native-transfer'), color: 'var(--cyan)' },
      { label: 'ERC-20 USDC transfer', value: count('usdc-transfer'), color: 'var(--violet)' },
      { label: 'Contract call', value: count('contract-call'), color: 'var(--amber)' },
      { label: 'Contract creation', value: count('creation'), color: 'var(--pink)' },
      { label: 'Zero-value tx', value: count('plain'), color: 'var(--blue)' },
    ]
  }, [data])
  return (
    <Card title="Transaction mix" subtitle="Latest 50 transactions on Arc Mainnet" className="defer rise">
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton rows={4} /> : <Donut slices={slices} centerValue={String(data.length)} centerLabel="latest txs" />}
    </Card>
  )
}

function Pill({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ok ? 'bg-arc-success/12 text-[var(--success)]' : 'bg-arc-warn/12 text-[var(--warn)]'}`}>
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

function Connections({ coverage, range }: { coverage: number | undefined; range: string }) {
  const { data, error, refetch } = useApi<Health>('/api/health', { refetchMs: 20_000 })
  return (
    <Card title="System connections" subtitle="Every RPC provider must return chain ID 0x13B2 before it serves data" className="defer rise lg:col-span-2">
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Connection</th><th>Chain check</th><th>Latency / progress</th><th className="text-right">Status</th></tr></thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.name}>
                  <td className="font-semibold">{PROVIDER_LABEL[p.name] ?? p.name}</td>
                  <td><Pill ok={p.chainVerified && !p.chainMismatch} text={p.chainMismatch ? 'Wrong chain' : p.chainVerified ? 'Chain 5042' : 'Pending'} /></td>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-gradient-to-r from-[var(--cyan)] to-[var(--violet)]" style={{ width: `${Math.min(100, ((p.lastLatencyMs ?? 0) / 600) * 100)}%` }} /></div>
                      <span className="num text-[var(--subtle)]">{p.lastLatencyMs !== null ? `${p.lastLatencyMs} ms` : 'n/a'}</span>
                    </div>
                  </td>
                  <td className="text-right"><Pill ok={p.healthy} text={p.healthy ? 'Healthy' : 'Cooling down'} /></td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Block indexer</td>
                <td><Pill ok={data.indexer.running || data.indexer.snapshot === true} text={data.indexer.snapshot ? 'Snapshot' : data.indexer.running ? 'Running' : 'Stopped'} /></td>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-gradient-to-r from-[var(--amber)] to-[var(--pink)]" style={{ width: `${Math.round((coverage ?? 0) * 100)}%` }} /></div>
                    <span className="num text-[var(--subtle)]">{Math.round((coverage ?? 0) * 100)}% of {range.toUpperCase()}</span>
                  </div>
                </td>
                <td className="text-right"><Pill ok={(coverage ?? 0) >= 0.97} text={data.indexer.snapshot ? ((coverage ?? 0) >= 0.97 ? 'Snapshot complete' : 'Snapshot partial') : (coverage ?? 0) >= 0.97 ? 'Complete' : 'Backfilling'} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function Overview({ nav }: { nav: Nav }) {
  const [range, setRange] = useState<Range>('24h')
  const [metric, setMetric] = useState<'count' | 'volume'>('count')
  const net = useApi<Network>('/api/network', { refetchMs: 5000 })
  const an = useApi<Analytics>(`/api/analytics?range=${range}`, { refetchMs: 30_000, keepPrevious: true })
  const top = useApi<TopContracts>(`/api/contracts/top?range=${range}`, { refetchMs: 60_000, keepPrevious: true })
  const n = net.data
  const a = an.data

  const spark = useMemo(
    () => ({
      txs: a?.series.map((p) => p.txs) ?? [],
      util: a?.series.map((p) => p.gasUtilization) ?? [],
      nat: a?.series.map((p) => p.nativeVolumeUsdc) ?? [],
      erc: a?.series.map((p) => p.erc20VolumeUsdc) ?? [],
    }),
    [a],
  )
  const flow = useMemo(
    () =>
      a
        ? [
            { name: 'Native USDC', color: 'var(--cyan)', data: a.series.map((p) => ({ t: p.t, v: metric === 'count' ? p.nativeTransfers : p.nativeVolumeUsdc })) },
            { name: 'ERC-20 USDC', color: 'var(--violet)', data: a.series.map((p) => ({ t: p.t, v: metric === 'count' ? p.erc20Transfers : p.erc20VolumeUsdc })) },
          ]
        : [],
    [a, metric],
  )
  const bars = useMemo(() => a?.series.map((p) => ({ t: p.t, v: p.txs })) ?? [], [a])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--subtle)]">Arc Mainnet, chain 5042. Live reads plus indexed history.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="range">Time range</label>
          <select id="range" className="input !min-h-10 !w-auto !rounded-xl !pr-8 font-semibold" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button className="btn btn-ghost !min-h-10 !rounded-xl" disabled={!a} onClick={() => a && csv(a, range)}><ArrowDownToLine size={15} /> Export CSV</button>
        </div>
      </div>

      <SnapshotNote at={an.meta?.snapshotAt} />

      {net.error ? (
        <ErrorState error={net.error} onRetry={net.refetch} />
      ) : (
        <div className="card rise grid grid-cols-2 gap-px overflow-hidden !p-0 lg:grid-cols-4" style={{ ['--i' as string]: 0 }}>
          {[
            { l: 'Latest block', v: n ? `#${fmtInt(n.head.number)}` : '', s: n ? `${n.blockTimeSeconds.toFixed(2)}s block time` : '' },
            { l: 'Throughput', v: n ? `${n.txPerSecond.toFixed(1)} tx/s` : '', s: 'last 50 blocks' },
            { l: 'Base fee', v: n ? `${n.baseFeeGwei.toFixed(1)} Gwei` : '', s: n ? `${(n.gasUtilization * 100).toFixed(1)}% block fullness` : '' },
            { l: 'Transfer cost', v: n ? fmtRaw(n.transferCostNativeRaw, n.nativeDecimals, 5) : '', s: 'native USDC per 21,000 gas' },
          ].map((x) => (
            <div key={x.l} className="bg-kpi p-4">
              <div className="label">{x.l}</div>
              {n ? <div className="display num mt-1.5 text-xl font-semibold">{x.v}</div> : <div className="skeleton mt-2 h-6 w-24" />}
              <div className="mt-0.5 text-xs text-[var(--subtle)]">{x.s}</div>
            </div>
          ))}
        </div>
      )}

      {an.error ? (
        <ErrorState error={an.error} onRetry={an.refetch} />
      ) : !a ? (
        <Skeleton rows={6} />
      ) : (
        <div className={`space-y-4 transition-opacity duration-200 ${an.placeholder ? 'opacity-50' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi i={1} icon={<GaugeIcon size={16} />} title="Block fullness" hint="Average share of the block gas limit used in this window" value={`${(a.totals.gasUtilization * 100).toFixed(1)}%`} badge={<span className="text-xs text-[var(--subtle)]">{fmtInt(a.totals.blocks)} blocks indexed</span>}>
              <div className="-mx-1 flex items-center justify-between gap-2"><Sparkline data={spark.util} color="var(--violet)" /><Gauge value={a.totals.gasUtilization} label="Average block fullness" /></div>
            </Kpi>
            <Kpi i={2} icon={<Layers size={16} />} title="Transactions" hint="All transactions in indexed blocks" value={fmtCompact(a.totals.txs, 2)} badge={<Delta pct={halfDelta(spark.txs)} />}>
              <Sparkline data={spark.txs} color="var(--cyan)" />
            </Kpi>
            <Kpi i={3} icon={<Coins size={16} />} title="Native USDC volume" hint="Native Transfer events, 18-decimal accounting. Separate from ERC-20 volume" value={fmtCompact(a.totals.nativeVolumeUsdc, 2)} unit="USDC" badge={<span className="inline-flex items-center gap-2 text-xs text-[var(--subtle)]"><Delta pct={halfDelta(spark.nat)} />{fmtInt(a.totals.nativeTransfers)} transfers</span>}>
              <Sparkline data={spark.nat} color="var(--amber)" />
            </Kpi>
            <Kpi i={4} icon={<Blocks size={16} />} title="ERC-20 USDC volume" hint="Transfer events from the USDC contract, 6-decimal accounting. Separate from native volume" value={fmtCompact(a.totals.erc20VolumeUsdc, 2)} unit="USDC" badge={<span className="inline-flex items-center gap-2 text-xs text-[var(--subtle)]"><Delta pct={halfDelta(spark.erc)} />{fmtInt(a.totals.erc20Transfers)} transfers</span>}>
              <Sparkline data={spark.erc} color="var(--pink)" />
            </Kpi>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card
              className="rise lg:col-span-2"
              title="USDC transfer flow"
              subtitle={
                <span className="num">
                  <b className="display text-2xl text-[var(--ink)]">{fmtCompact(metric === 'count' ? a.totals.nativeTransfers : a.totals.nativeVolumeUsdc, 2)}</b> <span className="text-[var(--cyan)]">native</span>
                  <span className="mx-3 text-[var(--border)]">|</span>
                  <b className="display text-2xl text-[var(--ink)]">{fmtCompact(metric === 'count' ? a.totals.erc20Transfers : a.totals.erc20VolumeUsdc, 2)}</b> <span className="text-[var(--violet)]">ERC-20</span>
                </span>
              }
              action={<Segmented label="Flow metric" value={metric} onChange={setMetric} options={[{ id: 'count', label: 'Count' }, { id: 'volume', label: 'Volume' }]} />}
            >
              <GlowChart series={flow} bucketSeconds={a.bucketSeconds} format={(v) => (metric === 'count' ? fmtInt(v) : `${fmtCompact(v, 2)} USDC`)} axis={(v) => fmtCompact(v, 0)} />
            </Card>
            <Card className="rise" title="Transactions per period" subtitle={<span className="inline-flex items-center gap-2"><b className="display num text-2xl text-[var(--ink)]">{fmtInt(a.totals.txs)}</b><Delta pct={halfDelta(spark.txs)} /></span>}>
              <RainbowBars data={bars} bucketSeconds={a.bucketSeconds} format={(v) => `${fmtInt(v)} txs`} />
            </Card>
          </div>
          {a.coverage < 0.97 && (
            <p className="flex items-center gap-2 text-xs text-[var(--subtle)]"><Cable size={14} /> {Math.round(a.coverage * 100)}% of this window is indexed so far. Charts cover indexed blocks only while history backfills.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <TypeMix />
        <Connections coverage={a?.coverage} range={range} />
      </div>

      <div className="defer grid gap-4 lg:grid-cols-2">
        <LatestBlocks />
        <LatestTxs nav={nav} />
      </div>

      <div className="defer grid gap-4 lg:grid-cols-2">
        <Card title="Most active contracts" subtitle={`Calls received in the ${range.toUpperCase()} window (lower bound: top eight per batch)`}>
          {top.error ? (
            <ErrorState error={top.error} onRetry={top.refetch} />
          ) : !top.data ? (
            <Skeleton rows={5} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Contract</th><th className="text-right">Calls</th></tr></thead>
                <tbody>
                  {top.data.contracts.map((c) => (
                    <tr key={c.address}>
                      <td><a className="link mono" href={`/contract/${c.address}`} onClick={(e) => { e.preventDefault(); nav(`/contract/${c.address}`) }}>{c.address}</a></td>
                      <td className="text-right">{fmtInt(c.calls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {top.data.contracts.length === 0 && <p className="p-4 text-sm text-[var(--subtle)]">No indexed activity yet.</p>}
            </div>
          )}
        </Card>
        <GasEstimator />
      </div>
    </div>
  )
}
