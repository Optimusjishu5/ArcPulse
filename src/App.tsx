import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { MobileNav, Sidebar, Topbar, WalletNetworkBanner } from '@/components/Header'
import { Skeleton } from '@/components/ui'
import { useApi } from '@/lib/api'
import { loaders } from '@/lib/pages'
import { useLocation } from '@/lib/route'

const Overview = lazy(loaders.overview)
const Whales = lazy(loaders.whales)
const WalletPage = lazy(loaders.wallet)
const Tokens = lazy(loaders.tokens)
const Contracts = lazy(loaders.contracts)
const TxPage = lazy(loaders.tx)
const Status = lazy(loaders.status)

/** Explains an empty dashboard when the site is hosted without the ArcPulse server. */
function BackendNotice() {
  const { error } = useApi<unknown>('/api/blocks?limit=1', { refetchMs: 15_000 })
  if (error?.code !== 'NO_BACKEND') return null
  return (
    <div role="alert" className="mb-4 rounded-2xl border border-arc-warn/40 bg-arc-warn/10 px-4 py-3 text-sm text-pretty">
      <b>Backend not connected.</b> This site is the ArcPulse interface only. Live and indexed Arc Mainnet data comes from the ArcPulse server (<span className="mono">bun run start</span>). Host it, then rebuild with <span className="mono">VITE_API_BASE_URL</span> set to its address.
    </div>
  )
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: error.message, stack: info.componentStack }),
    }).catch(() => undefined)
  }
  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="card mx-auto my-16 max-w-md p-6 text-center">
          <h2 className="display text-xl font-semibold">Something went wrong</h2>
          <p className="mt-2 text-sm text-[var(--subtle)]">The error was reported. Reload to continue.</p>
          <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

const TITLES: Record<string, string> = {
  '': 'Dashboard',
  whales: 'Whale tracker',
  wallet: 'Wallet intelligence',
  tokens: 'Tokens',
  contracts: 'Contracts',
  contract: 'Contract explorer',
  tx: 'Transaction',
  status: 'System status',
}

export default function App() {
  const { path, search, navigate } = useLocation()
  const parts = path.split('/').filter(Boolean)
  const head = parts[0] ?? ''
  const arg = parts[1]

  useEffect(() => {
    document.title = `${TITLES[head] ?? 'Not found'} · ArcPulse`
  }, [head])

  let page: ReactNode
  if (head === '') page = <Overview nav={navigate} />
  else if (head === 'whales') page = <Whales nav={navigate} search={search} />
  else if (head === 'wallet') page = <WalletPage nav={navigate} address={arg} />
  else if (head === 'tokens') page = <Tokens nav={navigate} />
  else if (head === 'contracts') page = <Contracts nav={navigate} />
  else if (head === 'contract') page = <Contracts nav={navigate} address={arg} />
  else if (head === 'tx' && arg) page = <TxPage nav={navigate} hash={arg} />
  else if (head === 'status') page = <Status />
  else
    page = (
      <div className="card mx-auto max-w-md p-6 text-center">
        <h1 className="display text-xl font-semibold">Page not found</h1>
        <button className="btn btn-primary mt-4" onClick={() => navigate('/')}>Back to overview</button>
      </div>
    )

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1500px] gap-5 p-3 sm:p-4">
      <Sidebar path={path} nav={navigate} />
      <div className="min-w-0 flex-1">
        <Topbar nav={navigate} />
        <div className="mt-3"><MobileNav path={path} nav={navigate} /></div>
        <main className="mt-4 pb-24">
          <BackendNotice />
          <WalletNetworkBanner />
          <Boundary>
            <Suspense fallback={<Skeleton rows={6} />}>{page}</Suspense>
          </Boundary>
        </main>
        <footer className="pb-24 text-xs text-[var(--subtle)]">
          <p className="max-w-3xl text-pretty">
            ArcPulse reads Arc Mainnet (chain 5042) only. On Arc, native USDC (18 decimals, gas) and ERC-20 USDC (6 decimals) are the same funds in two views, so they are shown separately and never added together. Prices, market caps and holder counts are not shown because no verified source for them is configured.
          </p>
        </footer>
      </div>
    </div>
  )
}
