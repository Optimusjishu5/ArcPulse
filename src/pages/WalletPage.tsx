import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search, ExternalLink } from 'lucide-react'
import { useAccount, useDisconnect } from 'wagmi'
import { Chart } from '@/components/Chart'
import { TokenLogo } from '@/components/TokenLogo'
import { isLookalike } from '@/lib/tokens'
import { WalletTransfers, type WalletEvent } from '@/components/WalletTransfers'
import { Badge, Card, Empty, ErrorState, Skeleton, type Nav } from '@/components/ui'
import { ApiError, apiGet, useApi } from '@/lib/api'
import { addressUrl, fmtInt, fmtRaw, isAddress, isHash } from '@/lib/format'
import { arcMainnet } from '@/config'

interface Summary {
  address: string
  native: { raw: string; decimals: number; label: string }
  erc20: { raw: string; decimals: number; label: string }
  viewsAgree: boolean
  nonce: number
  isContract: boolean
  codeBytes: number
}

interface Holdings {
  holdings: Array<{ token: string; symbol: string | null; name: string | null; decimals: number; raw: string }>
  discovery: { method: string; scannedFromBlock: number; scannedToBlock: number; scannedBlocks: number; complete: boolean }
}

interface TransferPage {
  scannedFromBlock: number
  scannedToBlock: number
  reachedGenesis: boolean
  nextBefore: number | null
  transfers: WalletEvent[]
}

function useTransfers(address: string | undefined) {
  const q = useInfiniteQuery({
    queryKey: ['wallet-transfers', address],
    enabled: address !== undefined,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const before = pageParam ? `&before=${pageParam}` : ''
      return (await apiGet<TransferPage>(`/api/wallet/${address}/transfers?limit=40${before}`, signal)).data
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const pages = q.data?.pages ?? []
  const error = q.isError ? (q.error instanceof ApiError ? q.error : new ApiError(0, 'UNKNOWN', 'Request failed')) : undefined
  return {
    events: error && pages.length === 0 ? [] : pages.flatMap((p) => p.transfers),
    hasMore: q.hasNextPage,
    scannedFrom: pages.length > 0 ? (pages[pages.length - 1]).scannedFromBlock : null,
    loading: q.isFetching,
    error,
    more: () => void q.fetchNextPage(),
    retry: () => void q.refetch(),
  }
}

function Balances({ s, mine, onDisconnect }: { s: Summary; mine: boolean; onDisconnect: () => void }) {
  return (
    <Card
      title={s.isContract ? 'Contract account' : 'Wallet'}
      subtitle={<span className="mono break-all">{s.address}</span>}
      action={
        <div className="flex items-center gap-2">
          {mine && <Badge tone="accent">Connected wallet</Badge>}
          <a className="btn btn-ghost !min-h-9" href={addressUrl(s.address)} target="_blank" rel="noopener noreferrer">Explorer <ExternalLink size={14} /></a>
          {mine && <button className="btn btn-ghost !min-h-9" onClick={onDisconnect}>Disconnect</button>}
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-field p-4">
          <div className="label">ERC-20 USDC · 6 decimals</div>
          <div className="display num mt-2 text-2xl font-semibold">{fmtRaw(s.erc20.raw, s.erc20.decimals, 2)}</div>
          <div className="mt-1 text-xs text-[var(--subtle)]">balanceOf on the USDC contract</div>
        </div>
        <div className="rounded-2xl bg-field p-4">
          <div className="label">Native USDC · 18 decimals</div>
          <div className="display num mt-2 text-2xl font-semibold">{fmtRaw(s.native.raw, s.native.decimals, 6)}</div>
          <div className="mt-1 text-xs text-[var(--subtle)]">eth_getBalance (gas view)</div>
        </div>
        <div className="rounded-2xl bg-field p-4">
          <div className="label">Account</div>
          <div className="display num mt-2 text-2xl font-semibold">{fmtInt(s.nonce)} <span className="text-sm font-medium text-[var(--subtle)]">txs sent</span></div>
          <div className="mt-1 text-xs text-[var(--subtle)]">{s.isContract ? `Has ${fmtInt(s.codeBytes)} bytes of code` : 'Externally owned account'}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--subtle)] text-pretty">
        {s.viewsAgree
          ? 'The two balances are the same funds in two views (18 vs 6 decimals), so they are shown side by side and never added together.'
          : 'Warning: the native and ERC-20 views disagree beyond rounding. Treat this reading with caution and check the explorer.'}
      </p>
    </Card>
  )
}

function Holdings({ address }: { address: string }) {
  const { data, error, refetch } = useApi<Holdings>(`/api/wallet/${address}/holdings`)
  return (
    <Card title="Other token holdings" subtitle="Tokens found in incoming transfers, balances read live from each token contract">
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton rows={3} />
      ) : data.holdings.length === 0 ? (
        <Empty>No other token balances found in {fmtInt(data.discovery.scannedBlocks)} scanned blocks (#{fmtInt(data.discovery.scannedFromBlock)} to #{fmtInt(data.discovery.scannedToBlock)}). Tokens received earlier than that are not discovered.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data token-table">
              <thead><tr><th className="sticky-col">Token</th><th>Contract</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.token}>
                    <td className="sticky-col">
                      <div className="flex items-center gap-3">
                        <TokenLogo address={h.token} symbol={h.symbol} size={32} />
                        <div className="min-w-0 leading-tight">
                          <div className="flex items-center gap-2"><span className="font-semibold">{h.symbol ?? 'Unnamed'}</span>{isLookalike(h.token, h.symbol) && <Badge tone="warn">Not the official {h.symbol}</Badge>}</div>
                          <div className="mt-0.5 max-w-[200px] truncate text-xs text-[var(--subtle)]">{h.name ?? 'No name'}</div>
                        </div>
                      </div>
                    </td>
                    <td><a className="link mono" href={`/contract/${h.token}`}>{h.token.slice(0, 10)}…</a></td>
                    <td className="text-right">{fmtRaw(h.raw, h.decimals, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--subtle)]">Scanned {fmtInt(data.discovery.scannedBlocks)} blocks{data.discovery.complete ? ' (full history)' : ''}. Prices are not shown: no verified price source is configured.</p>
        </>
      )}
    </Card>
  )
}

