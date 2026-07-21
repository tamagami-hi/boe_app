/**
 * Browser-admin (web) authentication (spec 04 §3.4, §4.3): HttpOnly cookie access
 * + opaque rotating refresh + synchronizer CSRF, with Origin/Referer and
 * Sec-Fetch-Site checks. Refresh + CSRF rotate together with the same 30s grace
 * and family-reuse revocation as native. `GET /v1/auth/web/csrf` (webRecoverCsrf)
 * re-issues the synchronizer token on reload from the access or refresh cookie
 * with no prior CSRF. The partial-response mixed-pair recovery edge (current
 * refresh + previous CSRF) is a documented later refinement.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { AccessTokenService } from "../../auth/accessToken.js"
import { verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import {
  deriveCsrfToken,
  deriveRefreshToken,
  generateInitialRefreshToken,
  hashToken,
} from "../../auth/refreshDerivation.js"
import { bytesEqual } from "../../crypto/primitives.js"
import type { AuthSession, Transaction, UserId } from "../../db/repositories.js"
import type { Database } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

const ACCESS_COOKIE = "__Host-boe_access"
const REFRESH_COOKIE = "__Host-boe_refresh"
const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000
const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000
const REFRESH_GRACE_MS = 30 * 1000

export interface WebAuthConfig {
  readonly cookieSecure: boolean
  readonly originAllowlist: readonly string[]
}

export interface WebAuthDeps {
  readonly userRepository: UserWriteRepository
  readonly authSessionRepository: AuthSessionWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly accessTokenService: AccessTokenService
  readonly database: Kysely<Database>
  readonly refreshKey: Buffer
  readonly refreshKeyVersion: string
  readonly csrfKeyVersion: string
  readonly clock: () => Date
  readonly config: WebAuthConfig
}

export interface WebPrincipal {
  readonly userId: string
  readonly fullName: string
  readonly email: string
  readonly roles: readonly string[]
  readonly permissions: readonly string[]
}

export interface WebAuthResult {
  readonly body: {
    readonly user: WebPrincipal
    readonly csrfToken: string
    readonly accessTokenExpiresAt: string
    readonly refreshTokenExpiresAt: string
  }
  readonly accessToken: string
  readonly refreshToken: string
  readonly refreshMaxAgeSeconds: number
}

export type WebRefreshOutcome =
  | { readonly kind: "issued"; readonly result: WebAuthResult }
  | { readonly kind: "reuse_revoked" }

// --- cookies ---

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {}
  if (header === undefined) return cookies
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return cookies
}

export const readRefreshCookie = (request: FastifyRequest): string | undefined =>
  parseCookies(request.headers.cookie)[REFRESH_COOKIE]

export const readAccessCookie = (request: FastifyRequest): string | undefined =>
  parseCookies(request.headers.cookie)[ACCESS_COOKIE]

const buildCookie = (name: string, value: string, maxAgeSeconds: number, secure: boolean): string =>
  `${name}=${value}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${String(maxAgeSeconds)}`

export const applyAuthCookies = (reply: FastifyReply, deps: WebAuthDeps, result: WebAuthResult): void => {
  reply.header("cache-control", "no-store")
  reply.header("set-cookie", [
    buildCookie(ACCESS_COOKIE, result.accessToken, ACCESS_TOKEN_TTL_MS / 1000, deps.config.cookieSecure),
    buildCookie(REFRESH_COOKIE, result.refreshToken, result.refreshMaxAgeSeconds, deps.config.cookieSecure),
  ])
}

export const expireAuthCookies = (reply: FastifyReply, deps: WebAuthDeps): void => {
  reply.header("cache-control", "no-store")
  reply.header("set-cookie", [
    buildCookie(ACCESS_COOKIE, "", 0, deps.config.cookieSecure),
    buildCookie(REFRESH_COOKIE, "", 0, deps.config.cookieSecure),
  ])
}

// --- origin / fetch metadata ---

export const validateWebOrigin = (request: FastifyRequest, deps: WebAuthDeps): void => {
  const secFetchSite = request.headers["sec-fetch-site"]
  if (secFetchSite === "cross-site") throw new AppError("CSRF_INVALID")

  const origin = request.headers.origin
  if (typeof origin === "string") {
    if (!deps.config.originAllowlist.includes(origin)) throw new AppError("CSRF_INVALID")
    return
  }
  const referer = request.headers.referer
  if (typeof referer === "string") {
    if (!deps.config.originAllowlist.some((allowed) => referer === allowed || referer.startsWith(`${allowed}/`))) {
      throw new AppError("CSRF_INVALID")
    }
    return
  }
  // A cookie-authenticated web route requires provable same-origin metadata.
  throw new AppError("CSRF_INVALID")
}

const buildPrincipal = async (
  deps: WebAuthDeps,
  tx: Transaction,
  user: Readonly<{ id: string; full_name: string; email_normalized: string }>,
): Promise<WebPrincipal> => {
  const { roles, permissions } = await deps.userRepository.findActiveRolesAndPermissions(tx, user.id as UserId)
  return { userId: user.id, fullName: user.full_name, email: user.email_normalized, roles, permissions }
}

export interface WebLoginInput {
  readonly email: string
  readonly password: string
  readonly requestId: string
}

export const webLogin = async (
  tx: Transaction,
  deps: WebAuthDeps,
  input: WebLoginInput,
): Promise<WebAuthResult> => {
  const found = await deps.userRepository.lockByEmailWithCredential(tx, input.email.toLowerCase())
  const passwordHash = found?.credential?.password_hash ?? null
  if (found === null || passwordHash === null || found.user.account_state !== "active") {
    await verifyDummyPassword(input.password)
    throw new AppError("INVALID_CREDENTIALS")
  }
  if (!(await verifyPassword(passwordHash, input.password))) {
    throw new AppError("INVALID_CREDENTIALS")
  }

  const principal = await buildPrincipal(deps, tx, found.user)
  if (principal.roles.length === 0) {
    // Not an admin principal: do not reveal the difference from a bad credential.
    throw new AppError("INVALID_CREDENTIALS")
  }

  const now = deps.clock()
  const refreshRaw = generateInitialRefreshToken()
  const csrfRaw = generateInitialRefreshToken()
  const created = await deps.authSessionRepository.createWebSession(tx, {
    userId: found.user.id as UserId,
    refreshTokenHash: hashToken(refreshRaw),
    refreshKeyVersion: deps.refreshKeyVersion,
    csrfTokenHash: hashToken(csrfRaw),
    csrfKeyVersion: deps.csrfKeyVersion,
    sessionExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
    csrfExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
  })
  const accessToken = await deps.accessTokenService.sign({ sub: found.user.id, sid: created.session.id })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: found.user.id,
    command: "auth.web_login",
    entityType: "auth_session",
    entityId: created.session.id,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {},
  })
  return {
    body: {
      user: principal,
      csrfToken: csrfRaw,
      accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
      refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS).toISOString(),
    },
    accessToken,
    refreshToken: refreshRaw,
    refreshMaxAgeSeconds: REFRESH_IDLE_MS / 1000,
  }
}

/**
 * Resolve and re-check a cookie-authenticated web principal, enforcing Origin and
 * (for unsafe methods) the synchronizer CSRF token.
 */
