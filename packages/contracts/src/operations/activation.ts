import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import {
  EmailInput,
  FullName,
  IsoDateTime,
  PasswordInput,
  Uuid,
} from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ActivationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
export type ActivationToken = z.infer<typeof ActivationToken>

export const AppVersion = z
  .string()
  .regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/u)
export type AppVersion = z.infer<typeof AppVersion>

export const NativeDevice = z.strictObject({
  installationId: Uuid,
  name: z.string().trim().min(1).max(80),
  platform: z.literal("android"),
  appVersion: AppVersion,
})
export type NativeDevice = z.infer<typeof NativeDevice>

export const CompleteActivationHeaders = z.strictObject({
  "x-client-platform": z.literal("android"),
  "x-app-version": AppVersion,
})
export type CompleteActivationHeaders = z.infer<typeof CompleteActivationHeaders>

export const CompleteActivationBody = z.strictObject({
  token: ActivationToken,
  password: PasswordInput,
  device: NativeDevice,
})
export type CompleteActivationBody = z.infer<typeof CompleteActivationBody>

export const PhoneMasked = z.string().regex(/^\+[1-9][0-9]{0,2}[*]{6}[0-9]{4}$/u)
export type PhoneMasked = z.infer<typeof PhoneMasked>

export const NativeUser = z.strictObject({
  userId: Uuid,
  fullName: FullName,
  email: EmailInput,
  phoneMasked: PhoneMasked,
  accountStatus: z.literal("active"),
})
export type NativeUser = z.infer<typeof NativeUser>

export const CompleteActivationData = z.strictObject({
  user: NativeUser,
  accessToken: z.string().min(100).max(4096),
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: ActivationToken,
  refreshTokenExpiresAt: IsoDateTime,
  sessionId: Uuid,
})
export type CompleteActivationData = z.infer<typeof CompleteActivationData>

export const CompleteActivationSuccessEnvelope = createSuccessEnvelopeSchema(
  CompleteActivationData,
)
export type CompleteActivationSuccessEnvelope = z.infer<
  typeof CompleteActivationSuccessEnvelope
>

export const completeActivation = defineOperation({
  operationId: "completeActivation",
  method: "POST",
  path: "/v1/activations/complete",
  authChannel: "native-activation",
  credentialPolicy: "native-body-token-only",
  idempotency: "single-use-token",
  responseCacheControl: "no-store",
  request: {
    body: CompleteActivationBody,
    headers: CompleteActivationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: {
    status: 200,
    schema: CompleteActivationSuccessEnvelope,
  },
  errorCodes: [
    "VALIDATION_FAILED",
    "TOKEN_INVALID",
    "STATE_CONFLICT",
    "TOKEN_ALREADY_USED",
    "TOKEN_EXPIRED",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const ACTIVATION_OPERATIONS = Object.freeze([completeActivation])
