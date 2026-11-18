import type { FastifyInstance } from "fastify"

import { createConfirmationAttemptLimiter, type ConfirmationAttemptLimiter } from "../../src/auth/confirmationAttemptLimiter.js"
import type { ConsumeAdminStepUpDeps } from "../../src/domain/auth/adminStepUp.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAdminStepUpRepository } from "../../src/repositories/adminStepUpRepository.js"
import { CONFIRM_PASSWORD_ROUTE, registerAdminStepUpRoutes } from "../../src/routes/adminStepUpRoutes.js"
import { adminHeaders, type AdminSession } from "./adminSessionSupport.js"
import { PASSWORD, type PasswordMailStack } from "./passwordMailSupport.js"

export const PUBLISH_ACTION = "app_config.publish"

export const stepUpFor = (stack: PasswordMailStack): ConsumeAdminStepUpDeps => ({
  stepUpRepository: createAdminStepUpRepository(),
  crypto: stack.crypto,
})

export const registerStepUp = (
  instance: FastifyInstance,
  stack: PasswordMailStack,
  webAuth: WebAuthDeps,
  confirmLimiter: ConfirmationAttemptLimiter = createConfirmationAttemptLimiter(stack.clock),
): void => {
  registerAdminStepUpRoutes(instance, {
    webAuth,
    unitOfWork: stack.unitOfWork,
    database: stack.database,
    userRepository: stack.userRepository,
    stepUpRepository: createAdminStepUpRepository(),
    auditRepository: stack.auditRepository,
    crypto: stack.crypto,
    clock: stack.clock,
    confirmLimiter,
  })
}

export interface PublishTarget {
  readonly config: object
  readonly expectedVersion?: number | null
}

const targetOf = (payload: PublishTarget): PublishTarget => ({
  config: payload.config,
  ...(payload.expectedVersion === undefined ? {} : { expectedVersion: payload.expectedVersion }),
})

export const requestConfirmation = (
  app: FastifyInstance,
  session: AdminSession,
  payload: PublishTarget,
  password = PASSWORD,
) =>
  app.inject({
    method: "POST",
    url: CONFIRM_PASSWORD_ROUTE,
    headers: adminHeaders(session),
    payload: { password, action: PUBLISH_ACTION, body: targetOf(payload) },
  })

export const confirmedAs = async (app: FastifyInstance, session: AdminSession, payload: PublishTarget): Promise<string> => {
  const response = await requestConfirmation(app, session, payload)
  if (response.statusCode !== 200) throw new Error(`password confirmation failed: ${String(response.statusCode)}`)
  return response.json<{ data: { confirmation: string } }>().data.confirmation
}

export const confirmedHeaders = (session: AdminSession, confirmation: string, key?: string): Record<string, string> => ({
  ...adminHeaders(session, key),
  "x-admin-confirmation": confirmation,
})
