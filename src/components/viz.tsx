import { memo, useId, useMemo, useState } from 'react'

export interface Pt {
  t: number
  v: number
}

type XY = [number, number]

/** Catmull-Rom to cubic Bezier, clamped so curves never dip below the baseline. */
function smooth(pts: XY[], floor: number): string {
  const first = pts[0]
  if (!first) return ''
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p0 = pts[i - 1] ?? p1
    const p3 = pts[i + 2] ?? p2
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)
    const c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${c1y.toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

export const labelFor = (t: number, bucket: number): string => {
  const d = new Date(t * 1000)
  return bucket >= 86400
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
}

export const Sparkline = memo(function Sparkline({ data, color = 'var(--accent)', height = 48 }: { data: number[]; color?: string; height?: number }) {
  const gid = useId()
  const { line, area } = useMemo(() => {
    const W = 140
    const max = Math.max(...data, 0)
    const min = Math.min(...data, max)
    const span = max - min || 1
    const pts: XY[] = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * W, height - 4 - ((v - min) / span) * (height - 10)])
    const l = smooth(pts, height - 2)
    return { line: l, area: pts.length > 1 ? `${l} L${W},${height} L0,${height} Z` : '' }
  }, [data, height])
  if (data.length < 2) return <div style={{ height }} aria-hidden="true" />
  return (
    <svg viewBox={`0 0 140 ${height}`} preserveAspectRatio="none" className="fade-in w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  )
})

export const Gauge = memo(function Gauge({ value, label }: { value: number; label: string }) {
  const gid = useId()
  const v = Math.min(1, Math.max(0, value))
  return (
    <svg viewBox="0 0 120 74" className="w-28 shrink-0" role="img" aria-label={`${label}: ${(v * 100).toFixed(1)}%`}>
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0%" stopColor="var(--pink)" />
          <stop offset="50%" stopColor="var(--violet)" />
          <stop offset="100%" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
      <path d="M10,64 A50,50 0 0 1 110,64" pathLength="100" fill="none" stroke="var(--soft)" strokeWidth="9" strokeLinecap="round" />
      <path d="M10,64 A50,50 0 0 1 110,64" pathLength="100" fill="none" stroke={`url(#${gid})`} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${Math.max(0.8, v * 100)} 100`} style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.2,0.7,0.2,1)' }} />
      <text x="60" y="62" textAnchor="middle" fontSize="19" fontWeight="600" fill="var(--ink)" className="display">
        {(v * 100).toFixed(v < 0.1 ? 1 : 0)}%
      </text>
    </svg>
  )
})

interface Series {
  name: string
  color: string
  data: Pt[]
}

const W = 720
const H = 250

/** Smooth multi-series line/area chart with a soft glow and a shared hover readout. */
export const GlowChart = memo(function GlowChart({ series, bucketSeconds, format, axis }: { series: Series[]; bucketSeconds: number; format: (v: number) => string; axis: (v: number) => string }) {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const n = series[0]?.data.length ?? 0
  const geo = useMemo(() => {
    const padL = 46
    const padB = 24
    const padT = 10
    const iw = W - padL - 10
    const ih = H - padB - padT
    const max = Math.max(1, ...series.flatMap((s) => s.data.map((p) => p.v)))
    const x = (i: number) => padL + (i / Math.max(1, n - 1)) * iw
    const y = (v: number) => padT + ih - (v / max) * ih
    const paths = series.map((s) => {
      const pts: XY[] = s.data.map((p, i) => [x(i), y(p.v)])
      const line = smooth(pts, padT + ih)
      return { line, area: pts.length > 1 ? `${line} L${x(n - 1).toFixed(1)},${padT + ih} L${x(0).toFixed(1)},${padT + ih} Z` : '' }
    })
    return { padL, padB, padT, ih, max, x, y, paths }
  }, [series, n])
  if (n < 2) {
    return <div className="flex h-[250px] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] text-sm text-[var(--subtle)]">Not enough indexed data in this window yet</div>
  }
  const first = series[0]
  const active = hover !== null ? hover : null
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y"
        role="img"
        aria-label={series.map((s) => s.name).join(' and ')}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.min(n - 1, Math.max(0, Math.round(((px - geo.padL) / (W - geo.padL - 10)) * (n - 1)))))
        }}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${uid}-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={geo.padL} x2={W - 10} y1={geo.y(geo.max * f)} y2={geo.y(geo.max * f)} stroke="var(--grid)" strokeDasharray="3 5" />
            <text x={geo.padL - 8} y={geo.y(geo.max * f) + 4} textAnchor="end" fontSize="10.5" fill="var(--subtle)">{axis(geo.max * f)}</text>
          </g>
        ))}
        {geo.paths.map((p, i) => (
          <g key={series[i]?.name}>
            <path d={p.area} fill={`url(#${uid}-${i})`} className="fade-in" />
            <path d={p.line} pathLength={1} fill="none" stroke={series[i]?.color} strokeWidth="2.4" strokeLinecap="round" className="draw" style={{ filter: `drop-shadow(0 0 6px ${series[i]?.color})` }} />
          </g>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
          <text key={`${i}-${k}`} x={geo.x(i)} y={H - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fontSize="10.5" fill="var(--subtle)">
            {labelFor((first.data[i]).t, bucketSeconds)}
          </text>
        ))}
        {active !== null && (
          <g>
            <line x1={geo.x(active)} x2={geo.x(active)} y1={geo.padT} y2={geo.padT + geo.ih} stroke="var(--cursor)" />
            {series.map((s) => (
              <circle key={s.name} cx={geo.x(active)} cy={geo.y((s.data[active]).v)} r="4.5" fill="var(--solid)" stroke={s.color} strokeWidth="2.4" />
            ))}
          </g>
        )}
      </svg>
      <div className="flex min-h-6 flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--muted)] num" aria-live="polite">
        {active !== null ? (
          <>
            <span className="text-[var(--subtle)]">{labelFor((first.data[active]).t, bucketSeconds)}</span>
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: <b className="font-semibold text-[var(--ink)]">{format((s.data[active]).v)}</b></span>
            ))}
          </>
        ) : (
          series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)
        )}
      </div>
    </div>
  )
})

