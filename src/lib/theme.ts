import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const KEY = 'arcpulse-theme'
const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null

function read(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

let choice: ThemeChoice = typeof window !== 'undefined' ? read() : 'dark'

export const resolve = (c: ThemeChoice): ResolvedTheme => (c === 'system' ? (media?.matches ? 'light' : 'dark') : c)

function apply(): void {
  const resolved = resolve(choice)
  const root = document.documentElement
  root.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f4f3fb' : '#090a1c')
}

export function setTheme(next: ThemeChoice): void {
  choice = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this session.
  }
  const root = document.documentElement
  root.classList.add('theme-fade')
  apply()
  window.setTimeout(() => root.classList.remove('theme-fade'), 300)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  apply()
  media?.addEventListener('change', () => {
    if (choice === 'system') {
      apply()
      listeners.forEach((l) => l())
    }
  })
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; setChoice: (c: ThemeChoice) => void } {
  const current = useSyncExternalStore<ThemeChoice>(subscribe, () => choice, () => 'dark')
  const resolved = useSyncExternalStore<ResolvedTheme>(subscribe, () => resolve(choice), () => 'dark')
  return { choice: current, resolved, setChoice: setTheme }
}
