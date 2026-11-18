import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IdempotencyKey, IsoDateTime, PasswordInput } from "../scalars.js"
import {
  ADMIN_AUTH_ERRORS,
  ADMIN_BODY_ERRORS,
  ADMIN_CSRF_ERRORS,
  ADMIN_INFRA_ERRORS,
  AdminCsrfHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ADMIN_CONFIRMATION_HEADER = "x-admin-confirmation"

export const ADMIN_STEP_UP_ACTIONS = ["app_config.publish"] as const
export const AdminStepUpAction = z.enum(ADMIN_STEP_UP_ACTIONS)
export type AdminStepUpAction = z.infer<typeof AdminStepUpAction>

export const AdminConfirmationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
export type AdminConfirmationToken = z.infer<typeof AdminConfirmationToken>

export const ConfirmedAdminMutationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey.optional(),
  "x-csrf-token": z.string().min(1),
  [ADMIN_CONFIRMATION_HEADER]: AdminConfirmationToken,
})

export const ADMIN_CONFIRMATION_ERRORS = ["TOKEN_INVALID", "TOKEN_EXPIRED", "TOKEN_ALREADY_USED"] as const

export const AdminPasswordConfirmationBody = z.strictObject({
  password: PasswordInput,
  action: AdminStepUpAction,
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
