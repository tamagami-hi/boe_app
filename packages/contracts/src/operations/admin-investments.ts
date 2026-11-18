import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, SignedPaise, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { IsoDate } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { InvestmentBreakdownStatus } from "./investment-breakdown.js"

export const MAX_EARLIER_GROWTH_SPLIT_PARTS = 200

export const AdminInvestmentRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("sip"), scheduleId: Uuid }),
  z.strictObject({ kind: z.literal("one_time"), allocationId: Uuid }),
])
export type AdminInvestmentRef = z.infer<typeof AdminInvestmentRef>

export const AdminInvestmentsToCategoriseItem = z.strictObject({
  userId: Uuid,
  name: z.string(),
  waitingRecordings: z.number().int().nonnegative(),
  fundsNeedingSplit: z.number().int().nonnegative(),
})
export type AdminInvestmentsToCategoriseItem = z.infer<typeof AdminInvestmentsToCategoriseItem>

export const AdminInvestmentsToCategoriseData = z.strictObject({
  clientCount: z.number().int().nonnegative(),
  items: z.array(AdminInvestmentsToCategoriseItem),
})
export type AdminInvestmentsToCategoriseData = z.infer<typeof AdminInvestmentsToCategoriseData>

export const listAdminInvestmentsToCategorise = defineOperation({
  operationId: "listAdminInvestmentsToCategorise",
  method: "GET",
  path: "/v1/admin/investments/to-categorise",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: z.strictObject({ after: AdminCursor, limit: AdminLimit }) },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminInvestmentsToCategoriseData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminClientInvestment = z.strictObject({
  ref: AdminInvestmentRef,
  label: z.string(),
  date: IsoDate.nullable(),
  amountPaise: SignedPaise,
  reversed: z.boolean(),
})
export type AdminClientInvestment = z.infer<typeof AdminClientInvestment>

export const AdminUncategorisedRecording = z.strictObject({
  entryId: Uuid,
  effectiveDate: IsoDate,
  amountPaise: SignedPaise,
  reasonLabel: z.string(),
})
export type AdminUncategorisedRecording = z.infer<typeof AdminUncategorisedRecording>

export const AdminEarlierGrowthPart = z.strictObject({
  ref: AdminInvestmentRef,
  amountPaise: SignedPaise,
})
export type AdminEarlierGrowthPart = z.infer<typeof AdminEarlierGrowthPart>

export const AdminConfirmedEarlierGrowthSplit = z.strictObject({
  splitId: Uuid,
  cutoffEntryId: Uuid,
  totalPaise: SignedPaise,
  parts: z.array(AdminEarlierGrowthPart),
  confirmedAt: IsoDateTime,
})
export type AdminConfirmedEarlierGrowthSplit = z.infer<typeof AdminConfirmedEarlierGrowthSplit>

export const AdminEarlierGrowth = z.strictObject({
  totalPaise: SignedPaise,
  cutoffEntryId: Uuid,
  needsConfirmation: z.boolean(),
  proposal: z.array(AdminEarlierGrowthPart),
  confirmed: AdminConfirmedEarlierGrowthSplit.nullable(),
})
export type AdminEarlierGrowth = z.infer<typeof AdminEarlierGrowth>

export const AdminClientInvestmentFund = z.strictObject({
  fundId: Uuid,
  fundName: z.string(),
  status: InvestmentBreakdownStatus,
  investments: z.array(AdminClientInvestment),
  uncategorised: z.array(AdminUncategorisedRecording),
  earlierGrowth: AdminEarlierGrowth.nullable(),
})
export type AdminClientInvestmentFund = z.infer<typeof AdminClientInvestmentFund>

export const AdminClientInvestmentsData = z.strictObject({
  userId: Uuid,
  funds: z.array(AdminClientInvestmentFund),
})
export type AdminClientInvestmentsData = z.infer<typeof AdminClientInvestmentsData>

export const getAdminClientInvestments = defineOperation({
  operationId: "getAdminClientInvestments",
  method: "GET",
  path: "/v1/admin/clients/{userId}/investments",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientInvestmentsData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminEarlierGrowthSplitBody = z.strictObject({
  cutoffEntryId: Uuid,
  parts: z.array(AdminEarlierGrowthPart).max(MAX_EARLIER_GROWTH_SPLIT_PARTS),
})
export type AdminEarlierGrowthSplitBody = z.infer<typeof AdminEarlierGrowthSplitBody>

export const AdminEarlierGrowthSplitData = z.strictObject({
  fundId: Uuid,
  split: AdminConfirmedEarlierGrowthSplit,
})
export type AdminEarlierGrowthSplitData = z.infer<typeof AdminEarlierGrowthSplitData>

export const confirmAdminEarlierGrowthSplit = defineOperation({
  operationId: "confirmAdminEarlierGrowthSplit",
  method: "POST",
  path: "/v1/admin/clients/{userId}/funds/{fundId}/earlier-growth-split",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid, fundId: Uuid }),
    body: AdminEarlierGrowthSplitBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminEarlierGrowthSplitData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ADMIN_INVESTMENT_OPERATIONS = Object.freeze([
  listAdminInvestmentsToCategorise,
  getAdminClientInvestments,
  confirmAdminEarlierGrowthSplit,
])
