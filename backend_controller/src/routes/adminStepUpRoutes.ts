import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { ConfirmationAttemptLimiter } from "../auth/confirmationAttemptLimiter.js"
import { passwordInputSchema } from "../auth/passwordHasher.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  APP_CONFIG_PUBLISH_ACTION,
  confirmAdminPassword,
  type ConfirmAdminPasswordDeps,
} from "../domain/auth/adminStepUp.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import { appConfigPublishHash, appConfigPublishTargetSchema } from "./appConfigPublishTarget.js"

export const CONFIRM_PASSWORD_ROUTE = "/v1/admin/auth/confirm-password"

const ACTION_PERMISSIONS: Readonly<Record<typeof APP_CONFIG_PUBLISH_ACTION, readonly string[]>> = {
  [APP_CONFIG_PUBLISH_ACTION]: ["config.publish"],
}

const confirmBodySchema = z
  .object({
    password: passwordInputSchema,
    action: z.enum([APP_CONFIG_PUBLISH_ACTION]),
    body: appConfigPublishTargetSchema,
  })
  .strict()

export type AdminStepUpRouteDeps = Omit<ConfirmAdminPasswordDeps, "logger"> &
  Readonly<{
    webAuth: WebAuthDeps
    confirmLimiter: ConfirmationAttemptLimiter
  }>

const confirm = async (deps: AdminStepUpRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  const body = parseOrThrow(confirmBodySchema, request.body)
  requireAnyPermission(principal, ACTION_PERMISSIONS[body.action])
  deps.confirmLimiter.reserve(principal.userId)
  const issued = await confirmAdminPassword(
    { ...deps, logger: request.log },
    {
      principal: { userId: principal.userId, sessionId: principal.sessionId },
      password: body.password,
      action: body.action,
      requestSha256: appConfigPublishHash(body.body),
      requestId: request.requestId,
    },
  ).catch((error: unknown) => {
    if (!(error instanceof AppError && error.code === "INVALID_CREDENTIALS")) deps.confirmLimiter.release(principal.userId)
    throw error
  })
  deps.confirmLimiter.release(principal.userId)
  reply.header("cache-control", "no-store")
  return reply.sendData(
    { confirmation: issued.confirmation, action: issued.action, expiresAt: issued.expiresAt.toISOString() },
    { status: 200 },
  )
}

export const registerAdminStepUpRoutes = (application: FastifyInstance, deps: AdminStepUpRouteDeps): void => {
  application.post(CONFIRM_PASSWORD_ROUTE, (request, reply) => confirm(deps, request, reply))
}
