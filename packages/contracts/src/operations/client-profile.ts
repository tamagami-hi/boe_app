import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, IsoDateTime, PasswordInput, Uuid } from "../scalars.js"
import { EmailVerificationStateValue } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ClientProfileData = z.strictObject({
  userId: Uuid,
  fullName: z.string(),
  email: z.string(),
  emailVerification: EmailVerificationStateValue,
  phone: z.string(),
  phoneVerified: z.literal(false),
  version: z.number().int().positive(),
})
export type ClientProfileData = z.infer<typeof ClientProfileData>

export const ClientPendingEmailChange = z.strictObject({ email: z.string(), expiresAt: IsoDateTime })

export const ClientProfileViewData = ClientProfileData.extend({
  pendingEmailChange: ClientPendingEmailChange.nullable(),
})
export type ClientProfileViewData = z.infer<typeof ClientProfileViewData>

export const getClientProfile = defineOperation({
  operationId: "getClientProfile",
  method: "GET",
  path: "/v1/client/profile",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientProfileViewData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "RESOURCE_NOT_FOUND", "INTERNAL_ERROR"],
})

export const ClientPhoneChangeBody = z.strictObject({
  phone: z.string().trim().min(8).max(32),
  currentPassword: PasswordInput,
})
export type ClientPhoneChangeBody = z.infer<typeof ClientPhoneChangeBody>

export const ClientPhoneChangeData = z.strictObject({
  status: z.enum(["changed", "unchanged"]),
  profile: ClientProfileData,
})
export type ClientPhoneChangeData = z.infer<typeof ClientPhoneChangeData>

export const changeClientPhone = defineOperation({
  operationId: "changeClientPhone",
  method: "POST",
  path: "/v1/client/profile/phone",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: { body: ClientPhoneChangeBody, mediaType: "application/json", maxBodyBytes: MAX_JSON_BODY_BYTES },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientPhoneChangeData) },
  errorCodes: [
    "VALIDATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "INVALID_CREDENTIALS",
    "STATE_CONFLICT",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ],
})

export const ClientEmailChangeBody = z.strictObject({ newEmail: EmailInput, currentPassword: PasswordInput })
export type ClientEmailChangeBody = z.infer<typeof ClientEmailChangeBody>

export const ClientEmailChangeData = z.strictObject({
  status: z.enum(["code_sent", "unchanged"]),
  email: z.string().nullable(),
  expiresAt: IsoDateTime.nullable(),
})
export type ClientEmailChangeData = z.infer<typeof ClientEmailChangeData>

const PROFILE_WRITE_ERRORS = [
  "VALIDATION_FAILED",
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "CSRF_INVALID",
  "STATE_CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const

export const requestClientEmailChange = defineOperation({
  operationId: "requestClientEmailChange",
  method: "POST",
  path: "/v1/client/profile/email",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: { body: ClientEmailChangeBody, mediaType: "application/json", maxBodyBytes: MAX_JSON_BODY_BYTES },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientEmailChangeData) },
  errorCodes: [...PROFILE_WRITE_ERRORS, "INVALID_CREDENTIALS"],
})

export const ClientEmailConfirmBody = z.strictObject({ code: z.string().trim().length(6) })
export type ClientEmailConfirmBody = z.infer<typeof ClientEmailConfirmBody>

export const ClientEmailConfirmData = z.strictObject({ status: z.literal("changed"), email: z.string() })
export type ClientEmailConfirmData = z.infer<typeof ClientEmailConfirmData>

export const confirmClientEmailChange = defineOperation({
  operationId: "confirmClientEmailChange",
  method: "POST",
  path: "/v1/client/profile/email/confirm",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: { body: ClientEmailConfirmBody, mediaType: "application/json", maxBodyBytes: MAX_JSON_BODY_BYTES },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientEmailConfirmData) },
  errorCodes: [...PROFILE_WRITE_ERRORS, "TOKEN_INVALID", "TOKEN_EXPIRED"],
})

export const CLIENT_PROFILE_OPERATIONS = Object.freeze([
  getClientProfile,
  changeClientPhone,
  requestClientEmailChange,
  confirmClientEmailChange,
])
