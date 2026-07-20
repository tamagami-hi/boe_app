import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, PasswordInput, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import {
  NativeCompatibilityHeaders,
  NativeCredentialData,
  NativeDevice,
  NativeSessionData,
  NativeSessionSuccessEnvelope,
  RefreshToken,
} from "./native.js"

export const NativeAuthHeaders = NativeCompatibilityHeaders
export type NativeAuthHeaders = z.infer<typeof NativeAuthHeaders>

export const NativeLoginBody = z.strictObject({
  email: EmailInput,
  password: PasswordInput,
  device: NativeDevice,
})
export type NativeLoginBody = z.infer<typeof NativeLoginBody>

export const NativeLoginData = NativeSessionData
export type NativeLoginData = z.infer<typeof NativeLoginData>

export const NativeLoginSuccessEnvelope = NativeSessionSuccessEnvelope
export type NativeLoginSuccessEnvelope = z.infer<typeof NativeLoginSuccessEnvelope>

export const NativeRefreshBody = z.strictObject({
  refreshToken: RefreshToken,
  rotationId: Uuid,
})
export type NativeRefreshBody = z.infer<typeof NativeRefreshBody>

export const NativeRefreshData = NativeCredentialData
export type NativeRefreshData = z.infer<typeof NativeRefreshData>

export const NativeRefreshSuccessEnvelope = createSuccessEnvelopeSchema(NativeRefreshData)
export type NativeRefreshSuccessEnvelope = z.infer<typeof NativeRefreshSuccessEnvelope>

export const NativeLogoutBody = z.strictObject({
  refreshToken: RefreshToken,
})
export type NativeLogoutBody = z.infer<typeof NativeLogoutBody>

export const NativeLogoutHeaders = NativeCompatibilityHeaders
export type NativeLogoutHeaders = z.infer<typeof NativeLogoutHeaders>

export const NativeLogoutData = z.strictObject({
  loggedOut: z.literal(true),
})
export type NativeLogoutData = z.infer<typeof NativeLogoutData>

export const NativeLogoutSuccessEnvelope = createSuccessEnvelopeSchema(NativeLogoutData)
export type NativeLogoutSuccessEnvelope = z.infer<typeof NativeLogoutSuccessEnvelope>

export const nativeLogin = defineOperation({
  operationId: "nativeLogin",
  method: "POST",
  path: "/v1/auth/native/login",
  authChannel: "native-login",
  credentialPolicy: "native-password-body-only",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: NativeLoginBody,
    headers: NativeAuthHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: NativeLoginSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "INVALID_CREDENTIALS",
    "STATE_CONFLICT",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const nativeRefresh = defineOperation({
  operationId: "refreshNativeSession",
  method: "POST",
  path: "/v1/auth/native/refresh",
  authChannel: "native-refresh",
  credentialPolicy: "native-refresh-token-body-only",
  idempotency: "deterministic-rotation",
  responseCacheControl: "no-store",
  request: {
    body: NativeRefreshBody,
    headers: NativeAuthHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: NativeRefreshSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "SESSION_INVALID",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const nativeLogout = defineOperation({
  operationId: "logoutNativeSession",
  method: "POST",
  path: "/v1/auth/native/logout",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer-and-refresh-body",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {
    body: NativeLogoutBody,
    headers: NativeLogoutHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: NativeLogoutSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const NATIVE_AUTH_OPERATIONS = Object.freeze([nativeLogin, nativeRefresh, nativeLogout])
