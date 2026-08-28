import { z } from "zod"

import { IdempotencyKey } from "../scalars.js"

export const MAX_ADMIN_LIMIT = 100

export const AdminPageMeta = z.strictObject({
  nextCursor: z.string().nullable(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})
export type AdminPageMeta = z.infer<typeof AdminPageMeta>

export const AdminLimit = z.coerce.number().int().min(1).max(MAX_ADMIN_LIMIT).optional()
export const AdminCursor = z.string().min(1).optional()

export const AdminListQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
})

export const AdminReasonCode = z.string().trim().min(1).max(80)
export const AdminReasonDetail = z.string().trim().min(1).max(2_000)

export const AdminCsrfHeaders = z.strictObject({ "x-csrf-token": z.string().min(1) })

export const OptionalAdminMutationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey.optional(),
  "x-csrf-token": z.string().min(1),
})

export const RequiredAdminMutationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey,
  "x-csrf-token": z.string().min(1),
})

export const ADMIN_AUTH_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "AUTHORIZATION_DENIED",
] as const

export const ADMIN_CSRF_ERRORS = ["CSRF_INVALID"] as const

export const ADMIN_BODY_ERRORS = [
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
] as const

export const ADMIN_IDEMPOTENCY_ERRORS = [
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
] as const

export const ADMIN_INFRA_ERRORS = [
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "DEPENDENCY_UNAVAILABLE",
] as const

export const ADMIN_READ_ERRORS = [
  "VALIDATION_FAILED",
  ...ADMIN_AUTH_ERRORS,
  ...ADMIN_CSRF_ERRORS,
  ...ADMIN_INFRA_ERRORS,
] as const

export const ADMIN_PAGED_READ_ERRORS = ["CURSOR_INVALID", ...ADMIN_READ_ERRORS] as const

export const ADMIN_WRITE_ERRORS = [
  ...ADMIN_BODY_ERRORS,
  ...ADMIN_AUTH_ERRORS,
  ...ADMIN_CSRF_ERRORS,
  ...ADMIN_IDEMPOTENCY_ERRORS,
  ...ADMIN_INFRA_ERRORS,
] as const
