/** Route chunks. Hovering or focusing a nav link starts the download so the click renders instantly. */
export const loaders = {
  overview: () => import('@/pages/Overview'),
  whales: () => import('@/pages/Whales'),
  wallet: () => import('@/pages/WalletPage'),
  tokens: () => import('@/pages/Tokens'),
  contracts: () => import('@/pages/Contracts'),
  tx: () => import('@/pages/TxPage'),
  status: () => import('@/pages/Status'),
}

const started = new Set<string>()

export function prefetchRoute(path: string): void {
  const head = path.split('/').filter(Boolean)[0] ?? ''
  const key = head === '' ? 'overview' : head === 'contract' ? 'contracts' : head
  if (started.has(key) || !(key in loaders)) return
  started.add(key)
  void loaders[key as keyof typeof loaders]()
}
