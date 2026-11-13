import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ClientErasurePath = z.enum(["deleted", "kept_as_record"])
export type ClientErasurePath = z.infer<typeof ClientErasurePath>

export const ClientErasureKeptBecause = z.enum(["email_verified", "money_records"])
export type ClientErasureKeptBecause = z.infer<typeof ClientErasureKeptBecause>

export const ClientErasureBlockerCode = z.enum([
  "staff_account",
  "legal_hold",
  "holds_money",
  "open_orders",
  "open_payments",
  "open_refunds",
  "open_withdrawals",
  "unsettled_maturities",
  "active_sip_schedules",
  "scheduled_maturities",
  "open_maturity_offers",
  "active_sip_plans",
  "mail_in_flight",
])
export type ClientErasureBlockerCode = z.infer<typeof ClientErasureBlockerCode>

export const ClientErasureBlocker = z.strictObject({
  code: ClientErasureBlockerCode,
  count: z.number().int().positive(),
  message: z.string(),
})
export type ClientErasureBlocker = z.infer<typeof ClientErasureBlocker>

export const AdminClientErasureCheckData = z.strictObject({
  userId: Uuid,
  state: z.enum(["erasable", "blocked", "already_erased"]),
  fullName: z.string().nullable(),
  emailVerified: z.boolean().nullable(),
  path: ClientErasurePath,
  keptBecause: ClientErasureKeptBecause.nullable(),
  blockers: z.array(ClientErasureBlocker),
  erasedAt: IsoDateTime.nullable(),
})
export type AdminClientErasureCheckData = z.infer<typeof AdminClientErasureCheckData>

export const getAdminClientErasureCheck = defineOperation({
  operationId: "getAdminClientErasureCheck",
  method: "GET",
  path: "/v1/admin/clients/{userId}/erase-check",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientErasureCheckData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminClientErasureBody = z.strictObject({
  confirm: z.literal("ERASE"),
  expectedPath: ClientErasurePath,
})
export type AdminClientErasureBody = z.infer<typeof AdminClientErasureBody>

export const AdminClientErasureData = z.strictObject({
  userId: Uuid,
  outcome: z.enum(["erased", "already_erased"]),
  path: ClientErasurePath,
  keptBecause: ClientErasureKeptBecause.nullable(),
  erasedAt: IsoDateTime,
})
export type AdminClientErasureData = z.infer<typeof AdminClientErasureData>

export const eraseAdminClient = defineOperation({
  operationId: "eraseAdminClient",
  method: "POST",
  path: "/v1/admin/clients/{userId}/erase",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid }),
    body: AdminClientErasureBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientErasureData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ADMIN_CLIENT_ERASURE_OPERATIONS = Object.freeze([getAdminClientErasureCheck, eraseAdminClient])
