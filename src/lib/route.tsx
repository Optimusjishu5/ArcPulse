import { useCallback, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

const current = () => window.location.pathname + window.location.search

/** Minimal path router. Links keep shareable state in the path and query, never in a fragment. */
export function useLocation(): { path: string; search: URLSearchParams; navigate: (to: string) => void } {
  const [loc, setLoc] = useState(current())
  useEffect(() => {
    const onPop = () => setLoc(current())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string) => {
    if (to === current()) return
    window.history.pushState({}, '', to)
    setLoc(current())
    window.scrollTo({ top: 0 })
  }, [])
  const [path = '/', query = ''] = loc.split('?')
  return { path, search: new URLSearchParams(query), navigate }
}

export function Link({ to, navigate, children, ...rest }: { to: string; navigate: (to: string) => void; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}
