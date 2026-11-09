import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeChoice } from '@/lib/theme'

const OPTIONS: Array<{ id: ThemeChoice; label: string; icon: typeof Sun }> = [
  { id: 'light', label: 'Light theme', icon: Sun },
  { id: 'dark', label: 'Dark theme', icon: Moon },
  { id: 'system', label: 'Match system theme', icon: Monitor },
]

export function ThemeToggle() {
  const { choice, setChoice } = useTheme()
  const current = OPTIONS.find((o) => o.id === choice) ?? OPTIONS[1]
  const next = OPTIONS[(OPTIONS.findIndex((o) => o.id === choice) + 1) % OPTIONS.length] ?? OPTIONS[0]
  return (
    <>
    <button
      type="button"
      className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-panel text-[var(--ink-2)] sm:hidden"
      aria-label={`Theme: ${current?.label ?? 'Dark theme'}. Switch to ${next?.label ?? 'light theme'}`}
      onClick={() => next && setChoice(next.id)}
    >
      {current && <current.icon size={16} aria-hidden="true" />}
    </button>
    <div role="radiogroup" aria-label="Theme" className="hidden items-center gap-0.5 sm:flex rounded-xl border border-[var(--border)] bg-panel p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={choice === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => setChoice(o.id)}
          className={`grid h-9 w-9 place-items-center rounded-[10px] transition-colors ${choice === o.id ? 'bg-soft text-[var(--ink)] shadow-sm' : 'text-[var(--subtle)] hover:text-[var(--ink)]'}`}
        >
          <o.icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
    </>
  )
}
