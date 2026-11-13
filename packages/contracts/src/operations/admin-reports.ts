import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, SignedPaise, Uuid } from "../scalars.js"
import { ADMIN_PAGED_READ_ERRORS, AdminCursor, AdminLimit, AdminPageMeta } from "./admin-shared.js"
import { defineOperation } from "./descriptor.js"

const CALENDAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u

export const ReportCalendarDate = z.iso.date()
export type ReportCalendarDate = z.infer<typeof ReportCalendarDate>

export const ReportCalendarMonth = z.string().regex(CALENDAR_MONTH_PATTERN)
export type ReportCalendarMonth = z.infer<typeof ReportCalendarMonth>

export const AdminClientBalance = z.strictObject({
  userId: Uuid,
  clientName: z.string(),
  clientEmail: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  investedPaise: SignedPaise,
  valuePaise: SignedPaise,
})
export type AdminClientBalance = z.infer<typeof AdminClientBalance>

export const AdminClientBalancesData = z.strictObject({
  asOfDate: ReportCalendarDate,
  items: z.array(AdminClientBalance),
})
export type AdminClientBalancesData = z.infer<typeof AdminClientBalancesData>

export const listAdminClientBalances = defineOperation({
  operationId: "listAdminClientBalances",
  method: "GET",
  path: "/v1/admin/reports/client-balances",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({ asOfDate: ReportCalendarDate, after: AdminCursor, limit: AdminLimit }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminClientBalancesData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminMonthContribution = z.strictObject({
  entryId: Uuid,
  userId: Uuid,
  clientName: z.string(),
  clientEmail: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  categoryLabel: z.string(),
  amountPaise: SignedPaise,
  effectiveDate: ReportCalendarDate,
  recordedAt: IsoDateTime,
  reversedAt: IsoDateTime.nullable(),
})
export type AdminMonthContribution = z.infer<typeof AdminMonthContribution>

export const AdminMonthContributionsData = z.strictObject({
  month: ReportCalendarMonth,
  items: z.array(AdminMonthContribution),
})
export type AdminMonthContributionsData = z.infer<typeof AdminMonthContributionsData>

export const listAdminMonthContributions = defineOperation({
  operationId: "listAdminMonthContributions",
  method: "GET",
  path: "/v1/admin/reports/contributions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({ month: ReportCalendarMonth, after: AdminCursor, limit: AdminLimit }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminMonthContributionsData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminAuditPreset = z.enum(["recordings", "reversals", "growth", "maturity", "refunds"])
export type AdminAuditPreset = z.infer<typeof AdminAuditPreset>

export const AdminAuditTrailClient = z.strictObject({ userId: Uuid, fullName: z.string() })
export type AdminAuditTrailClient = z.infer<typeof AdminAuditTrailClient>

export const AdminAuditTrailItem = z.strictObject({
  id: Uuid,
  occurredAt: IsoDateTime,
  actorType: z.string(),
  actorUserId: Uuid.nullable(),
  actorEmail: z.string().nullable(),
  command: z.string(),
  entityType: z.string(),
  entityId: Uuid,
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  requestId: z.string(),
  client: AdminAuditTrailClient.nullable(),
  amountPaise: SignedPaise.nullable(),
  fundId: Uuid.nullable(),
  orderId: Uuid.nullable(),
  ledgerEntryId: Uuid.nullable(),
})
export type AdminAuditTrailItem = z.infer<typeof AdminAuditTrailItem>

export const AdminAuditTrailData = z.strictObject({ items: z.array(AdminAuditTrailItem) })
export type AdminAuditTrailData = z.infer<typeof AdminAuditTrailData>

export const AdminAuditTrailQuery = z.strictObject({
  preset: AdminAuditPreset.optional(),
  entityType: z.string().trim().max(80).optional(),
  command: z.string().trim().max(120).optional(),
  fromDate: ReportCalendarDate.optional(),
  toDate: ReportCalendarDate.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})

export const listAdminAuditTrail = defineOperation({
  operationId: "listAdminAuditTrail",
  method: "GET",
  path: "/v1/admin/audit-events",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminAuditTrailQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminAuditTrailData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const listAdminUserAuditTrail = defineOperation({
  operationId: "listAdminUserAuditTrail",
  method: "GET",
  path: "/v1/admin/users/{userId}/audit-events",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    params: z.strictObject({ userId: Uuid }),
    query: z.strictObject({ after: AdminCursor, limit: AdminLimit }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminAuditTrailData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ADMIN_REPORT_OPERATIONS = Object.freeze([
  listAdminClientBalances,
  listAdminMonthContributions,
  listAdminAuditTrail,
  listAdminUserAuditTrail,
])
