import { useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { AddressLink, Badge, Card, Empty, ErrorState, Segmented, SnapshotNote, Skeleton, Stat, TxLink, type Nav } from '@/components/ui'
import { TokenLogo } from '@/components/TokenLogo'
import { isLookalike, officialToken } from '@/lib/tokens'
import { ApiError, useApi } from '@/lib/api'
import { fmtDateTime, fmtInt, fmtRaw, isAddress, shortHash, timeAgo, TX_TYPE_LABEL } from '@/lib/format'

interface Detail {
  address: string
  isContract: boolean
  codeBytes: number
  nativeBalanceRaw: string
  nativeDecimals: number
  verification: { status: 'verified' | 'not-verified' | 'unknown'; match: string | null; checkedUrl: string } | null
  explorerUrl: string
  token: { name: string | null; symbol: string | null; decimals: number; totalSupplyRaw: string; isUsdc: boolean } | null
  eventWindow: { fromBlock: number; toBlock: number; complete: boolean; events: number }
  eventSummary: Array<{ topic0: string; name: string | null; count: number }>
  recentEvents: Array<{ txHash: string; block: number; timestamp: number | null; topic0: string | null; name: string | null; transfer: { from: string; to: string; raw: string } | null }>
  interactions: Array<{ hash: string; block: number; timestamp: number | null; from: string; selector: string | null; type: string; nativeValueRaw: string }>
  indexedCalls: Record<'24h' | '7d' | '30d', { calls: number; coverage: number } | null>
}

interface Top {
  coverage: number
  contracts: Array<{ address: string; calls: number }>
}

function Search_({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <Card>
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (isAddress(q.trim())) nav(`/contract/${q.trim().toLowerCase()}`); else setBad(true) }}>
        <input className="input mono flex-1" placeholder="Contract address (0x…)" value={q} onChange={(e) => { setQ(e.target.value); setBad(false) }} aria-label="Contract address" aria-invalid={bad} />
        <button className="btn btn-primary" type="submit"><Search size={16} /> Open contract</button>
      </form>
      {bad && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">Enter a valid 42-character address.</p>}
    </Card>
  )
}

