/**
 * Client IP for rate-limit keys, resolved the way a reverse proxy
 * deployment has to: trust only what OUR proxies wrote.
 *
 * `X-Forwarded-For` is "client, proxy1, proxy2" — each proxy APPENDS
 * the address it received the request from. Anything to the left of the
 * entries our own proxies added is whatever the caller chose to send,
 * so the old "first entry" rule let anyone dodge the login / signup /
 * reset limits by sending a fresh fake `X-Forwarded-For` per request.
 *
 * TRUSTED_PROXY_HOPS (default 1 — Traefik/EasyPanel or nginx in front
 * of the container) is how many of the right-most entries our own
 * proxies appended; the entry just left of those is the real client.
 * `X-Real-IP` (set by the proxy, overwriting any client value) is used
 * when there's no forwarded chain.
 */
export function getClientIp(request: Request): string {
  const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1)
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (chain.length > 0) {
    return chain[Math.max(0, chain.length - hops)]
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  return realIp || 'unknown'
}
