import { getUsdc } from '@/onchain-facts'

/**
 * Tokens with an official logo, keyed by contract address (never by symbol, so a lookalike token
 * cannot borrow a real logo). Addresses are the Arc Mainnet entries on https://docs.arc.io/arc/references/contract-addresses
 * except USDC, which comes from the generated facts module.
 */
// arc-studio-allow-onchain-literal
const DOCS_LISTED = {
  eurc: '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1',
  usyc: '0x8a5d989bbb96929f689b0200f435f53da42bf490',
  cirbtc: '0x171a4217b86a807a64eb94757db6849fb4bdbaa0',
  weth: '0x128cc466b61f542da60c70e3aa11c10e19b84edb',
} as const

const usdcAddress = (getUsdc(5042)?.address ?? '').toLowerCase()

export type LogoKey = 'usdc' | 'eurc' | 'eth'

export interface OfficialToken {
  symbol: string
  /** Bundled logo, when an original one is available. Tokens without one render a neutral initials mark. */
  logo?: LogoKey
}

export const OFFICIAL_TOKENS: Record<string, OfficialToken> = {
  [usdcAddress]: { symbol: 'USDC', logo: 'usdc' },
  [DOCS_LISTED.eurc]: { symbol: 'EURC', logo: 'eurc' },
  [DOCS_LISTED.weth]: { symbol: 'WETH', logo: 'eth' },
  [DOCS_LISTED.cirbtc]: { symbol: 'cirBTC' },
  [DOCS_LISTED.usyc]: { symbol: 'USYC' },
}

const OFFICIAL_SYMBOLS = new Set(Object.values(OFFICIAL_TOKENS).map((t) => t.symbol.toUpperCase()))

export const officialToken = (address: string): OfficialToken | undefined => OFFICIAL_TOKENS[address.toLowerCase()]

/** True when a token reuses the symbol of an official asset but is a different contract. */
export const isLookalike = (address: string, symbol: string | null): boolean =>
  symbol !== null && OFFICIAL_SYMBOLS.has(symbol.trim().toUpperCase()) && !officialToken(address)
