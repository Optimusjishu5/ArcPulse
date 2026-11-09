import { memo, useId } from 'react'
import { Link } from '@/lib/route'

const LETTERS_A = 'Arc'.split('')

/** Pulse mark: the line draws itself once, then a bright glint travels along it on a slow loop. */
const Mark = memo(function Mark({ size }: { size: number }) {
  const gid = useId()
  const path = 'M4 18h5.5l3-9 5 15 3-9H28'
  return (
    <span className="logo-mark grid shrink-0 place-items-center rounded-[11px]" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#a99bff" />
            <stop offset="100%" stopColor="#4fd1c5" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="10" fill={`url(#${gid})`} />
        <path d={path} pathLength={1} fill="none" stroke="#120f2e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="logo-trace" />
        <path d={path} pathLength={1} fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="logo-glint" />
      </svg>
    </span>
  )
})

export const Logo = memo(function Logo({ nav, size = 36, tagline = true }: { nav: (to: string) => void; size?: number; tagline?: boolean }) {
  return (
    <Link to="/" navigate={nav} className="logo group flex items-center gap-2.5" aria-label="ArcPulse home">
      <Mark size={size} />
      <span className="leading-none">
        <span className="sr-only">ArcPulse</span>
        <span className="display logo-word block text-[1.35rem] font-bold" aria-hidden="true">
          <span className="logo-arc">
            {LETTERS_A.map((c, i) => (
              <span key={c + i} className="logo-letter" style={{ ['--n' as string]: i }}>{c}</span>
            ))}
          </span>
          <span className="logo-pulse">Pulse</span>
        </span>
        {tagline && <span aria-hidden="true" className="logo-tag mt-1.5 block text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[var(--subtle)]">Arc Mainnet intel</span>}
      </span>
    </Link>
  )
})