function TopList({ nav }: { nav: Nav }) {
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h')
  const { data, error, refetch, meta } = useApi<Top>(`/api/contracts/top?range=${range}`, { refetchMs: 60_000 })
  return (
    <Card title="Most active contracts" subtitle="Transactions received per contract, from the ArcPulse block index (lower bound: top eight contracts per 250-block batch)" action={<Segmented label="Window" value={range} onChange={setRange} options={[{ id: '24h', label: '24H' }, { id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '90d', label: '90D' }]} />}>
      <SnapshotNote at={meta?.snapshotAt} />
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton rows={6} /> : data.contracts.length === 0 ? <Empty>No indexed activity in this window yet.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Contract</th><th className="text-right">Calls</th></tr></thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.address}>
                  <td><a className="link mono" href={`/contract/${c.address}`} onClick={(e) => { e.preventDefault(); nav(`/contract/${c.address}`) }}>{c.address}</a></td>
                  <td className="text-right">{fmtInt(c.calls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Verification({ d }: { d: Detail }) {
  const v = d.verification
  if (!v) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {v.status === 'verified' && <Badge tone="good">Verified on Sourcify ({v.match})</Badge>}
      {v.status === 'not-verified' && <Badge tone="warn">No Sourcify verification found</Badge>}
      {v.status === 'unknown' && <Badge tone="neutral">Sourcify lookup unavailable</Badge>}
      <a className="link inline-flex items-center gap-1" href={`${d.explorerUrl}?tab=contract`} target="_blank" rel="noopener noreferrer">Source code on explorer.arc.io <ExternalLink size={12} /></a>
    </div>
  )
}

function ContractDetail({ address, nav }: { address: string; nav: Nav }) {
  const { data: d, error, refetch } = useApi<Detail>(`/api/contract/${address}`, { refetchMs: 30_000 })
  if (error) return <ErrorState error={error} onRetry={refetch} />
  if (!d) return <Skeleton rows={6} />
  return (
    <div className="space-y-6">
      <Card
        title={d.token ? `${d.token.symbol ?? 'Token'}${d.token.name ? ` · ${d.token.name}` : ''}` : d.isContract ? 'Contract' : 'Address without code'}
        subtitle={<span className="mono break-all">{d.address}</span>}
        action={
          d.token ? (
            <div className="flex items-center gap-3">
              {officialToken(d.address) ? <Badge tone="good">Official</Badge> : isLookalike(d.address, d.token.symbol) ? <Badge tone="warn">Not the official {d.token.symbol}</Badge> : <Badge tone="neutral">ERC-20</Badge>}
              <TokenLogo address={d.address} symbol={d.token.symbol} size={44} />
            </div>
          ) : undefined
        }
      >
        <Verification d={d} />
        {!d.isContract && <p className="mt-3 text-sm text-[var(--warn)]">This address has no contract code. <a className="link" href={`/wallet/${d.address}`} onClick={(e) => { e.preventDefault(); nav(`/wallet/${d.address}`) }}>Open it as a wallet</a>.</p>}
        <p className="mt-3 text-xs text-[var(--subtle)]">Verification is read from Sourcify. Absence there does not mean the source is unpublished elsewhere, so the explorer link is always provided.</p>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Code size" value={`${fmtInt(d.codeBytes)} B`} />
        <Stat label="Native balance" value={fmtRaw(d.nativeBalanceRaw, d.nativeDecimals, 4)} sub="USDC, 18-decimal view" />
        {d.token && <Stat label="Total supply" value={fmtRaw(d.token.totalSupplyRaw, d.token.decimals, 2)} sub={`${d.token.symbol ?? 'tokens'}, ${d.token.decimals} decimals`} />}
        <Stat label="Calls (24H indexed)" value={d.indexedCalls['24h'] ? fmtInt(d.indexedCalls['24h'].calls) : 'n/a'} sub={d.indexedCalls['7d'] ? `${fmtInt(d.indexedCalls['7d'].calls)} in 7D` : undefined} />
      </div>

      <Card title="Event activity" subtitle={`Logs emitted in blocks ${fmtInt(d.eventWindow.fromBlock)} to ${fmtInt(d.eventWindow.toBlock)} (${fmtInt(d.eventWindow.events)} events)${d.eventWindow.complete ? '' : '. Log query failed, so this window is incomplete.'}`}>
        {d.eventSummary.length === 0 ? <Empty>No events emitted in this window.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Event</th><th>Topic 0</th><th className="text-right">Count</th></tr></thead>
              <tbody>
                {d.eventSummary.map((e) => (
                  <tr key={e.topic0}><td className="font-semibold">{e.name ?? 'Unrecognized event'}</td><td className="mono text-[var(--subtle)]">{shortHash(e.topic0)}</td><td className="text-right">{fmtInt(e.count)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {d.token && d.recentEvents.some((e) => e.transfer) && (
        <Card title="Recent token transfers" subtitle="Decoded from Transfer events emitted by this contract">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Time</th><th>From</th><th>To</th><th className="text-right">Amount</th><th>Tx</th></tr></thead>
              <tbody>
                {d.recentEvents.filter((e) => e.transfer).map((e) => (
                  <tr key={`${e.txHash}-${e.block}-${e.transfer?.raw}-${e.transfer?.to}`}>
                    <td className="text-[var(--subtle)]" title={fmtDateTime(e.timestamp)}>{timeAgo(e.timestamp)}</td>
                    <td><AddressLink address={e.transfer?.from ?? ''} nav={nav} /></td>
                    <td><AddressLink address={e.transfer?.to ?? ''} nav={nav} /></td>
                    <td className="text-right">{fmtRaw(e.transfer?.raw ?? '0', d.token?.decimals ?? 0, 4)} {d.token?.symbol}</td>
                    <td><TxLink hash={e.txHash} nav={nav} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Recent interactions" subtitle="Transactions that emitted events from this contract in the window above">
        {d.interactions.length === 0 ? <Empty>No transactions touched this contract in the window.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Time</th><th>Caller</th><th>Type</th><th>Method id</th><th>Tx</th></tr></thead>
              <tbody>
                {d.interactions.map((i) => (
                  <tr key={i.hash}>
                    <td className="text-[var(--subtle)]">{timeAgo(i.timestamp)}</td>
                    <td><AddressLink address={i.from} nav={nav} /></td>
                    <td>{TX_TYPE_LABEL[i.type] ?? i.type}</td>
                    <td className="mono text-[var(--subtle)]">{i.selector ?? 'none'}</td>
                    <td><TxLink hash={i.hash} nav={nav} /></td>
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

export default function Contracts({ nav, address }: { nav: Nav; address?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-balance sm:text-4xl">{address ? 'Contract explorer' : 'Contracts'}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--subtle)] text-pretty">Contract code, event activity, interactions and source verification for Arc Mainnet addresses.</p>
      </div>
      <Search_ nav={nav} />
      {address ? (isAddress(address) ? <ContractDetail address={address.toLowerCase()} nav={nav} /> : <ErrorState error={new ApiError(400, 'BAD_ADDRESS', 'That is not a valid contract address.')} />) : <TopList nav={nav} />}
    </div>
  )
}
