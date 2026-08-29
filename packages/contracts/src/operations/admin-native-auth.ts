import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, PasswordInput, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import {
  NativeCompatibilityHeaders,
  NativeCredentialData,
  NativeDevice,
  RefreshToken,
} from "./native.js"
import { WebPrincipal } from "./web-auth.js"

/**
 * Bearer session for the ADMIN scope: the mirror of `native-auth.ts`, which does
 * the same for the investor app, and the bearer counterpart of `web-auth.ts`.
 *
 * The Android admin build is a Capacitor WebView served from `https://localhost`,
 * a different registrable domain from the API host, so every call is cross-site:
 * `SameSite=Lax` withholds the cookie and the `Sec-Fetch-Site` gate refuses the
 * request outright. Cookie auth cannot reach it, so it holds a bearer pair in
 * Secure Storage, as the investor APK does.
 *
 * These are separate operations from `native-auth.ts` rather than one contract
 * with a mode flag, because the response differs in the way that matters: the
 * admin session carries the operator's roles and resolved permissions (the same
 * `WebPrincipal` the cookie login returns, so the console renders identically on
 * both hosts), while the client session carries a masked phone and no permissions
 * at all. Widening the client operation instead would have made the two
 * audiences' tokens interchangeable in exactly what they authorise.
 *
 * Server-side the two sit on different session channels — `admin_native` and
 * `native` — and neither authentication path accepts the other's.
 */
export const AdminNativeAuthHeaders = NativeCompatibilityHeaders
export type AdminNativeAuthHeaders = z.infer<typeof AdminNativeAuthHeaders>

export const AdminNativeLoginBody = z.strictObject({
  email: EmailInput,
  password: PasswordInput,
  device: NativeDevice,
})
export type AdminNativeLoginBody = z.infer<typeof AdminNativeLoginBody>

export const AdminNativeSessionData = z.strictObject({
  user: WebPrincipal,
  ...NativeCredentialData.shape,
})
export type AdminNativeSessionData = z.infer<typeof AdminNativeSessionData>

export const AdminNativeSessionSuccessEnvelope =
  createSuccessEnvelopeSchema(AdminNativeSessionData)

export const AdminNativeRefreshBody = z.strictObject({
  refreshToken: RefreshToken,
  rotationId: Uuid,
})
export type AdminNativeRefreshBody = z.infer<typeof AdminNativeRefreshBody>

export const AdminNativeRefreshData = NativeCredentialData
export type AdminNativeRefreshData = z.infer<typeof AdminNativeRefreshData>

export const AdminNativeRefreshSuccessEnvelope =
  createSuccessEnvelopeSchema(AdminNativeRefreshData)

export const AdminNativeLogoutBody = z.strictObject({ refreshToken: RefreshToken })
export type AdminNativeLogoutBody = z.infer<typeof AdminNativeLogoutBody>

export const AdminNativeLogoutData = z.strictObject({ loggedOut: z.literal(true) })
export const AdminNativeLogoutSuccessEnvelope = createSuccessEnvelopeSchema(AdminNativeLogoutData)

export const adminNativeLogin = defineOperation({
  operationId: "adminNativeLogin",
  method: "POST",
  path: "/v1/auth/admin/native/login",
  authChannel: "native-login",
  credentialPolicy: "native-password-body-only",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: AdminNativeLoginBody,
    headers: AdminNativeAuthHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminNativeSessionSuccessEnvelope },
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

export const adminNativeRefresh = defineOperation({
  operationId: "refreshAdminNativeSession",
  method: "POST",
  path: "/v1/auth/admin/native/refresh",
  authChannel: "native-refresh",
  credentialPolicy: "native-refresh-token-body-only",
  idempotency: "deterministic-rotation",
  responseCacheControl: "no-store",
  request: {
    body: AdminNativeRefreshBody,
    headers: AdminNativeAuthHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminNativeRefreshSuccessEnvelope },
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

export const adminNativeLogout = defineOperation({
  operationId: "logoutAdminNativeSession",
  method: "POST",
  path: "/v1/auth/admin/native/logout",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer-and-refresh-body",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {
    body: AdminNativeLogoutBody,
    headers: AdminNativeAuthHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminNativeLogoutSuccessEnvelope },
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

export const ADMIN_NATIVE_AUTH_OPERATIONS = Object.freeze([
  adminNativeLogin,
  adminNativeRefresh,
  adminNativeLogout,
])
