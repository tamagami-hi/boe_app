import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, PasswordInput } from "../scalars.js"
import { AdminAppConfigPublishTarget } from "./admin-content.js"
import {
  ADMIN_AUTH_ERRORS,
  ADMIN_BODY_ERRORS,
  ADMIN_CSRF_ERRORS,
  ADMIN_INFRA_ERRORS,
  AdminConfirmationToken,
  AdminCsrfHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ADMIN_STEP_UP_ACTIONS = ["app_config.publish"] as const
export const AdminStepUpAction = z.enum(ADMIN_STEP_UP_ACTIONS)
export type AdminStepUpAction = z.infer<typeof AdminStepUpAction>


export const AdminPasswordConfirmationBody = z.strictObject({
  password: PasswordInput,
  action: AdminStepUpAction,
  body: AdminAppConfigPublishTarget,
})
export type AdminPasswordConfirmationBody = z.infer<typeof AdminPasswordConfirmationBody>

export const AdminPasswordConfirmation = z.strictObject({
  confirmation: AdminConfirmationToken,
  action: AdminStepUpAction,
  expiresAt: IsoDateTime,
})
export type AdminPasswordConfirmation = z.infer<typeof AdminPasswordConfirmation>

export const confirmAdminPassword = defineOperation({
  operationId: "confirmAdminPassword",
  method: "POST",
  path: "/v1/admin/auth/confirm-password",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: AdminPasswordConfirmationBody,
    headers: AdminCsrfHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminPasswordConfirmation) },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "INVALID_CREDENTIALS",
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const ADMIN_STEP_UP_OPERATIONS = Object.freeze([confirmAdminPassword])
