import { CONFIG } from './env'

interface ErrorEntry {
  at: string
  scope: string
  message: string
  detail?: string
}

const recent: ErrorEntry[] = []
let lastWebhookAt = 0

/** Strips credentials such as RPC proxy tokens from any string before it is logged. */
export function redact(text: string): string {
  return text
    .replace(/_rpc_token=[^&\s"']+/g, '_rpc_token=REDACTED')
    // Provider keys that live in the URL path, such as https://<network>.g.alchemy.com/v2/<key>
    .replace(/(\/v[0-9]\/)[A-Za-z0-9_-]{16,}/g, '$1REDACTED')
    .replace(/(https?:\/\/)[^/\s"']*:[^@/\s"']*@/g, '$1REDACTED@')
}

export function info(scope: string, message: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), scope, message, ...extra }))
}

export function reportError(scope: string, err: unknown, detail?: string): void {
  const message = redact(err instanceof Error ? err.message : String(err))
  const entry: ErrorEntry = { at: new Date().toISOString(), scope, message, detail: detail ? redact(detail) : undefined }
  recent.unshift(entry)
  if (recent.length > 100) recent.pop()
  console.error(JSON.stringify({ level: 'error', ...entry }))
  const now = Date.now()
  if (CONFIG.errorWebhook && now - lastWebhookAt > 10_000) {
    lastWebhookAt = now
    fetch(CONFIG.errorWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'arcpulse', ...entry }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
  }
}

export const recentErrors = (): ErrorEntry[] => recent.slice(0, 50)