export const authenticateWebRequest = async (
  request: FastifyRequest,
  deps: WebAuthDeps,
  options: Readonly<{ requireCsrf: boolean }>,
): Promise<{ userId: string; sessionId: string }> => {
  validateWebOrigin(request, deps)
  const cookies = parseCookies(request.headers.cookie)
  const accessCookie = cookies[ACCESS_COOKIE]
  if (accessCookie === undefined) throw new AppError("AUTHENTICATION_REQUIRED")
  const verified = await deps.accessTokenService.verify(accessCookie)

  const session = await deps.database
    .selectFrom("auth_sessions")
    .selectAll()
    .where("id", "=", verified.sid)
    .executeTakeFirst()
  if (session === undefined || session.state !== "active" || session.channel !== "web") {
    throw new AppError("SESSION_INVALID")
  }
  const user = await deps.database
    .selectFrom("users")
    .select(["id", "account_state"])
    .where("id", "=", verified.sub)
    .executeTakeFirst()
  if (user === undefined || user.account_state !== "active") throw new AppError("ACCOUNT_NOT_ACTIVE")

  if (options.requireCsrf) {
    const presentedCsrf = request.headers["x-csrf-token"]
    const storedCsrf = session.csrf_token_hash
    if (typeof presentedCsrf !== "string" || storedCsrf === null) throw new AppError("CSRF_INVALID")
    if (!bytesEqual(hashToken(presentedCsrf), Buffer.from(storedCsrf as unknown as Uint8Array))) {
      throw new AppError("CSRF_INVALID")
    }
  }
  return { userId: verified.sub, sessionId: verified.sid }
}

