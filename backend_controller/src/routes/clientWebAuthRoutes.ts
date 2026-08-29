/**
 * Investor-app browser authentication routes: the same four endpoints the admin
 * console has, for the CLIENT scope.
 *
 *   POST /v1/auth/client/web/login
 *   POST /v1/auth/client/web/refresh
 *   GET  /v1/auth/client/web/csrf
 *   POST /v1/auth/client/web/logout
 *
 * The APK keeps using `/v1/auth/native/*`; these exist so a browser never has to
 * hold a bearer refresh token. Cookie names, CSRF token and refresh chain are the
 * client scope's own — see `domain/auth/clientWebAuth.ts`.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { AppError } from "../http/errorCatalog.js"
import { requestProvenance } from "../http/requestProvenance.js"
import { parseOrThrow } from "../http/validation.js"
import { CLIENT_WEB_SCOPE } from "../domain/auth/clientWebAuth.js"
import {
  applyAuthCookies,
  authenticateCookieSession,
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

export type ClientWebAuthRouteDeps = WebAuthDeps & WebLoginDeps & { readonly unitOfWork: UnitOfWork }

const loginSchema = z
  .object({ email: z.string().trim().email().max(254), password: passwordInputSchema })
  .strict()

const refreshSchema = z.object({ rotationId: z.string().uuid() }).strict()

export const registerClientWebAuthRoutes = (
  application: FastifyInstance,
  deps: ClientWebAuthRouteDeps,
): void => {
  application.post("/v1/auth/client/web/login", async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body)
    // No `unitOfWork.execute` here: `webLogin` owns its transaction boundary so
    // the Argon2id verification runs before any connection is taken.
    const provenance = requestProvenance(request)
    const result = await webLogin(deps, CLIENT_WEB_SCOPE, {
      email: body.email,
      password: body.password,
      requestId: request.requestId,
      ipAddress: provenance.ipAddress,
      userAgent: provenance.userAgent,
    })
    applyAuthCookies(reply, deps, CLIENT_WEB_SCOPE, result)
    return reply.sendData(result.body, { status: 200 })
  })

  application.post("/v1/auth/client/web/refresh", async (request, reply) => {
    const body = parseOrThrow(refreshSchema, request.body)
    validateWebOrigin(request, deps.config.originAllowlist)
    const refreshCookie = readRefreshCookie(request, CLIENT_WEB_SCOPE.cookies)
    const presentedCsrf = request.headers["x-csrf-token"]
    if (refreshCookie === undefined) throw new AppError("AUTHENTICATION_REQUIRED")
    if (typeof presentedCsrf !== "string") throw new AppError("CSRF_INVALID")

    const outcome = await deps.unitOfWork.execute((tx) =>
      webRefresh(tx, deps, CLIENT_WEB_SCOPE, { rotationId: body.rotationId, refreshCookie, presentedCsrf }),
    )
    if (outcome.kind === "reuse_revoked") {
      expireAuthCookies(reply, deps, CLIENT_WEB_SCOPE)
      throw new AppError("SESSION_INVALID")
    }
    applyAuthCookies(reply, deps, CLIENT_WEB_SCOPE, outcome.result)
    return reply.sendData(outcome.result.body, { status: 200 })
  })

  application.get("/v1/auth/client/web/csrf", async (request, reply) => {
    validateWebOrigin(request, deps.config.originAllowlist)
    const accessCookie = readAccessCookie(request, CLIENT_WEB_SCOPE.cookies)
    const refreshCookie = readRefreshCookie(request, CLIENT_WEB_SCOPE.cookies)
    if (accessCookie === undefined && refreshCookie === undefined) {
      throw new AppError("AUTHENTICATION_REQUIRED")
    }
    const result = await deps.unitOfWork.execute((tx) =>
      webRecoverCsrf(tx, deps, CLIENT_WEB_SCOPE, { accessCookie, refreshCookie }),
    )
    reply.header("cache-control", "no-store")
    return reply.sendData(result.body, { status: 200 })
  })

  application.post("/v1/auth/client/web/logout", async (request, reply) => {
    const actor = await authenticateCookieSession(request, deps, CLIENT_WEB_SCOPE, {
      originAllowlist: deps.config.originAllowlist,
      requireCsrf: true,
    })
    await deps.unitOfWork.execute((tx) => webLogout(tx, deps, { sessionId: actor.sessionId }))
    expireAuthCookies(reply, deps, CLIENT_WEB_SCOPE)
    return reply.sendData({ loggedOut: true }, { status: 200 })
  })
}
