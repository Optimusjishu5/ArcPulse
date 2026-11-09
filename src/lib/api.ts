import { keepPreviousData, useQuery } from '@tanstack/react-query'

export interface Meta {
  chainId: number
  chainName: string
  chainVerified: boolean
  source: 'rpc' | 'indexer' | 'rpc+indexer'
  headBlock: number | null
  headTimestamp: number | null
  headAgeSeconds: number | null
  fetchedAt: string
  live: boolean
}

/** Base URL of the ArcPulse API. Empty means same origin (the bundled server or the Vite proxy). */
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface Envelope<T> {
  meta?: Meta
  data: T
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<Envelope<T>> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { signal, headers: { accept: 'application/json' } })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the ArcPulse API')
  }
  const body = (await res.json().catch(() => null)) as (Envelope<T> & { error?: { code: string; message: string } }) | null
  if (body === null) {
    // A static host answers /api/* with its HTML fallback or a 404 page: there is no ArcPulse server behind this origin.
    throw new ApiError(res.status, 'NO_BACKEND', 'No ArcPulse API server is connected to this deployment.')
  }
  if (!res.ok || !body || body.error) {
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status})`)
  }
  return body
}

export interface ApiResult<T> {
  data: T | undefined
  meta: Meta | undefined
  error: ApiError | undefined
  loading: boolean
  fetching: boolean
  /** True while the payload on screen belongs to the previous request. */
  placeholder: boolean
  /** True when the chain head behind this payload is too old to call "live". */
  stale: boolean
  refetch: () => void
}

/**
 * Data hook. When a request fails, the previous payload is withheld instead of being shown as if it were current.
 */
export function useApi<T>(path: string | null, opts: { refetchMs?: number; keepPrevious?: boolean } = {}): ApiResult<T> {
  const q = useQuery({
    queryKey: ['api', path],
    enabled: path !== null,
    queryFn: ({ signal }) => apiGet<T>(path as string, signal),
    refetchInterval: opts.refetchMs,
    retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status > 0 && err.status < 500),
    staleTime: 0,
    gcTime: 60_000,
    // Only used when switching a filter on indexed history: the old window stays visible, dimmed, until the new one lands.
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
  const failed = q.isError
  const meta = failed ? undefined : q.data?.meta
  return {
    data: failed ? undefined : q.data?.data,
    meta,
    error: failed ? (q.error instanceof ApiError ? q.error : new ApiError(0, 'UNKNOWN', 'Request failed')) : undefined,
    loading: q.isLoading,
    fetching: q.isFetching,
    placeholder: q.isPlaceholderData,
    stale: meta ? meta.source !== 'indexer' && !meta.live : false,
    refetch: () => void q.refetch(),
  }
}
