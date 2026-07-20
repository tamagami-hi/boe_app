/**
 * Native authentication routes (spec 04 §3.3): activation, native login, native
 * logout. Refresh rotation registers here too once implemented.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import { parseOrThrow } from "../http/validation.js"
import {
  activateUser,
  authenticateNativeRequest,
  nativeLogin,
  nativeLogout,
  type NativeAuthDeps,
} from "../domain/auth/nativeAuth.js"

export type NativeAuthRouteDeps = NativeAuthDeps & { readonly unitOfWork: UnitOfWork }

const deviceSchema = z
  .object({
    installationId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    platform: z.literal("android"),
    appVersion: z.string().regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/u),
  })
  .strict()

const activationSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), password: passwordInputSchema, device: deviceSchema })
  .strict()

const loginSchema = z
  .object({ email: z.string().trim().email().max(254), password: passwordInputSchema, device: deviceSchema })
  .strict()

const logoutSchema = z.object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()

export const registerNativeAuthRoutes = (application: FastifyInstance, deps: NativeAuthRouteDeps): void => {
  application.post("/v1/activations/complete", async (request, reply) => {
    const body = parseOrThrow(activationSchema, request.body)
    const result = await deps.unitOfWork.execute((tx) =>
      activateUser(tx, deps, {
        token: body.token,
        password: body.password,
        device: body.device,
        requestId: request.requestId,
      }),
    )
    return reply.sendData(result, { status: 200 })
  })

  application.post("/v1/auth/native/login", async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body)
    const result = await deps.unitOfWork.execute((tx) =>
      nativeLogin(tx, deps, {
        email: body.email,
        password: body.password,
        device: body.device,
        requestId: request.requestId,
      }),
    )
    return reply.sendData(result, { status: 200 })
  })

  application.post("/v1/auth/native/logout", async (request, reply) => {
    const actor = await authenticateNativeRequest(request, deps)
    parseOrThrow(logoutSchema, request.body)
    await deps.unitOfWork.execute((tx) => nativeLogout(tx, deps, { sessionId: actor.sessionId }))
    return reply.sendData({ loggedOut: true }, { status: 200 })
  })
}
