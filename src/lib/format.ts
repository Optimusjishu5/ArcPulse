import { buildAddressExplorerUrl, buildTxExplorerUrl, requireChain } from '@/onchain-facts'
import { Amount } from '@/onchain-money'

export const CHAIN_ID = 5042

export const txUrl = (hash: string): string => buildTxExplorerUrl(CHAIN_ID, hash)
export const addressUrl = (address: string): string => buildAddressExplorerUrl(CHAIN_ID, address)

export const blockUrl = (n: number): string => `${requireChain(CHAIN_ID).explorerBase}/block/${n}`

export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
export const shortHash = (h: string): string => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h)

const withCommas = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Formats an integer smallest-unit amount using its own decimal count. Never mixes the 18- and 6-decimal USDC views. */
export function fmtRaw(raw: string | bigint, decimals: number, digits = 2): string {
  const fixed = Amount.fromRaw(BigInt(raw), decimals).toFixed(digits)
  const neg = fixed.startsWith('-')
  const [whole = '0', frac] = (neg ? fixed.slice(1) : fixed).split('.')
  return `${neg ? '-' : ''}${withCommas(whole)}${frac ? `.${frac}` : ''}`
}

/** Compact display for chart axes where volumes are already plain numbers in USDC units. */
export function fmtCompact(n: number, digits = 1): string {
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`
  return n.toFixed(abs < 10 && abs > 0 ? 2 : 0)
}

export const fmtInt = (n: number): string => withCommas(Math.round(n).toString())

export function timeAgo(tsSeconds: number | null | undefined, now = Date.now()): string {
  if (!tsSeconds) return 'n/a'
  const s = Math.max(0, Math.floor(now / 1000 - tsSeconds))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const fmtDateTime = (tsSeconds: number | null | undefined): string =>
  tsSeconds ? new Date(tsSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : 'n/a'

export const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v.trim())
export const isHash = (v: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(v.trim())

export const TX_TYPE_LABEL: Record<string, string> = {
  'native-transfer': 'Native USDC transfer',
  'usdc-transfer': 'ERC-20 USDC transfer',
  'contract-call': 'Contract call',
  creation: 'Contract creation',
  plain: 'Zero-value tx',
}
