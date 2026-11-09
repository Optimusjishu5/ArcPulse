import { useEffect, useRef, useState, type ComponentType } from 'react'
import { AlertTriangle, Coins, FileCode2, HeartPulse, LayoutDashboard, Radio, Search, Waves, Wallet, type LucideProps } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { arcMainnet } from '@/config'
import { useApi } from '@/lib/api'
import { fmtInt, isAddress, isHash, shortAddr } from '@/lib/format'
import { prefetchRoute } from '@/lib/pages'
import { Link } from '@/lib/route'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<LucideProps>
}

const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  { title: 'General', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/whales', label: 'Whales', icon: Waves }, { to: '/wallet', label: 'Wallets', icon: Wallet }] },
  { title: 'Explore', items: [{ to: '/tokens', label: 'Tokens', icon: Coins }, { to: '/contracts', label: 'Contracts', icon: FileCode2 }] },
  { title: 'System', items: [{ to: '/status', label: 'Status', icon: HeartPulse }] },
]
const ALL = GROUPS.flatMap((g) => g.items)

const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path.startsWith(to) || (to === '/contracts' && path.startsWith('/contract')))

export function Sidebar({ path, nav }: { path: string; nav: (to: string) => void }) {
  const { address, isConnected } = useAccount()
  return (
    <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-[248px] shrink-0 flex-col rounded-3xl border border-[var(--border)] bg-panel p-4 lg:flex">
      <div className="px-1 pb-5 pt-1"><Logo nav={nav} size={38} /></div>
      <nav className="flex-1 space-y-5 overflow-y-auto" aria-label="Primary">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="label mb-2 px-3">{g.title}</div>
            <div className="space-y-1">
              {g.items.map((n) => (
                <Link key={n.to} to={n.to} navigate={nav} className="nav-link" aria-current={isActive(path, n.to) ? 'page' : undefined} onPointerEnter={() => prefetchRoute(n.to)} onFocus={() => prefetchRoute(n.to)}>
                  <n.icon size={18} aria-hidden="true" /> {n.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-gradient-to-b from-arc-violet/20 to-transparent p-4">
        <div className="display text-sm font-semibold">{isConnected ? 'Your wallet' : 'Connect a wallet'}</div>
        <p className="mt-1 text-xs text-[var(--subtle)] text-pretty">{isConnected && address ? <span className="mono">{shortAddr(address)}</span> : 'See your native and ERC-20 USDC balances on Arc Mainnet.'}</p>
        {isConnected && address ? (
          <Link to="/wallet" navigate={nav} className="btn btn-primary mt-3 w-full">Open my wallet</Link>
        ) : (
          <ConnectKitButton.Custom>
            {({ show }) => <button className="btn btn-primary mt-3 w-full" onClick={show}>Connect wallet</button>}
          </ConnectKitButton.Custom>
        )}
      </div>
      <p className="mt-3 px-1 text-[11px] text-[var(--subtle)]">Chain 5042 · read-only</p>
    </aside>
  )
}

interface BlockRow {
  number: number
}

function Pills() {
  const { data, meta, error } = useApi<BlockRow[]>('/api/blocks?limit=1', { refetchMs: 3000 })
  const streaming = !error && meta?.live === true
  const healthy = !error && meta?.chainVerified === true && meta.live
  return (
    <div className="hidden items-center gap-2 xl:flex" role="status" aria-live="polite">
      <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${streaming ? 'border-arc-cyan/30 bg-arc-cyan/10 text-[var(--cyan)]' : 'border-arc-warn/30 bg-arc-warn/10 text-[var(--warn)]'}`}>
        <Radio size={14} aria-hidden="true" />
        {streaming ? 'Data streaming' : error ? 'Offline' : 'Stale data'}
        {data?.[0] && <span className="num text-[var(--subtle)]">#{fmtInt(data[0].number)}</span>}
      </span>
      <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${healthy ? 'border-arc-success/30 bg-arc-success/10 text-[var(--success)]' : 'border-arc-danger/30 bg-arc-danger/10 text-[var(--danger)]'}`}>
        <i className={`pulse-dot h-2 w-2 rounded-full bg-current ${healthy ? '' : 'after:hidden'}`} />
        {healthy ? 'Chain 5042 verified' : meta && !meta.chainVerified ? 'Chain unverified' : 'Needs attention'}
      </span>
    </div>
  )
}

export function Topbar({ nav }: { nav: (to: string) => void }) {
  const [q, setQ] = useState('')
  const [bad, setBad] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = () => {
    const v = q.trim()
    if (isAddress(v)) nav(`/wallet/${v.toLowerCase()}`)
    else if (isHash(v)) nav(`/tx/${v.toLowerCase()}`)
    else return setBad(true)
    setQ('')
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-panel p-2.5 pl-3">
      <div className="lg:hidden"><Logo nav={nav} size={34} tagline={false} /></div>
      <form className="relative order-last w-full flex-1 sm:order-none sm:w-auto sm:max-w-md" onSubmit={(e) => { e.preventDefault(); submit() }} role="search">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]" aria-hidden="true" />
        <input ref={input} className="input mono !min-h-10 !rounded-xl !pl-9 !pr-14 !text-[13px]" placeholder="Search address or tx hash" value={q} aria-label="Search by address or transaction hash" aria-invalid={bad} onChange={(e) => { setQ(e.target.value); setBad(false) }} />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">Ctrl K</kbd>
        {bad && <span role="alert" className="absolute left-0 top-12 rounded-lg border border-arc-danger/40 bg-pop px-3 py-1.5 text-xs text-[var(--danger)]">Enter a 0x address or a 66-character transaction hash</span>}
      </form>
      <div className="ml-auto flex items-center gap-2 sm:ml-0">
        <Pills />
        <ThemeToggle />
        <ConnectKitButton.Custom>
          {({ isConnected, show, address }) => (
            <button className="btn btn-ghost !min-h-10" onClick={show}>
              <Wallet size={16} aria-hidden="true" />
              {isConnected && address ? <span className="mono">{shortAddr(address)}</span> : <span className="hidden min-[400px]:inline">Connect</span>}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    </div>
  )
}

export function MobileNav({ path, nav }: { path: string; nav: (to: string) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:hidden" aria-label="Primary mobile">
      {ALL.map((n) => (
        <Link key={n.to} to={n.to} navigate={nav} aria-current={isActive(path, n.to) ? 'page' : undefined} className="nav-link !min-h-10 shrink-0 !px-3.5" onPointerEnter={() => prefetchRoute(n.to)}>
          <n.icon size={16} aria-hidden="true" /> {n.label}
        </Link>
      ))}
    </nav>
  )
}

/** Shown only when a wallet is connected to a network other than Arc Mainnet. Switching needs an explicit click. */
export function WalletNetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()
  if (!isConnected || chainId === arcMainnet.id) return null
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-arc-warn/40 bg-arc-warn/10 px-4 py-3 text-sm">
      <AlertTriangle size={16} className="text-[var(--warn)]" />
      <span className="flex-1 text-pretty">Your wallet is on chain {chainId ?? 'unknown'}, not Arc Mainnet (5042). ArcPulse will not read or show wallet data from another network.</span>
      <button className="btn btn-primary !min-h-9" disabled={isPending} onClick={() => switchChain({ chainId: arcMainnet.id })}>
        {isPending ? 'Check your wallet…' : 'Switch to Arc Mainnet'}
      </button>
      {error && <span className="w-full text-xs text-[var(--danger)]">Switch was not completed: {error.message.split('\n')[0]}</span>}
    </div>
  )
}
