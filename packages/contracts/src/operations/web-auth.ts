import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, FullName, IsoDateTime, PasswordInput, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const PermissionCodeValue = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:[.][a-z][a-z0-9_]*)+$/u)
export type PermissionCodeValue = z.infer<typeof PermissionCodeValue>

export const RoleCodeValue = z.string().regex(/^[a-z][a-z0-9_]*$/u)
export type RoleCodeValue = z.infer<typeof RoleCodeValue>

export const WebPrincipal = z.strictObject({
  userId: Uuid,
  fullName: FullName,
  email: EmailInput,
  roles: z.array(RoleCodeValue),
  permissions: z.array(PermissionCodeValue),
})
export type WebPrincipal = z.infer<typeof WebPrincipal>

export const WebSessionData = z.strictObject({
  user: WebPrincipal,
  csrfToken: z.string().min(1),
  accessTokenExpiresAt: IsoDateTime,
  refreshTokenExpiresAt: IsoDateTime,
})
export type WebSessionData = z.infer<typeof WebSessionData>

export const WebSessionSuccessEnvelope = createSuccessEnvelopeSchema(WebSessionData)

export const WebCsrfData = z.strictObject({
  user: WebPrincipal,
  csrfToken: z.string().min(1),
  csrfTokenExpiresAt: IsoDateTime,
})
export type WebCsrfData = z.infer<typeof WebCsrfData>

export const WebCsrfSuccessEnvelope = createSuccessEnvelopeSchema(WebCsrfData)

export const WebLogoutData = z.strictObject({ loggedOut: z.literal(true) })
export const WebLogoutSuccessEnvelope = createSuccessEnvelopeSchema(WebLogoutData)

export const WebLoginBody = z.strictObject({
  email: EmailInput,
  password: PasswordInput,
})
export type WebLoginBody = z.infer<typeof WebLoginBody>

export const WebRefreshBody = z.strictObject({ rotationId: Uuid })
export type WebRefreshBody = z.infer<typeof WebRefreshBody>

export const webLogin = defineOperation({
  operationId: "webLogin",
  method: "POST",
  path: "/v1/auth/web/login",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: {
    body: WebLoginBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: WebSessionSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "INVALID_CREDENTIALS",
    "CSRF_INVALID",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const webRefresh = defineOperation({
  operationId: "webRefresh",
  method: "POST",
  path: "/v1/auth/web/refresh",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: WebRefreshBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: WebSessionSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "CSRF_INVALID",
    "INTERNAL_ERROR",
  ],
})

export const getWebCsrf = defineOperation({
  operationId: "getWebCsrf",
  method: "GET",
  path: "/v1/auth/web/csrf",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: WebCsrfSuccessEnvelope },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "CSRF_INVALID", "INTERNAL_ERROR"],
})

export const webLogout = defineOperation({
  operationId: "webLogout",
  method: "POST",
  path: "/v1/auth/web/logout",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: WebLogoutSuccessEnvelope },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "CSRF_INVALID", "INTERNAL_ERROR"],
})

export const AdminSessionData = WebPrincipal
export type AdminSessionData = z.infer<typeof AdminSessionData>

export const AdminSessionSuccessEnvelope = createSuccessEnvelopeSchema(AdminSessionData)

export const getAdminSession = defineOperation({
  operationId: "getAdminSession",
  method: "GET",
  path: "/v1/admin/session",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: AdminSessionSuccessEnvelope },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "AUTHORIZATION_DENIED",
    "CSRF_INVALID",
    "INTERNAL_ERROR",
  ],
})

export const WEB_AUTH_OPERATIONS = Object.freeze([
  webLogin,
  webRefresh,
  getWebCsrf,
  webLogout,
  getAdminSession,
])
