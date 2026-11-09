import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ApiError } from '@/lib/api'
import { addressUrl, shortAddr, shortHash, timeAgo, txUrl } from '@/lib/format'
import { Link } from '@/lib/route'

export type Nav = (to: string) => void

export function Card({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="display text-lg font-semibold text-balance">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-[var(--subtle)] text-pretty">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, loading }: { label: string; value: ReactNode; sub?: ReactNode; loading?: boolean }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="label">{label}</div>
      {loading ? (
        <div className="skeleton mt-3 h-8 w-28" />
      ) : (
        <div className="display num mt-2 text-2xl font-semibold sm:text-3xl">{value}</div>
      )}
      {sub && <div className="mt-1 text-xs text-[var(--subtle)]">{sub}</div>}
    </div>
  )
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-9 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError | undefined; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-arc-danger/40 bg-arc-danger/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-[var(--danger)]">
        <AlertTriangle size={16} /> {error?.code === 'RPC_UNAVAILABLE' ? 'Arc Mainnet data is unavailable' : 'Could not load data'}
      </div>
      <p className="text-[var(--muted)] text-pretty">{error?.message ?? 'Unknown error'} No cached data is shown in its place.</p>
      {onRetry && (
        <button className="btn btn-ghost !min-h-9" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--subtle)] text-pretty">{children}</p>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-soft text-[var(--muted)]',
    good: 'bg-arc-success/15 text-[var(--success)]',
    bad: 'bg-arc-danger/15 text-[var(--danger)]',
    warn: 'bg-arc-warn/15 text-[var(--warn)]',
    accent: 'bg-arc-accent/15 text-[var(--accent)]',
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

export function AddressLink({ address, nav, label }: { address: string; nav: Nav; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={`/wallet/${address}`} navigate={nav} className="link mono" title={address}>
        {label ?? shortAddr(address)}
      </Link>
      <a href={addressUrl(address)} target="_blank" rel="noopener noreferrer" aria-label="Open address on explorer.arc.io" className="text-[var(--subtle)] hover:text-[var(--ink)]">
        <ExternalLink size={12} />
      </a>
    </span>
  )
}

export function TxLink({ hash, nav }: { hash: string; nav?: Nav }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {nav ? (
        <Link to={`/tx/${hash}`} navigate={nav} className="link mono" title={hash}>
          {shortHash(hash)}
        </Link>
      ) : (
        <span className="mono" title={hash}>{shortHash(hash)}</span>
      )}
      <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer" aria-label="Open transaction on explorer.arc.io" className="text-[var(--subtle)] hover:text-[var(--ink)]">
        <ExternalLink size={12} />
      </a>
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.id} className="chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Updated({ ts }: { ts: string | undefined }) {
  if (!ts) return null
  return <span className="text-xs text-[var(--subtle)]">Updated {timeAgo(Math.floor(new Date(ts).getTime() / 1000))}</span>
}

export function CoverageBar({ coverage, label }: { coverage: number; label: string }) {
  const pct = Math.round(coverage * 100)
  const complete = pct >= 97
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--subtle)]">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} index coverage`}>
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {complete ? `${label} fully indexed` : `${label} index ${pct}% complete. Charts cover indexed blocks only while history backfills.`}
      </span>
    </div>
  )
}
