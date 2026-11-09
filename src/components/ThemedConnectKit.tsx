import type { ReactNode } from 'react'
import { ConnectKitProvider } from 'connectkit'
import { useTheme } from '@/lib/theme'

const THEMES = {
  dark: {
    '--ck-font-family': "'DM Sans', sans-serif",
    '--ck-primary-button-background': '#acc6e9',
    '--ck-primary-button-color': '#0d1b2f',
    '--ck-body-background': '#0d1b2f',
    '--ck-body-color': '#f9faf3',
  },
  light: {
    '--ck-font-family': "'DM Sans', sans-serif",
    '--ck-primary-button-background': '#5b4fd6',
    '--ck-primary-button-color': '#ffffff',
    '--ck-body-background': '#ffffff',
    '--ck-body-color': '#14183a',
  },
} as const

/** Wallet modal that follows the app theme. */
export function ThemedConnectKit({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return (
    <ConnectKitProvider mode={resolved} customTheme={THEMES[resolved]}>
      {children}
    </ConnectKitProvider>
  )
}
