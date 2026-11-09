import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
import { Badge, Card, ErrorState, Skeleton, Stat } from '@/components/ui'
import { useApi } from '@/lib/api'
import { fmtDateTime, fmtInt, timeAgo } from '@/lib/format'

interface Health {
  ok: boolean
  chain: { expectedChainId: number; expectedHex: string; reportedHex: string | null; verified: boolean }
  head: { number: number; timestamp: number; ageSeconds: number } | null
  error: string | null
  providers: Array<{ name: string; credentialed: boolean; chainVerified: boolean; chainMismatch: boolean; healthy: boolean; lastLatencyMs: number | null; lastOkAt: string | null; lastError: string | null; requests: number; errors: number; rateLimited: number }>
  indexer: {
    enabled: boolean
    running: boolean
    snapshot?: boolean
    snapshotAt?: string | null
    lagBlocks: number | null
    batchesIndexed: number
    batchesPerMinute: number
    historyDays: number
    historyTargetCovered: number
    oldestIndexedTimestamp: number | null
    transfersStored: number
    transferStoreFloorUsdc: number
    errorsTotal: number
    lastError: { at: string; message: string } | null
    coverage: Record<'24h' | '7d' | '30d' | '90d', number>
  }
  dependencies: Array<{ name: string; status: 'ok' | 'missing'; requirement: string }>
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--success)]" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />}
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-[var(--subtle)] text-pretty">{detail}</div>
      </div>
    </li>
  )
}

export default function Status() {
  const { data: h, error, refetch } = useApi<Health>('/api/health', { refetchMs: 15_000 })
  if (error) return <ErrorState error={error} onRetry={refetch} />
  if (!h) return <Skeleton rows={8} />
  const i = h.indexer
  const primaryOk = h.dependencies.find((d) => d.name === 'Dedicated primary RPC')?.status === 'ok'
  const fallbackOk = h.dependencies.find((d) => d.name === 'Verified fallback RPC')?.status === 'ok'
  const checks = [
    { ok: h.chain.verified, label: 'RPC reports chain ID 5042 (0x13B2)', detail: `eth_chainId returned ${h.chain.reportedHex ?? 'nothing'}.` },
    { ok: h.head !== null && h.head.ageSeconds <= 20, label: 'Latest block is fresh', detail: h.head ? `Block #${fmtInt(h.head.number)} is ${h.head.ageSeconds}s old.` : 'No block could be read.' },
    { ok: i.enabled && i.running, label: 'Indexer is running', detail: i.snapshot ? `Not running on this deployment. Indexed history is a snapshot${i.snapshotAt ? ` taken ${timeAgo(Math.floor(new Date(i.snapshotAt).getTime() / 1000))}` : ''}.` : `${i.batchesPerMinute} batches/min · ${fmtInt(i.batchesIndexed)} batches stored · ${fmtInt(i.errorsTotal)} retried errors.` },
    { ok: i.coverage['24h'] >= 0.97, label: '24H analytics fully indexed', detail: `${Math.round(i.coverage['24h'] * 100)}% covered.` },
    { ok: i.coverage['90d'] >= 0.97, label: '90D analytics fully indexed', detail: `${Math.round(i.coverage['90d'] * 100)}% covered. Historical blocks backfill continuously from newest to oldest.` },
    { ok: primaryOk, label: 'Dedicated primary RPC configured', detail: 'Production needs its own RPC endpoint (ARC_MAINNET_RPC_URL).' },
    { ok: fallbackOk, label: 'Verified fallback RPC available', detail: 'A second provider that passes the chain ID check (ARC_MAINNET_RPC_FALLBACK_URL).' },
  ]
  const passing = checks.filter((c) => c.ok).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-balance sm:text-4xl">System status</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--subtle)] text-pretty">Live checks on the Arc Mainnet connection, the indexer and production dependencies. Missing items are listed with what they need.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Chain" value={h.chain.verified ? '5042' : 'Mismatch'} sub={`expected ${h.chain.expectedHex}, got ${h.chain.reportedHex ?? 'none'}`} />
        <Stat label="Head block" value={h.head ? `#${fmtInt(h.head.number)}` : 'n/a'} sub={h.head ? timeAgo(h.head.timestamp) : h.error ?? undefined} />
        <Stat label="Index lag" value={i.lagBlocks !== null ? `${fmtInt(i.lagBlocks)} blocks` : 'n/a'} sub={`${i.batchesPerMinute} batches/min`} />
        <Stat label="Checks passing" value={`${passing}/${checks.length}`} sub={passing === checks.length ? 'All checks pass' : 'Not all checks pass yet'} />
      </div>

      <Card title="Readiness checks" subtitle="Evaluated against the running system right now">
        <ul className="divide-y divide-line">{checks.map((c) => <Check key={c.label} {...c} />)}</ul>
      </Card>

      <Card title="Historical index" subtitle={i.oldestIndexedTimestamp ? `Oldest indexed block time: ${fmtDateTime(i.oldestIndexedTimestamp)}. Target ${i.historyDays} days.` : 'No batches indexed yet'}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['24h', '7d', '30d', '90d'] as const).map((r) => (
            <div key={r} className="rounded-2xl bg-field p-4">
              <div className="label">{r.toUpperCase()} coverage</div>
              <div className="display num mt-2 text-2xl font-semibold">{Math.round(i.coverage[r] * 100)}%</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(i.coverage[r] * 100)}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--subtle)] text-pretty">Whale rows stored: {fmtInt(i.transfersStored)} (transfers of {fmtInt(i.transferStoreFloorUsdc)} USDC or more). {i.lastError && `Last indexer error ${timeAgo(Math.floor(new Date(i.lastError.at).getTime() / 1000))}: ${i.lastError.message}`}</p>
      </Card>

      <Card title="RPC providers" subtitle="Each provider must return chain ID 0x13B2 before it serves any request">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Provider</th><th>Chain check</th><th>State</th><th className="text-right">Latency</th><th className="text-right">Requests</th><th className="text-right">Errors</th><th className="text-right">Rate limited</th></tr></thead>
            <tbody>
              {h.providers.map((p) => (
                <tr key={p.name}>
                  <td className="font-semibold">{p.name}</td>
                  <td><Badge tone={p.chainMismatch ? 'bad' : p.chainVerified ? 'good' : 'warn'}>{p.chainMismatch ? 'wrong chain' : p.chainVerified ? 'verified' : 'pending'}</Badge></td>
                  <td><Badge tone={p.healthy ? 'good' : 'warn'}>{p.healthy ? 'healthy' : 'cooling down'}</Badge></td>
                  <td className="text-right">{p.lastLatencyMs !== null ? `${p.lastLatencyMs} ms` : 'n/a'}</td>
                  <td className="text-right">{fmtInt(p.requests)}</td>
                  <td className="text-right">{fmtInt(p.errors)}</td>
                  <td className="text-right">{fmtInt(p.rateLimited)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Production dependencies" subtitle="Configuration the deployment still needs">
        <ul className="divide-y divide-line">
          {h.dependencies.map((d) => (
            <li key={d.name} className="flex items-start gap-3 py-3">
              {d.status === 'ok' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--success)]" /> : <CircleAlert size={18} className="mt-0.5 shrink-0 text-[var(--warn)]" />}
              <div>
                <div className="text-sm font-semibold">{d.name} <Badge tone={d.status === 'ok' ? 'good' : 'warn'}>{d.status === 'ok' ? 'configured' : 'missing'}</Badge></div>
                <div className="text-xs text-[var(--subtle)] text-pretty">{d.requirement}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
