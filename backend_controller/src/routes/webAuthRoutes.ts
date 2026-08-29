/**
 * Browser-admin (web) authentication routes (spec 04 §3.4): cookie + synchronizer
 * CSRF login, refresh rotation, logout, and the `GET /v1/auth/web/csrf` reload-
 * recovery endpoint that re-issues the CSRF token from the access or refresh
 * cookie. The investor app's equivalents are in `clientWebAuthRoutes.ts`; both
 * share the machinery in `domain/auth/webAuth.ts`.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { AppError } from "../http/errorCatalog.js"
import { requestProvenance } from "../http/requestProvenance.js"
import { parseOrThrow } from "../http/validation.js"
import {
  ADMIN_WEB_SCOPE,
  applyAuthCookies,
  authenticateWebRequest,
  expireAuthCookies,
  readAccessCookie,
  readRefreshCookie,
  validateWebOrigin,
  webLogin,
  webLogout,
  webRecoverCsrf,
  webRefresh,
  type WebAuthDeps,
  type WebLoginDeps,
} from "../domain/auth/webAuth.js"

export type WebAuthRouteDeps = WebAuthDeps & WebLoginDeps & { readonly unitOfWork: UnitOfWork }

const loginSchema = z
  .object({ email: z.string().trim().email().max(254), password: passwordInputSchema })
  .strict()

const refreshSchema = z.object({ rotationId: z.string().uuid() }).strict()

export const registerWebAuthRoutes = (application: FastifyInstance, deps: WebAuthRouteDeps): void => {
  application.post("/v1/auth/web/login", async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body)
    // No `unitOfWork.execute` here: `webLogin` owns its transaction boundary so
    // the Argon2id verification runs before any connection is taken. Re-wrapping
    // this call would reinstate the pool exhaustion it was restructured to remove.
    const provenance = requestProvenance(request)
    const result = await webLogin(deps, ADMIN_WEB_SCOPE, {
      email: body.email,
      password: body.password,
      requestId: request.requestId,
      ipAddress: provenance.ipAddress,
      userAgent: provenance.userAgent,
    })
    applyAuthCookies(reply, deps, ADMIN_WEB_SCOPE, result)
    return reply.sendData(result.body, { status: 200 })
  })

  application.post("/v1/auth/web/refresh", async (request, reply) => {
    const body = parseOrThrow(refreshSchema, request.body)
    validateWebOrigin(request, deps.config.originAllowlist)
    const refreshCookie = readRefreshCookie(request, ADMIN_WEB_SCOPE.cookies)
    const presentedCsrf = request.headers["x-csrf-token"]
    if (refreshCookie === undefined) throw new AppError("AUTHENTICATION_REQUIRED")
    if (typeof presentedCsrf !== "string") throw new AppError("CSRF_INVALID")

    const outcome = await deps.unitOfWork.execute((tx) =>
      webRefresh(tx, deps, ADMIN_WEB_SCOPE, { rotationId: body.rotationId, refreshCookie, presentedCsrf }),
    )
    if (outcome.kind === "reuse_revoked") {
      expireAuthCookies(reply, deps, ADMIN_WEB_SCOPE)
      throw new AppError("SESSION_INVALID")
    }
    applyAuthCookies(reply, deps, ADMIN_WEB_SCOPE, outcome.result)
    return reply.sendData(outcome.result.body, { status: 200 })
  })

  application.get("/v1/auth/web/csrf", async (request, reply) => {
    validateWebOrigin(request, deps.config.originAllowlist)
    const accessCookie = readAccessCookie(request, ADMIN_WEB_SCOPE.cookies)
    const refreshCookie = readRefreshCookie(request, ADMIN_WEB_SCOPE.cookies)
    const result = await deps.unitOfWork.execute((tx) =>
      webRecoverCsrf(tx, deps, ADMIN_WEB_SCOPE, { accessCookie, refreshCookie }),
    )
    reply.header("cache-control", "no-store")
    return reply.sendData(result.body, { status: 200 })
  })

  application.post("/v1/auth/web/logout", async (request, reply) => {
    const actor = await authenticateWebRequest(request, deps, { requireCsrf: true })
    await deps.unitOfWork.execute((tx) => webLogout(tx, deps, { sessionId: actor.sessionId }))
    expireAuthCookies(reply, deps, ADMIN_WEB_SCOPE)
    return reply.sendData({ loggedOut: true }, { status: 200 })
  })
}
