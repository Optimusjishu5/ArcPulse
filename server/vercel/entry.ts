/** Vercel Node function: serves every /api/* route from the shared ArcPulse API code. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { errorResponse, route } from '../api'

const SNAPSHOT_PATHS = new Set(['/api/analytics', '/api/whales', '/api/contracts/top'])

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`)
  // vercel.json rewrites every /api/* request to this one function and passes the original path as __p.
  const original = url.searchParams.get('__p')
  if (original !== null) {
    url.searchParams.delete('__p')
    url.pathname = `/api/${original}`
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(', '))
  }
  const method = req.method ?? 'GET'
  let body: Buffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
    body = Buffer.concat(chunks)
  }
  let response: Response
  try {
    response = await route(new Request(url, { method, headers, body: body as unknown as BodyInit | undefined }), url)
  } catch (err) {
    response = errorResponse(err)
  }
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (response.status === 200 && method === 'GET') {
    // Snapshot data changes only on redeploy; live data may be shared for one second at most.
    res.setHeader('cache-control', SNAPSHOT_PATHS.has(url.pathname) ? 'public, s-maxage=60' : 'public, s-maxage=1')
  }
  res.end(Buffer.from(await response.arrayBuffer()))
}
