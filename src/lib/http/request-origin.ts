// ============================================================
// getPublicOrigin — resolve the publicly reachable origin (scheme +
// host, no trailing slash) for the current request.
//
// `request.nextUrl.origin` / `new URL(request.url).origin` reflect
// whatever the Node process itself is bound to. Behind a reverse
// proxy that doesn't rewrite the Host header (EasyPanel, many Docker
// Compose + nginx/Traefik setups), that's the *internal* bind address
// — e.g. `http://0.0.0.0:80` — not the domain the browser actually
// used. Building a redirect target from that origin sends users to a
// URL that only resolves inside the container's network, which is
// exactly the "redirect goes to 0.0.0.0" failure mode.
//
// Resolution order, first match wins (same reasoning as
// `getBaseUrl` in /api/account/invitations/route.ts):
//   1. `NEXT_PUBLIC_SITE_URL` — explicit operator config, always wins.
//   2. `X-Forwarded-Proto` + `X-Forwarded-Host` — set by every
//      reverse proxy in front of the app (EasyPanel, Vercel,
//      Cloudflare, nginx, Traefik).
//   3. `Host` header + the request's own protocol — bare
//      deployments with no proxy in front.
//   4. Last-resort fallback to the raw request URL's origin.
// ============================================================

export function getPublicOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }

  const host = request.headers.get('host')?.trim()
  if (host) {
    const proto = new URL(request.url).protocol.replace(':', '')
    return `${proto}://${host}`
  }

  return new URL(request.url).origin
}
