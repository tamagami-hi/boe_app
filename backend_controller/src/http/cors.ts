/**
 * Cross-origin access for the browser clients (spec 04 §2.2).
 *
 * Both browser surfaces call this API from a different origin than they are
 * served from: the client APK runs inside a Capacitor WebView on
 * `https://localhost` (or `capacitor://localhost`) and the admin console runs on
 * the Vite dev origin. Without CORS response headers the browser discards every
 * reply, so the app cannot even reach `GET /v1/health` — which is exactly what
 * the emulator run showed.
 *
 * The allowlist is the same one the web-auth Origin check uses, so a single
 * `WEB_ORIGIN_ALLOWLIST` (or legacy `CORS_ORIGIN`) drives both. Rules:
 *
 *  - The origin is reflected only when allow-listed; `*` is never sent, because
 *    the admin console relies on cookies and `*` is illegal with credentials.
 *  - `Vary: Origin` keeps shared caches from serving one origin's headers to
 *    another.
 *  - Preflights are answered here and never reach a route, so `OPTIONS` does not
 *    need to be registered per path.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

/** Methods any route in this API may use. */
const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS"

/**
 * Request headers the clients send: JSON content type, native bearer tokens,
 * idempotency keys on writes, optimistic-concurrency `If-Match`, the admin CSRF
 * synchroniser token, the request-id used to correlate logs, and the native
 * platform and app version the native auth contract declares.
 */
const ALLOWED_HEADERS =
  "content-type, authorization, idempotency-key, if-match, x-csrf-token, x-request-id, x-client-platform, x-app-version"

/** Response headers the clients read off the reply. */
const EXPOSED_HEADERS = "x-request-id, etag, retry-after"

const PREFLIGHT_MAX_AGE_SECONDS = "600"

/** Reads the single `Origin` value, matching how the boundary reads request ids. */
const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const originOf = (request: FastifyRequest): string | undefined => firstHeader(request.headers.origin)

/**
 * Applies the headers for an allow-listed origin. Returns false when the origin
 * is absent (same-origin or a non-browser client) or not allow-listed, in which
 * case no CORS headers are emitted and the browser blocks the reply itself.
 */
const applyCorsHeaders = (
  request: FastifyRequest,
  reply: FastifyReply,
  allowlist: readonly string[],
): boolean => {
  reply.header("vary", "Origin")
  const origin = originOf(request)
  if (origin === undefined || !allowlist.includes(origin)) return false
  reply.header("access-control-allow-origin", origin)
  reply.header("access-control-allow-credentials", "true")
  reply.header("access-control-expose-headers", EXPOSED_HEADERS)
  return true
}

export const registerCors = (application: FastifyInstance, allowlist: readonly string[]): void => {
  application.addHook("onRequest", (request, reply, done) => {
    const allowed = applyCorsHeaders(request, reply, allowlist)

    // Only a real preflight carries `Access-Control-Request-Method`; a bare OPTIONS
    // is left to the router (which 404s it) so the route surface stays unchanged.
    const isPreflight =
      request.method === "OPTIONS" && firstHeader(request.headers["access-control-request-method"]) !== undefined
    if (!isPreflight) {
      done()
      return
    }

    // Answer here regardless of allow-listing. A disallowed origin gets a 204 with
    // no CORS headers, which the browser treats as a failed preflight.
    if (allowed) {
      reply.header("access-control-allow-methods", ALLOWED_METHODS)
      reply.header("access-control-allow-headers", ALLOWED_HEADERS)
      reply.header("access-control-max-age", PREFLIGHT_MAX_AGE_SECONDS)
    }
    reply.code(204).send()
  })
}
