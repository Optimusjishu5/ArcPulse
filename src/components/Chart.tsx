import { useId, useState } from 'react'

export interface Point {
  t: number
  v: number
}

interface Props {
  data: Point[]
  kind?: 'bar' | 'area'
  format: (v: number) => string
  axis?: (v: number) => string
  bucketSeconds: number
  height?: number
  color?: string
  ariaLabel: string
}

const W = 640

function labelFor(t: number, bucket: number): string {
  const d = new Date(t * 1000)
  return bucket >= 86400
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
}

/** Small dependency-free SVG chart. Draws only the points it is given. */
export function Chart({ data, kind = 'bar', format, axis, bucketSeconds, height = 170, color = 'var(--accent)', ariaLabel }: Props) {
  const gid = useId()
  const [hover, setHover] = useState<number | null>(null)
  if (data.length === 0) {
    return <div className="flex h-[170px] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] text-sm text-[var(--subtle)]">No indexed data in this window yet</div>
  }
  const padL = 44
  const padB = 22
  const padT = 8
  const innerW = W - padL - 8
  const innerH = height - padB - padT
  const max = Math.max(...data.map((p) => p.v), 0) || 1
  const step = innerW / data.length
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const x = (i: number) => padL + step * i + step / 2
  const ticks = [0, 0.5, 1].map((f) => max * f)
  const path = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${path} L${x(data.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`
  const active = hover !== null ? data[hover] : null
  const fmtAxis = axis ?? format

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.min(data.length - 1, Math.max(0, Math.floor((px - padL) / step))))
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={padL} x2={W - 8} y1={y(tv)} y2={y(tv)} stroke="var(--grid)" />
            <text x={padL - 6} y={y(tv) + 4} textAnchor="end" fontSize="10" fill="var(--subtle)">
              {fmtAxis(tv)}
            </text>
          </g>
        ))}
        {kind === 'bar' ? (
          data.map((p, i) => (
            <rect
              key={p.t}
              x={x(i) - Math.max(1, step * 0.36)}
              width={Math.max(2, step * 0.72)}
              y={y(p.v)}
              height={Math.max(0, padT + innerH - y(p.v))}
              rx={2}
              fill={color}
              opacity={hover === null || hover === i ? 0.95 : 0.4}
            />
          ))
        ) : (
          <>
            <path d={area} fill={`url(#${gid})`} />
            <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          </>
        )}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i, k) => (
          <text key={`${i}-${k}`} x={x(i)} y={height - 5} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fontSize="10" fill="var(--subtle)">
            {labelFor((data[i]).t, bucketSeconds)}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--cursor)" />}
      </svg>
      <div className="mt-1 h-5 text-xs text-[var(--muted)] num" aria-live="polite">
        {active ? `${labelFor(active.t, bucketSeconds)}: ${format(active.v)}` : '\u00a0'}
      </div>
    </div>
  )
}
