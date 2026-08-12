/**
 * Client provenance for a request: the caller's address and User-Agent, shaped so
 * the columns that store them cannot reject the write.
 *
 * `auth_sessions`, `audit_events` and `auth_login_events` all constrain
 * `user_agent` to <=512 bytes with no control characters, and all store
 * `ip_address` as `inet`. Both values are attacker-controlled, so writing them
 * raw makes a crafted header able to fail an INSERT — which on a login's success
 * path would roll back a legitimate sign-in. Normalising here means provenance is
 * always storable or always null, never a source of 500s.
 *
 * These values are provenance, not identity: nothing authorises off them.
 */
import { isIP } from "node:net"

import type { FastifyRequest } from "fastify"

const USER_AGENT_MAX_BYTES = 512

/**
 * Keep only what `inet` accepts, else null.
 *
 * Uses `node:net`'s parser rather than a regex. A hand-rolled pattern let through
 * strings PostgreSQL refuses — `":::"`, `"1.2.3.4:80"`, `"1:2:3:4:5:6:7:8:9"`,
 * and leading-zero octets like `"01.2.3.4"`, which PostgreSQL 16 no longer
 * tolerates. That matters because the success-path INSERT runs inside the
 * session-issuing transaction, so an unstorable address would abort a sign-in
 * whose password was correct — and once `trustProxy` is on, the value derives
 * from a client-supplied header.
 */
export const normalizeIpAddress = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  return isIP(trimmed) === 0 ? null : trimmed
}

/** Strip control characters and bound to 512 UTF-8 bytes, else null. */
export const sanitizeUserAgent = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim()
  if (stripped === "") return null
  let bounded = stripped
  // Trim by code point so a multi-byte character is never cut in half.
  while (Buffer.byteLength(bounded, "utf8") > USER_AGENT_MAX_BYTES) {
    bounded = bounded.slice(0, -1)
  }
  return bounded === "" ? null : bounded
}

export interface RequestProvenance {
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

export const requestProvenance = (request: FastifyRequest): RequestProvenance => ({
  ipAddress: normalizeIpAddress(request.ip),
  userAgent: sanitizeUserAgent(request.headers["user-agent"]),
})
