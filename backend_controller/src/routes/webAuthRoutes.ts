/**
 * Browser-admin (web) authentication routes (spec 04 §3.4): cookie + synchronizer
 * CSRF login, refresh rotation, and logout. The CSRF-recovery GET is a later
 * refinement.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import {
  applyAuthCookies,
  authenticateWebRequest,
  expireAuthCookies,
  readRefreshCookie,
  validateWebOrigin,
  webLogin,
  webLogout,
  webRefresh,
  type WebAuthDeps,
} from "../domain/auth/webAuth.js"

export type WebAuthRouteDeps = WebAuthDeps & { readonly unitOfWork: UnitOfWork }

const loginSchema = z
  .object({ email: z.string().trim().email().max(254), password: passwordInputSchema })
  .strict()

const refreshSchema = z.object({ rotationId: z.string().uuid() }).strict()

export const registerWebAuthRoutes = (application: FastifyInstance, deps: WebAuthRouteDeps): void => {
  application.post("/v1/auth/web/login", async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body)
    const result = await deps.unitOfWork.execute((tx) =>
      webLogin(tx, deps, { email: body.email, password: body.password, requestId: request.requestId }),
    )
    applyAuthCookies(reply, deps, result)
    return reply.sendData(result.body, { status: 200 })
  })

  application.post("/v1/auth/web/refresh", async (request, reply) => {
    const body = parseOrThrow(refreshSchema, request.body)
    validateWebOrigin(request, deps)
    const refreshCookie = readRefreshCookie(request)
    const presentedCsrf = request.headers["x-csrf-token"]
    if (refreshCookie === undefined) throw new AppError("AUTHENTICATION_REQUIRED")
    if (typeof presentedCsrf !== "string") throw new AppError("CSRF_INVALID")

    const outcome = await deps.unitOfWork.execute((tx) =>
      webRefresh(tx, deps, { rotationId: body.rotationId, refreshCookie, presentedCsrf }),
    )
    if (outcome.kind === "reuse_revoked") {
      expireAuthCookies(reply, deps)
      throw new AppError("SESSION_INVALID")
    }
    applyAuthCookies(reply, deps, outcome.result)
    return reply.sendData(outcome.result.body, { status: 200 })
  })

  application.post("/v1/auth/web/logout", async (request, reply) => {
    const actor = await authenticateWebRequest(request, deps, { requireCsrf: true })
    await deps.unitOfWork.execute((tx) => webLogout(tx, deps, { sessionId: actor.sessionId }))
    expireAuthCookies(reply, deps)
    return reply.sendData({ loggedOut: true }, { status: 200 })
  })
}