const hueFor = (f: number): number => 268 - f * 268

export const RainbowBars = memo(function RainbowBars({ data, bucketSeconds, format }: { data: Pt[]; bucketSeconds: number; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (data.length === 0) return <div className="flex h-[210px] items-center justify-center text-sm text-[var(--subtle)]">No indexed data yet</div>
  const max = Math.max(1, ...data.map((p) => p.v))
  return (
    <div>
      <div className="flex h-[190px] items-end gap-[3px]" onPointerLeave={() => setHover(null)}>
        {data.map((p, i) => {
          const hue = hueFor(data.length > 1 ? i / (data.length - 1) : 0)
          return (
            <div key={p.t} className="relative flex h-full flex-1 items-end" onPointerEnter={() => setHover(i)}>
              <div
                className="bar-grow w-full rounded-t-md"
                style={{
                  ['--i' as string]: i,
                  height: `${Math.max(2, (p.v / max) * 100)}%`,
                  background: `linear-gradient(180deg, hsl(${hue} 85% 68%), hsl(${hue} 70% 52% / 0.75))`,
                  opacity: hover === null || hover === i ? 1 : 0.45,
                  transition: 'opacity 0.15s',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between text-xs text-[var(--subtle)] num" aria-live="polite">
        {hover !== null ? (
          <span className="text-[var(--ink)]">{labelFor((data[hover]).t, bucketSeconds)}: <b>{format((data[hover]).v)}</b></span>
        ) : (
          <>
            <span>{labelFor((data[0]).t, bucketSeconds)}</span>
            <span>{labelFor((data[data.length - 1]).t, bucketSeconds)}</span>
          </>
        )}
      </div>
    </div>
  )
})

export interface Slice {
  label: string
  value: number
  color: string
}

export const Donut = memo(function Donut({ slices, centerValue, centerLabel }: { slices: Slice[]; centerValue: string; centerLabel: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = slices.reduce((n, s) => n + s.value, 0)
  let offset = 0
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-around">
      <svg viewBox="0 0 120 120" className="h-44 w-44 shrink-0 -rotate-90" role="img" aria-label="Transaction type mix">
        <circle cx="60" cy="60" r="42" fill="none" stroke="var(--soft)" strokeWidth="16" />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.value / total) * 100
            const el = (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r="42"
                pathLength="100"
                fill="none"
                stroke={s.color}
                strokeWidth={hover === s.label ? 19 : 16}
                strokeDasharray={`${Math.max(0, len - 1.2)} ${100 - Math.max(0, len - 1.2)}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-width 0.15s', filter: hover === s.label ? `drop-shadow(0 0 5px ${s.color})` : undefined }}
                onPointerEnter={() => setHover(s.label)}
                onPointerLeave={() => setHover(null)}
              />
            )
            offset += len
            return el
          })}
        <g className="rotate-90" style={{ transformOrigin: '60px 60px' }}>
          <text x="60" y="60" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink)" className="display">{centerValue}</text>
          <text x="60" y="75" textAnchor="middle" fontSize="8.5" fill="var(--subtle)">{centerLabel}</text>
        </g>
      </svg>
      <ul className="w-full max-w-[230px] space-y-2.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3" onPointerEnter={() => setHover(s.label)} onPointerLeave={() => setHover(null)}>
            <span className="inline-flex items-center gap-2 text-[var(--muted)]"><i className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="num font-semibold">{total > 0 ? `${Math.round((s.value / total) * 100)}%` : '0%'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
})
