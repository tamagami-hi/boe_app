/**
 * Refresh / CSRF token derivation and hashing (spec 04 §3.3/§3.4, 03 §5-§6).
 *
 * A rotation successor is deterministically derived so an ambiguous client retry
 * with the same rotationId reproduces the byte-identical token without a second
 * write:
 *   rawRefresh = base64url(HMAC-SHA256(refreshKey, "boe-refresh-v1"|sid|gen|rotationId))
 *   rawCsrf    = base64url(HMAC-SHA256(refreshKey, "boe-csrf-v1"|sid|gen|rotationId))
 * Only SHA-256(raw) is persisted in the `*_token_hash` columns; the refresh-key
 * version and generation/rotationId are stored alongside. The generation-0 token
 * issued at login/activation is random (there is no client rotationId yet).
 */
import { createHash, createHmac, randomBytes } from "node:crypto"

const REFRESH_DOMAIN = "boe-refresh-v1"
const CSRF_DOMAIN = "boe-csrf-v1"

const deriveRaw = (
  refreshKey: Buffer,
  domain: string,
  sessionId: string,
  generation: number,
  rotationId: string,
): string =>
  createHmac("sha256", refreshKey)
    .update(`${domain}|${sessionId}|${String(generation)}|${rotationId}`)
    .digest("base64url")

/** Deterministic successor refresh token for a rotation. */
export const deriveRefreshToken = (
  refreshKey: Buffer,
  sessionId: string,
  generation: number,
  rotationId: string,
): string => deriveRaw(refreshKey, REFRESH_DOMAIN, sessionId, generation, rotationId)

/** Deterministic successor synchronizer-CSRF token for a web rotation. */
export const deriveCsrfToken = (
  refreshKey: Buffer,
  sessionId: string,
  generation: number,
  rotationId: string,
): string => deriveRaw(refreshKey, CSRF_DOMAIN, sessionId, generation, rotationId)

/** Random generation-0 refresh token issued at login/activation. */
export const generateInitialRefreshToken = (): string => randomBytes(32).toString("base64url")

/** The persisted hash of a raw token is its SHA-256 digest. */
export const hashToken = (rawToken: string): Buffer => createHash("sha256").update(rawToken).digest()
