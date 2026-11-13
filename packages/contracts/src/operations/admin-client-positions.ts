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
import { OrderType } from "./client-orders.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { AdminSipScheduleLink } from "./sip-schedules.js"

const AsOfDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const CalendarDate = z.iso.date()

export const AdminRecordingReasonCode = z.enum([
  "recorded_offline_investment",
  "recorded_offline_monthly_investment",
  "recorded_offline_correction",
])
export type AdminRecordingReasonCode = z.infer<typeof AdminRecordingReasonCode>

export const AdminRecordedContributionBody = z.strictObject({
  fundId: Uuid,
  amountPaise: Paise.refine((value) => !/^0$/u.test(value)),
  effectiveDate: CalendarDate,
  reasonCode: AdminRecordingReasonCode,
  note: AdminReasonDetail.optional(),
  sipScheduleLink: AdminSipScheduleLink.optional(),
})
export type AdminRecordedContributionBody = z.infer<typeof AdminRecordedContributionBody>

export const AdminRecordedContributionData = z.strictObject({
  entryId: Uuid,
  userId: Uuid,
  fundId: Uuid,
  orderId: Uuid,
  paymentId: Uuid,
  allocationId: Uuid,
  fundVersionId: Uuid,
  fundVersionEffectiveOnDate: z.boolean(),
  amountPaise: Paise,
  effectiveDate: AsOfDate,
  reasonCode: z.string(),
  principalPaise: SignedPaise,
  currentValuePaise: SignedPaise,
})
export type AdminRecordedContributionData = z.infer<typeof AdminRecordedContributionData>

export const recordAdminClientContribution = defineOperation({
  operationId: "recordAdminClientContribution",
  method: "POST",
  path: "/v1/admin/clients/{userId}/recorded-contributions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid }),
    body: AdminRecordedContributionBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminRecordedContributionData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminLedgerEntry = z.strictObject({
  entryId: Uuid,
  fundId: Uuid,
  entryType: z.enum(["contribution", "growth_adjustment", "reversal", "withdrawal", "maturity_reinvestment"]),
  orderType: OrderType.nullable(),
  principalDeltaPaise: SignedPaise,
  valueDeltaPaise: SignedPaise,
  effectiveDate: AsOfDate,
  reasonCode: z.string(),
  reversesEntryId: Uuid.nullable(),
  reversedByEntryId: Uuid.nullable(),
  reversible: z.boolean(),
  createdAt: IsoDateTime,
})
export type AdminLedgerEntry = z.infer<typeof AdminLedgerEntry>

export const AdminLedgerEntriesData = z.strictObject({
  userId: Uuid,
  items: z.array(AdminLedgerEntry),
})
export type AdminLedgerEntriesData = z.infer<typeof AdminLedgerEntriesData>

export const listAdminClientLedgerEntries = defineOperation({
  operationId: "listAdminClientLedgerEntries",
  method: "GET",
  path: "/v1/admin/clients/{userId}/ledger-entries",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    params: z.strictObject({ userId: Uuid }),
    query: z.strictObject({ fundId: Uuid.optional(), limit: AdminLimit.optional() }),
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminLedgerEntriesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminLedgerReversalBody = z.strictObject({
  reasonCode: AdminReasonCode,
  note: AdminReasonDetail.optional(),
})
export type AdminLedgerReversalBody = z.infer<typeof AdminLedgerReversalBody>

export const AdminLedgerReversalData = z.strictObject({
  entryId: Uuid,
  reversedEntryId: Uuid,
  userId: Uuid,
  fundId: Uuid,
  effectiveDate: AsOfDate,
  principalDeltaPaise: SignedPaise,
  valueDeltaPaise: SignedPaise,
  reasonCode: z.string(),
  principalPaise: SignedPaise,
  currentValuePaise: SignedPaise,
})
export type AdminLedgerReversalData = z.infer<typeof AdminLedgerReversalData>

export const reverseAdminClientLedgerEntry = defineOperation({
  operationId: "reverseAdminClientLedgerEntry",
  method: "POST",
  path: "/v1/admin/clients/{userId}/ledger-entries/{entryId}/reversal",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid, entryId: Uuid }),
    body: AdminLedgerReversalBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminLedgerReversalData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ADMIN_CLIENT_POSITION_OPERATIONS = Object.freeze([
  recordAdminClientContribution,
  listAdminClientLedgerEntries,
  reverseAdminClientLedgerEntry,
])