export const webLogout = async (
  tx: Transaction,
  deps: WebAuthDeps,
  input: Readonly<{ sessionId: string }>,
): Promise<void> => {
  await deps.authSessionRepository.revokeSessionFamily(tx, {
    sessionId: input.sessionId,
    reason: "logout",
    now: deps.clock(),
  })
}

export interface WebRefreshInput {
  readonly rotationId: string
  readonly refreshCookie: string
  readonly presentedCsrf: string
}

export const webRefresh = async (
  tx: Transaction,
  deps: WebAuthDeps,
  input: WebRefreshInput,
): Promise<WebRefreshOutcome> => {
  const locked = await deps.authSessionRepository.lockByRefreshTokenHash(tx, hashToken(input.refreshCookie))
  if (locked === null) throw new AppError("SESSION_INVALID")
  const { session, refreshToken: presented } = locked
  const now = deps.clock()
  if (session.state !== "active" || new Date(session.expires_at).getTime() <= now.getTime()) {
    throw new AppError("SESSION_INVALID")
  }

  const issue = async (refreshRaw: string, csrfRaw: string): Promise<WebRefreshOutcome> => {
    const user = await deps.database
      .selectFrom("users")
      .select(["id", "full_name", "email_normalized"])
      .where("id", "=", session.user_id)
      .executeTakeFirstOrThrow()
    const principal = await buildPrincipal(deps, tx, user)
    const accessToken = await deps.accessTokenService.sign({ sub: session.user_id, sid: session.id })
    return {
      kind: "issued",
      result: {
        body: {
          user: principal,
          csrfToken: csrfRaw,
          accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
          refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS).toISOString(),
        },
        accessToken,
        refreshToken: refreshRaw,
        refreshMaxAgeSeconds: REFRESH_IDLE_MS / 1000,
      },
    }
  }

  // Current refresh + matching current CSRF: rotate both.
  const currentCsrf = session.csrf_token_hash
  const csrfMatches =
    currentCsrf !== null && bytesEqual(hashToken(input.presentedCsrf), Buffer.from(currentCsrf as unknown as Uint8Array))
  if (presented.used_at === null && presented.revoked_at === null && csrfMatches) {
    const successorGeneration = Number(presented.generation) + 1
    const refreshRaw = deriveRefreshToken(deps.refreshKey, session.id, successorGeneration, input.rotationId)
    const csrfRaw = deriveCsrfToken(deps.refreshKey, session.id, successorGeneration, input.rotationId)
    await deps.authSessionRepository.rotateWebRefresh(tx, {
      sessionId: session.id,
      userId: session.user_id,
      currentTokenId: presented.id,
      currentTokenHash: Buffer.from(presented.token_hash as unknown as Uint8Array),
      currentKeyVersion: presented.token_key_version,
      successorGeneration,
      successorHash: hashToken(refreshRaw),
      refreshKeyVersion: deps.refreshKeyVersion,
      rotationId: input.rotationId,
      previousValidUntil: new Date(now.getTime() + REFRESH_GRACE_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      now,
      currentCsrfHash: Buffer.from(currentCsrf as unknown as Uint8Array),
      currentCsrfKeyVersion: session.csrf_key_version ?? deps.csrfKeyVersion,
      successorCsrfHash: hashToken(csrfRaw),
      csrfKeyVersion: deps.csrfKeyVersion,
      csrfExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    })
    return issue(refreshRaw, csrfRaw)
  }

  // Previous refresh + previous CSRF within grace with the identical rotationId: reproduce.
  const previousRefresh =
    session.previous_refresh_token_hash === null
      ? null
      : Buffer.from(session.previous_refresh_token_hash as unknown as Uint8Array)
  const graceUntil = session.previous_refresh_valid_until
  const withinGrace = graceUntil !== null && new Date(graceUntil).getTime() > now.getTime()
  const previousCsrf =
    session.previous_csrf_token_hash === null
      ? null
      : Buffer.from(session.previous_csrf_token_hash as unknown as Uint8Array)
  const previousCsrfMatches =
    previousCsrf !== null && bytesEqual(hashToken(input.presentedCsrf), previousCsrf)
  if (
    bytesEqual(hashToken(input.refreshCookie), previousRefresh ?? Buffer.alloc(0)) &&
    withinGrace &&
    previousCsrfMatches &&
    session.last_rotation_id === input.rotationId
  ) {
    const refreshRaw = deriveRefreshToken(deps.refreshKey, session.id, Number(session.generation), input.rotationId)
    const csrfRaw = deriveCsrfToken(deps.refreshKey, session.id, Number(session.generation), input.rotationId)
    return issue(refreshRaw, csrfRaw)
  }

  await deps.authSessionRepository.revokeSessionFamily(tx, { sessionId: session.id, reason: "refresh_reuse", now })
  return { kind: "reuse_revoked" }
}