export default function WalletPage({ nav, address }: { nav: Nav; address?: string }) {
  const { address: connected, chainId, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [query, setQuery] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const onMainnet = chainId === arcMainnet.id
  const target = address ? address.toLowerCase() : isConnected && onMainnet && connected ? connected.toLowerCase() : undefined
  const valid = target !== undefined && isAddress(target)
  const summary = useApi<Summary>(valid ? `/api/wallet/${target}` : null, { refetchMs: 10_000 })
  const t = useTransfers(valid ? target : undefined)

  const submit = () => {
    const q = query.trim()
    if (isAddress(q)) nav(`/wallet/${q.toLowerCase()}`)
    else if (isHash(q)) nav(`/tx/${q.toLowerCase()}`)
    else setInputError('Enter a 0x wallet address (42 characters) or a transaction hash (66 characters).')
  }

  const chart = useMemo(() => {
    const times = t.events.map((e) => e.timestamp).filter((x): x is number => x !== null)
    if (times.length === 0) return null
    const span = Math.max(...times) - Math.min(...times)
    const bucket = span > 3 * 86400 ? 86400 : 3600
    const map = new Map<number, number>()
    for (const e of t.events) if (e.timestamp !== null) map.set(Math.floor(e.timestamp / bucket) * bucket, (map.get(Math.floor(e.timestamp / bucket) * bucket) ?? 0) + 1)
    return { bucket, data: [...map.entries()].sort((a, b) => a[0] - b[0]).map(([ts, v]) => ({ t: ts, v })) }
  }, [t.events])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl font-bold text-balance sm:text-4xl">Wallet intelligence</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--subtle)] text-pretty">Search any Arc Mainnet address. Balances are read live; history is decoded from on-chain Transfer events.</p>
      </div>
      <Card>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <input className="input mono flex-1" placeholder="0x wallet address or transaction hash" value={query} onChange={(e) => { setQuery(e.target.value); setInputError(null) }} aria-label="Wallet address or transaction hash" aria-invalid={inputError !== null} />
          <button className="btn btn-primary" type="submit"><Search size={16} /> Search</button>
        </form>
        {inputError && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{inputError}</p>}
        {isConnected && connected && !address && !onMainnet && <p className="mt-3 text-sm text-[var(--warn)]">Switch your wallet to Arc Mainnet to see its balances here.</p>}
      </Card>

      {!target ? (
        <Empty>Connect a wallet or search an address to see balances, token holdings and transfer history.</Empty>
      ) : !valid ? (
        <ErrorState error={new ApiError(400, 'BAD_ADDRESS', 'That is not a valid Arc address.')} />
      ) : (
        <>
          {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : !summary.data ? <Skeleton rows={3} /> : <Balances s={summary.data} mine={connected?.toLowerCase() === target} onDisconnect={() => disconnect()} />}
          <Holdings address={target} />
          {chart && (
            <Card title="Transfer activity" subtitle={`Events in the scanned history (${t.events.length} loaded), per ${chart.bucket >= 86400 ? 'day' : 'hour'}`}>
              <Chart ariaLabel="Wallet transfer events over time" bucketSeconds={chart.bucket} data={chart.data} format={(v) => `${fmtInt(v)} events`} axis={(v) => fmtInt(v)} />
            </Card>
          )}
          <WalletTransfers address={target} nav={nav} events={t.events} loading={t.loading} error={t.error} scannedFrom={t.scannedFrom} hasMore={t.hasMore} onMore={t.more} onRetry={t.retry} />
        </>
      )}
    </div>
  )
}
