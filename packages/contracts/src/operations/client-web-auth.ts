import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, FullName, IsoDateTime, PasswordInput, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

/**
 * Browser (web) session for the CLIENT scope: HttpOnly cookie access token,
 * opaque rotating refresh cookie, synchronizer CSRF token. The mirror of
 * `web-auth.ts`, which does the same for the admin console.
 *
 * A browser cannot hold a bearer refresh token safely — the only place one
 * survives a full document load is `localStorage`, where any injected script can
 * read it. `native-auth.ts` therefore stays the Android transport (Secure
 * Storage) and these operations are the web transport. The two are separate
 * contracts, not one contract with a mode flag, because the credential shapes
 * are genuinely different: the native operations name their tokens in the body,
 * these never do.
 *
 * The client scope's cookies, CSRF token and refresh chain are distinct from the
 * admin scope's. An admin cookie cannot authenticate a client request, and vice
 * versa.
 */
export const ClientWebUser = z.strictObject({
  userId: Uuid,
  fullName: FullName,
  email: EmailInput,
  accountStatus: z.literal("active"),
})
export type ClientWebUser = z.infer<typeof ClientWebUser>

export const ClientWebSessionData = z.strictObject({
  user: ClientWebUser,
  csrfToken: z.string().min(1),
  accessTokenExpiresAt: IsoDateTime,
  refreshTokenExpiresAt: IsoDateTime,
})
export type ClientWebSessionData = z.infer<typeof ClientWebSessionData>

export const ClientWebSessionSuccessEnvelope = createSuccessEnvelopeSchema(ClientWebSessionData)

export const ClientWebCsrfData = z.strictObject({
  user: ClientWebUser,
  csrfToken: z.string().min(1),
  csrfTokenExpiresAt: IsoDateTime,
})
export type ClientWebCsrfData = z.infer<typeof ClientWebCsrfData>

export const ClientWebCsrfSuccessEnvelope = createSuccessEnvelopeSchema(ClientWebCsrfData)

export const ClientWebLogoutData = z.strictObject({ loggedOut: z.literal(true) })
export const ClientWebLogoutSuccessEnvelope = createSuccessEnvelopeSchema(ClientWebLogoutData)

export const ClientWebLoginBody = z.strictObject({
  email: EmailInput,
  password: PasswordInput,
})
export type ClientWebLoginBody = z.infer<typeof ClientWebLoginBody>

export const ClientWebRefreshBody = z.strictObject({ rotationId: Uuid })
export type ClientWebRefreshBody = z.infer<typeof ClientWebRefreshBody>

export const clientWebLogin = defineOperation({
  operationId: "clientWebLogin",
  method: "POST",
  path: "/v1/auth/client/web/login",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: {
    body: ClientWebLoginBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: ClientWebSessionSuccessEnvelope },
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

export const clientWebRefresh = defineOperation({
  operationId: "clientWebRefresh",
  method: "POST",
  path: "/v1/auth/client/web/refresh",
  authChannel: "client-web",
  credentialPolicy: "client-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: ClientWebRefreshBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: ClientWebSessionSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "CSRF_INVALID",
    "INTERNAL_ERROR",
  ],
})

export const getClientWebCsrf = defineOperation({
  operationId: "getClientWebCsrf",
  method: "GET",
  path: "/v1/auth/client/web/csrf",
  authChannel: "client-web",
  credentialPolicy: "client-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: ClientWebCsrfSuccessEnvelope },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "INTERNAL_ERROR",
  ],
})

export const clientWebLogout = defineOperation({
  operationId: "clientWebLogout",
  method: "POST",
  path: "/v1/auth/client/web/logout",
  authChannel: "client-web",
  credentialPolicy: "client-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: ClientWebLogoutSuccessEnvelope },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "INTERNAL_ERROR",
  ],
})

export const CLIENT_WEB_AUTH_OPERATIONS = Object.freeze([
  clientWebLogin,
  clientWebRefresh,
  getClientWebCsrf,
  clientWebLogout,
])
