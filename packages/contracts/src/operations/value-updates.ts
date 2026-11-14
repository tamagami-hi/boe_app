import { z } from "zod"

import { createPaginatedSuccessEnvelopeSchema, createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, SignedPaise, Uuid } from "../scalars.js"
import { AdminUserAccountState } from "./admin-oversight.js"
import { ADMIN_READ_ERRORS } from "./admin-shared.js"
import { IsoDate, ListQuery } from "./client.js"
import { defineOperation } from "./descriptor.js"

export const ClientValueUpdateItem = z.strictObject({
  entryId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  date: IsoDate,
  changePaise: SignedPaise,
  valueAfterPaise: SignedPaise,
  createdAt: IsoDateTime,
})
export type ClientValueUpdateItem = z.infer<typeof ClientValueUpdateItem>

export const ClientValueUpdatesQuery = ListQuery.extend({ fundId: Uuid.optional() })

export const ClientValueUpdatesData = z.strictObject({ items: z.array(ClientValueUpdateItem) })
export type ClientValueUpdatesData = z.infer<typeof ClientValueUpdatesData>

export const listClientValueUpdates = defineOperation({
  operationId: "listClientValueUpdates",
  method: "GET",
  path: "/v1/client/value-updates",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: ClientValueUpdatesQuery },
  success: { status: 200, schema: createPaginatedSuccessEnvelopeSchema(ClientValueUpdatesData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CURSOR_INVALID",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const AdminFundClientPosition = z.strictObject({
  userId: Uuid,
  fullName: z.string(),
  accountState: AdminUserAccountState,
  investedPaise: SignedPaise,
  currentValuePaise: SignedPaise,
  gainPaise: SignedPaise,
})
export type AdminFundClientPosition = z.infer<typeof AdminFundClientPosition>

export const AdminFundClientPositionsData = z.strictObject({
  fundId: Uuid,
  items: z.array(AdminFundClientPosition),
})
export type AdminFundClientPositionsData = z.infer<typeof AdminFundClientPositionsData>

export const listAdminFundClientPositions = defineOperation({
  operationId: "listAdminFundClientPositions",
  method: "GET",
  path: "/v1/admin/client-growth/funds/{fundId}/positions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ fundId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminFundClientPositionsData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const VALUE_UPDATE_OPERATIONS = Object.freeze([
  listClientValueUpdates,
  listAdminFundClientPositions,
])
