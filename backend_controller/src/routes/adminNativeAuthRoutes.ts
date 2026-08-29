/**
 * Admin-APK authentication routes: the three bearer endpoints the investor APK
 * has, for the ADMIN scope.
 *
 *   POST /v1/auth/admin/native/login
 *   POST /v1/auth/admin/native/refresh
 *   POST /v1/auth/admin/native/logout
 *
 * The browser console keeps using `/v1/auth/web/*`; these exist because a
 * Capacitor WebView served from `https://localhost` is cross-site with the API
 * and cannot hold a cookie session at all. The session channel, refresh chain and
 * audit command are the admin scope's own — see `domain/auth/adminNativeAuth.ts`.
 *
 * There is no CSRF token and no Origin check on these three, and nothing is
 * weakened by that: the credential is a bearer token, which a hostile page cannot
 * make a browser attach and cannot read from another origin's storage. Those
 * checks protect ambient credentials, and there is no ambient credential here.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { AppError } from "../http/errorCatalog.js"
import { requestProvenance } from "../http/requestProvenance.js"
import { parseOrThrow } from "../http/validation.js"
import {
  ADMIN_NATIVE_SCOPE,
  authenticateAdminNativeRequest,
} from "../domain/auth/adminNativeAuth.js"
import {
  nativeLogin,
  nativeLogout,
  nativeRefresh,
  type NativeAuthDeps,
  type NativeLoginDeps,
} from "../domain/auth/nativeAuth.js"

export type AdminNativeAuthRouteDeps = NativeAuthDeps &
  NativeLoginDeps & { readonly unitOfWork: UnitOfWork }

const deviceSchema = z
  .object({
    installationId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    platform: z.literal("android"),
    appVersion: z.string().regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/u),
  })
  .strict()

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: passwordInputSchema,
    device: deviceSchema,
  })
  .strict()

const logoutSchema = z.object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()

const refreshSchema = z
  .object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), rotationId: z.string().uuid() })
  .strict()

export const registerAdminNativeAuthRoutes = (
  application: FastifyInstance,
  deps: AdminNativeAuthRouteDeps,
): void => {
  application.post("/v1/auth/admin/native/login", async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body)
    // No `unitOfWork.execute` here: `nativeLogin` owns its transaction boundary
    // so the Argon2id verification runs before any connection is taken.
    const provenance = requestProvenance(request)
    const result = await nativeLogin(deps, ADMIN_NATIVE_SCOPE, {
      email: body.email,
      password: body.password,
      device: body.device,
      requestId: request.requestId,
      ipAddress: provenance.ipAddress,
      userAgent: provenance.userAgent,
    })
    return reply.sendData(result, { status: 200 })
  })

  application.post("/v1/auth/admin/native/refresh", async (request, reply) => {
    const body = parseOrThrow(refreshSchema, request.body)
    const outcome = await deps.unitOfWork.execute((tx) =>
      nativeRefresh(tx, deps, ADMIN_NATIVE_SCOPE, {
        refreshToken: body.refreshToken,
        rotationId: body.rotationId,
      }),
    )
    if (outcome.kind === "reuse_revoked") throw new AppError("SESSION_INVALID")
    return reply.sendData(outcome.result, { status: 200 })
  })

  application.post("/v1/auth/admin/native/logout", async (request, reply) => {
    const actor = await authenticateAdminNativeRequest(request, deps)
    parseOrThrow(logoutSchema, request.body)
    await deps.unitOfWork.execute((tx) => nativeLogout(tx, deps, { sessionId: actor.sessionId }))
    return reply.sendData({ loggedOut: true }, { status: 200 })
  })
}
