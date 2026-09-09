import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import {
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminLimit,
  AdminReasonCode,
  AdminReasonDetail,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const MaturityDate = z.iso.date()
const UserParams = z.strictObject({ userId: Uuid })
const MaturityParams = z.strictObject({ userId: Uuid, maturityId: Uuid })
const MutationRequest = {
  headers: RequiredAdminMutationHeaders,
  mediaType: "application/json",
  maxBodyBytes: MAX_JSON_BODY_BYTES,
} as const
const AdminOperation = {
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
} as const
const SettlementFields = {
  fundId: Uuid,
  effectiveDate: MaturityDate,
  reasonCode: AdminReasonCode,
  note: AdminReasonDetail.optional(),
}

export const AdminMarkMaturityBody = z.strictObject({
  fundId: Uuid,
  maturedOn: MaturityDate,
  reasonCode: AdminReasonCode,
  note: AdminReasonDetail.optional(),
})
export const AdminWithdrawalBody = z.strictObject({
  ...SettlementFields,
  amountPaise: Paise.refine((value) => value !== "0"),
})
export const AdminReinvestmentBody = z.strictObject(SettlementFields)
export const AdminPayoutStatusBody = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("paid"),
    expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    transferReference: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    state: z.literal("failed"),
    expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    failureCode: z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,80}$/u),
  }),
])
export const AdminMaturity = z.strictObject({
  id: Uuid,
  userId: Uuid,
  fundId: Uuid,
  state: z.enum(["pending", "settled"]),
  maturedOn: MaturityDate,
  principalAtMaturityPaise: SignedPaise,
  valueAtMaturityPaise: SignedPaise,
  settlement: z.enum(["withdrawal", "reinvestment"]).nullable(),
  settlementEntryId: Uuid.nullable(),
  reasonCode: z.string(),
  version: Paise,
})
export type AdminMaturity = z.infer<typeof AdminMaturity>
export const AdminWithdrawalPayout = z.strictObject({
  id: Uuid,
  userId: Uuid,
  fundId: Uuid,
  maturityId: Uuid,
  ledgerEntryId: Uuid,
  state: z.enum(["pending", "paid", "failed"]),
  amountPaise: Paise,
  growthPortionPaise: Paise,
  principalPortionPaise: Paise,
  effectiveDate: MaturityDate,
  transferReference: z.string().nullable(),
  failureCode: z.string().nullable(),
  version: Paise,
  createdAt: IsoDateTime,
})
export type AdminWithdrawalPayout = z.infer<typeof AdminWithdrawalPayout>
const SettlementData = z.strictObject({
  entryId: Uuid,
  payoutId: Uuid.nullable(),
  principalPaise: SignedPaise,
  currentValuePaise: SignedPaise,
  principalDeltaPaise: SignedPaise,
  valueDeltaPaise: SignedPaise,
})

export const listAdminClientMaturities = defineOperation({
  ...AdminOperation,
  operationId: "listAdminClientMaturities",
  method: "GET",
  path: "/v1/admin/clients/{userId}/maturities",
  idempotency: "none",
  request: { params: UserParams, query: z.strictObject({ limit: AdminLimit }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ userId: Uuid, items: z.array(AdminMaturity) })) },
  errorCodes: ADMIN_READ_ERRORS,
})
export const markAdminClientMatured = defineOperation({
  ...AdminOperation,
  operationId: "markAdminClientMatured",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturities",
  idempotency: "required-key",
  request: { ...MutationRequest, params: UserParams, body: AdminMarkMaturityBody },
  success: { status: 201, schema: createSuccessEnvelopeSchema(z.strictObject({ maturityId: Uuid })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})
export const withdrawAdminClientMaturity = defineOperation({
  ...AdminOperation,
  operationId: "withdrawAdminClientMaturity",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturities/{maturityId}/withdrawal",
  idempotency: "required-key",
  request: { ...MutationRequest, params: MaturityParams, body: AdminWithdrawalBody },
  success: { status: 201, schema: createSuccessEnvelopeSchema(SettlementData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})
export const reinvestAdminClientMaturity = defineOperation({
  ...AdminOperation,
  operationId: "reinvestAdminClientMaturity",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturities/{maturityId}/reinvestment",
  idempotency: "required-key",
  request: { ...MutationRequest, params: MaturityParams, body: AdminReinvestmentBody },
  success: { status: 201, schema: createSuccessEnvelopeSchema(SettlementData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})
export const listAdminWithdrawalPayouts = defineOperation({
  ...AdminOperation,
  operationId: "listAdminWithdrawalPayouts",
  method: "GET",
  path: "/v1/admin/clients/{userId}/withdrawal-payouts",
  idempotency: "none",
  request: { params: UserParams, query: z.strictObject({ limit: AdminLimit }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ userId: Uuid, items: z.array(AdminWithdrawalPayout) })) },
  errorCodes: ADMIN_READ_ERRORS,
})
export const updateAdminWithdrawalPayout = defineOperation({
  ...AdminOperation,
  operationId: "updateAdminWithdrawalPayout",
  method: "POST",
  path: "/v1/admin/clients/{userId}/withdrawal-payouts/{payoutId}/status",
  idempotency: "required-key",
  request: { ...MutationRequest, params: z.strictObject({ userId: Uuid, payoutId: Uuid }), body: AdminPayoutStatusBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ payoutId: Uuid, state: z.enum(["paid", "failed"]) })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})
export const ADMIN_MATURITY_OPERATIONS = Object.freeze([
  listAdminClientMaturities,
  markAdminClientMatured,
  withdrawAdminClientMaturity,
  reinvestAdminClientMaturity,
  listAdminWithdrawalPayouts,
  updateAdminWithdrawalPayout,
])
