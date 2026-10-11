import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { PasswordInput, Uuid } from "../scalars.js"
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

export const getClientProfile = defineOperation({
  operationId: "getClientProfile",
  method: "GET",
  path: "/v1/client/profile",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientProfileData) },
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

export const CLIENT_PROFILE_OPERATIONS = Object.freeze([getClientProfile, changeClientPhone])