export interface WebCsrfResult {
  readonly body: {
    readonly user: WebPrincipal
    readonly csrfToken: string
    readonly csrfTokenExpiresAt: string
  }
}

/**
 * Reload recovery for the synchronizer CSRF token (spec 04 §3.4,
 * `GET /v1/auth/web/csrf`). The SPA has lost its in-memory CSRF token after a
 * reload but still holds the HttpOnly access/refresh cookies. Identify the web
 * session from the access cookie if it still verifies, else from the refresh
 * cookie, then re-issue a fresh CSRF token (no prior CSRF required). Safe without
 * CSRF because the caller must pass the Origin/Fetch-Metadata check (enforced in
 * the route) and a cross-origin caller cannot read the JSON response.
 */
export const webRecoverCsrf = async (
  tx: Transaction,
  deps: WebAuthDeps,
  input: Readonly<{ accessCookie: string | undefined; refreshCookie: string | undefined }>,
): Promise<WebCsrfResult> => {
  const now = deps.clock()

  let session: AuthSession | undefined
  if (input.accessCookie !== undefined) {
    const verified = await deps.accessTokenService.verify(input.accessCookie).catch(() => null)
    if (verified !== null) {
      session = await tx
        .selectFrom("auth_sessions")
        .selectAll()
        .where("id", "=", verified.sid)
        .forUpdate()
        .executeTakeFirst()
    }
  }
  if ((session === undefined || session.state !== "active") && input.refreshCookie !== undefined) {
    const locked = await deps.authSessionRepository.lockByRefreshTokenHash(tx, hashToken(input.refreshCookie))
    if (locked !== null) session = locked.session
  }

  if (session === undefined || session.state !== "active" || session.channel !== "web") {
    throw new AppError("AUTHENTICATION_REQUIRED")
  }
  if (new Date(session.expires_at).getTime() <= now.getTime()) throw new AppError("SESSION_INVALID")

  const user = await tx
    .selectFrom("users")
    .select(["id", "full_name", "email_normalized", "account_state"])
    .where("id", "=", session.user_id)
    .executeTakeFirst()
  if (user === undefined || user.account_state !== "active") throw new AppError("ACCOUNT_NOT_ACTIVE")

  const csrfRaw = generateInitialRefreshToken()
  await deps.authSessionRepository.rotateWebCsrf(tx, {
    sessionId: session.id,
    csrfTokenHash: hashToken(csrfRaw),
    csrfKeyVersion: deps.csrfKeyVersion,
    csrfExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    now,
  })
  const principal = await buildPrincipal(deps, tx, user)
  return {
    body: {
      user: principal,
      csrfToken: csrfRaw,
      csrfTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
    },
  }
}
