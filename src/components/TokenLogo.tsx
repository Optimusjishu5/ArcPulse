import { memo } from 'react'
import { TokenETH, TokenEURC, TokenUSDC } from '@web3icons/react'
import { officialToken, type LogoKey } from '@/lib/tokens'

const LOGOS: Record<LogoKey, typeof TokenUSDC> = { usdc: TokenUSDC, eurc: TokenEURC, eth: TokenETH }

function hue(address: string): number {
  let h = 0
  for (let i = 2; i < address.length; i += 1) h = (h * 31 + address.charCodeAt(i)) % 360
  return h
}

/**
 * Original logo for tokens verified by contract address; every other token gets a neutral initials mark
 * (clearly not a brand logo). All variants share one square box so rows line up exactly.
 */
export const TokenLogo = memo(function TokenLogo({ address, symbol, size = 36 }: { address: string; symbol: string | null; size?: number }) {
  const official = officialToken(address)
  const Icon = official?.logo ? LOGOS[official.logo] : null
  const box = { width: size, height: size, minWidth: size }
  if (Icon) {
    return (
      <span className="grid shrink-0 place-items-center overflow-hidden rounded-full" style={box} title={`${official?.symbol} (official contract)`}>
        <Icon variant="branded" size={size} aria-hidden="true" />
      </span>
    )
  }
  const text = (symbol ?? '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
  const h = hue(address)
  return (
    <span
      className="grid shrink-0 select-none place-items-center rounded-full border font-bold"
      style={{ ...box, fontSize: Math.max(9, size * (text.length > 2 ? 0.28 : 0.34)), color: `hsl(${h} 70% var(--tl-fg))`, background: `hsl(${h} 45% var(--tl-bg))`, borderColor: `hsl(${h} 50% 50% / 0.45)` }}
      title={official ? `${official.symbol} (official contract, no bundled logo)` : 'No verified logo for this token'}
      aria-hidden="true"
    >
      {text}
    </span>
  )
})
