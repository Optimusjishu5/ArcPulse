/**
 * Stand-in for the SQLite handle in the serverless build, which has no database.
 * Only the immutable token metadata cache is kept (in memory, per warm instance).
 */
const tokenMeta = new Map<string, Record<string, unknown>>()

export const db = {
  query(sql: string) {
    return {
      get: (...args: unknown[]): unknown => (/FROM token_meta/.test(sql) ? (tokenMeta.get(String(args[0])) ?? null) : null),
      all: (): unknown[] => [],
      run: (...args: unknown[]): void => {
        if (/INTO token_meta/.test(sql)) tokenMeta.set(String(args[0]), { address: args[0], name: args[1], symbol: args[2], decimals: args[3] })
      },
    }
  },
  exec: (): void => undefined,
  transaction: <T>(fn: () => T) => fn,
}

export const getMeta = (): string | null => null
export const setMeta = (): void => undefined
