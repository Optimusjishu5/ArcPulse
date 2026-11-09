import { useState } from 'react'
import { Search } from 'lucide-react'
import { AddressLink, Badge, Card, CoverageBar, ErrorState, Segmented, SnapshotNote, Skeleton, Stat, type Nav } from '@/components/ui'
import { TokenLogo } from '@/components/TokenLogo'
import { useApi } from '@/lib/api'
import { isLookalike, officialToken } from '@/lib/tokens'
import { fmtCompact, fmtDateTime, fmtInt, fmtRaw, isAddress } from '@/lib/format'

interface Usdc {
  totalSupplyRaw: string
  decimals: number
  analytics: { coverage: number; totals: { erc20Transfers: number; erc20VolumeUsdc: number } } | null
  topSenders: Array<{ address: string; transfers: number; volume: number }>
}

interface Active {
  window: { fromBlock: number; toBlock: number; fromTimestamp: number | null; toTimestamp: number | null }
  asOf: string
  tokens: Array<{ address: string; symbol: string | null; name: string | null; decimals: number; transfers: number; uniqueSenders: number; uniqueReceivers: number; isUsdc: boolean }>
}

export default function Tokens({ nav }: { nav: Nav }) {
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h')
  const [query, setQuery] = useState('')
  const [bad, setBad] = useState(false)
  const usdc = useApi<Usdc>(`/api/usdc?range=${range}`, { refetchMs: 30_000 })
  const active = useApi<Active>('/api/tokens/active', { refetchMs: 60_000 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-balance sm:text-4xl">Tokens</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--subtle)] text-pretty">USDC analytics and the most active tokens on Arc Mainnet. ArcPulse does not show prices, market caps or holder counts because it has no verified source for them.</p>
      </div>

      <Card>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (isAddress(query.trim())) nav(`/contract/${query.trim().toLowerCase()}`); else setBad(true) }}>
          <input className="input mono flex-1" placeholder="Token contract address (0x…)" value={query} onChange={(e) => { setQuery(e.target.value); setBad(false) }} aria-label="Token contract address" aria-invalid={bad} />
          <button className="btn btn-primary" type="submit"><Search size={16} /> Open token</button>
        </form>
        {bad && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">Enter a valid 42-character contract address.</p>}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-xl font-semibold">USDC</h2>
        <Segmented label="USDC window" value={range} onChange={setRange} options={[{ id: '24h', label: '24H' }, { id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '90d', label: '90D' }]} />
      </div>
      <SnapshotNote at={usdc.meta?.snapshotAt} />
      {usdc.error ? (
        <ErrorState error={usdc.error} onRetry={usdc.refetch} />
      ) : !usdc.data ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="ERC-20 total supply" value={fmtCompact(Number(fmtRaw(usdc.data.totalSupplyRaw, usdc.data.decimals, 0).replace(/,/g, '')), 2)} sub="USDC, read from totalSupply()" />
            <Stat label="ERC-20 transfers" value={fmtInt(usdc.data.analytics?.totals.erc20Transfers ?? 0)} sub={`in the indexed ${range.toUpperCase()} window`} />
            <Stat label="ERC-20 volume" value={fmtCompact(usdc.data.analytics?.totals.erc20VolumeUsdc ?? 0, 2)} sub="USDC transferred (6-decimal view)" />
          </div>
          {usdc.data.analytics && <CoverageBar coverage={usdc.data.analytics.coverage} label={range.toUpperCase()} />}
          <Card title="Largest ERC-20 USDC senders" subtitle="Ranked by volume across stored transfers of 1,000 USDC or more">
            {usdc.data.topSenders.length === 0 ? (
              <p className="text-sm text-[var(--subtle)]">No stored transfers in this window yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Address</th><th className="text-right">Transfers</th><th className="text-right">Volume (USDC)</th></tr></thead>
                  <tbody>
                    {usdc.data.topSenders.map((s) => (
                      <tr key={s.address}>
                        <td><AddressLink address={s.address} nav={nav} /></td>
                        <td className="text-right">{fmtInt(s.transfers)}</td>
                        <td className="text-right">{fmtCompact(s.volume, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <SnapshotNote at={active.meta?.snapshotAt} />

      <Card
        title="Most active tokens"
        subtitle={active.data ? `Sample window: blocks ${fmtInt(active.data.window.fromBlock)} to ${fmtInt(active.data.window.toBlock)} (${fmtDateTime(active.data.window.fromTimestamp)} to ${fmtDateTime(active.data.window.toTimestamp)})` : 'Ranked by Transfer events in a recent block window'}
      >
        {active.error ? (
          <ErrorState error={active.error} onRetry={active.refetch} />
        ) : !active.data ? (
          <Skeleton rows={6} />
        ) : (
          <>
          <div className="table-wrap">
            <table className="data token-table">
              <thead>
                <tr>
                  <th className="w-10 text-right">#</th>
                  <th className="sticky-col">Token</th>
                  <th>Contract</th>
                  <th className="text-right">Transfers</th>
                  <th className="text-right">Senders</th>
                  <th className="text-right">Receivers</th>
                </tr>
              </thead>
              <tbody>
                {active.data.tokens.map((t, i) => {
                  const official = officialToken(t.address)
                  const lookalike = isLookalike(t.address, t.symbol)
                  return (
                    <tr key={t.address}>
                      <td className="text-right text-[var(--subtle)]">{i + 1}</td>
                      <td className="sticky-col">
                        <div className="flex items-center gap-3">
                          <TokenLogo address={t.address} symbol={t.symbol} size={36} />
                          <div className="min-w-0 leading-tight">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{t.symbol ?? 'Unnamed'}</span>
                              {official && <Badge tone="good">Official</Badge>}
                              {lookalike && <Badge tone="warn">Not the official {t.symbol}</Badge>}
                            </div>
                            <div className="mt-0.5 max-w-[220px] truncate text-xs text-[var(--subtle)]">{t.name ?? 'No name'}</div>
                          </div>
                        </div>
                      </td>
                      <td><a className="link mono" href={`/contract/${t.address}`} onClick={(e) => { e.preventDefault(); nav(`/contract/${t.address}`) }}>{t.address.slice(0, 8)}…{t.address.slice(-6)}</a></td>
                      <td className="text-right font-semibold">{fmtInt(t.transfers)}</td>
                      <td className="text-right">{fmtInt(t.uniqueSenders)}</td>
                      <td className="text-right">{fmtInt(t.uniqueReceivers)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--subtle)] text-pretty">Original logos are shown only for tokens verified by contract address on docs.arc.io. Other tokens show an initials mark because they publish no verified logo.</p>
          </>
        )}
      </Card>
    </div>
  )
}
