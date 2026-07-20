import { z } from "zod"

import { PasswordInput } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import {
  AppVersion,
  NativeCompatibilityHeaders,
  NativeDevice,
  NativeSessionData,
  NativeSessionSuccessEnvelope,
  NativeUser,
  OpaqueToken43,
  PhoneMasked,
} from "./native.js"

export { AppVersion, NativeDevice, NativeUser, PhoneMasked }

export const ActivationToken = OpaqueToken43
export type ActivationToken = z.infer<typeof ActivationToken>

export const CompleteActivationHeaders = NativeCompatibilityHeaders
export type CompleteActivationHeaders = z.infer<typeof CompleteActivationHeaders>

export const CompleteActivationBody = z.strictObject({
  token: ActivationToken,
  password: PasswordInput,
  device: NativeDevice,
})
export type CompleteActivationBody = z.infer<typeof CompleteActivationBody>

export const CompleteActivationData = NativeSessionData
export type CompleteActivationData = z.infer<typeof CompleteActivationData>

export const CompleteActivationSuccessEnvelope = NativeSessionSuccessEnvelope
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
