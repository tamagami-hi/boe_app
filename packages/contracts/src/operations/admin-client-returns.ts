import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, SignedPaise, Uuid } from "../scalars.js"
import { AdminLedgerEntry } from "./admin-money.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
} from "./admin-shared.js"
import { defineOperation } from "./descriptor.js"

const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

export const MAX_SUMMARY_USER_IDS = 100

export const AdminSummaryUserIds = z
  .string()
  .regex(new RegExp(`^${UUID_PATTERN}(,${UUID_PATTERN}){0,${String(MAX_SUMMARY_USER_IDS - 1)}}$`, "u"))

export const BasisPoints = z.string().regex(/^-?(0|[1-9][0-9]*)$/u)
export type BasisPoints = z.infer<typeof BasisPoints>

export const AdminClientReturns = z.strictObject({
  investedPaise: SignedPaise,
  currentValuePaise: SignedPaise,
  growthPaise: SignedPaise,
  simpleReturnBasisPoints: BasisPoints.nullable(),
  xirrBasisPoints: BasisPoints.nullable(),
  lastUpdatedAt: IsoDateTime.nullable(),
})
export type AdminClientReturns = z.infer<typeof AdminClientReturns>

export const AdminClientPortfolioSummaryData = AdminClientReturns.extend({
  userId: Uuid,
  asOfDate: CalendarDate,
})
export type AdminClientPortfolioSummaryData = z.infer<typeof AdminClientPortfolioSummaryData>

export const getAdminClientPortfolioSummary = defineOperation({
  operationId: "getAdminClientPortfolioSummary",
  method: "GET",
  path: "/v1/admin/clients/{userId}/portfolio-summary",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientPortfolioSummaryData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminClientValueSummarySort = z.enum(["return_desc", "return_asc"])
export type AdminClientValueSummarySort = z.infer<typeof AdminClientValueSummarySort>

export const AdminClientValueSummaryQuery = z.strictObject({
  sort: AdminClientValueSummarySort.optional(),
  userIds: AdminSummaryUserIds.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})

export const AdminClientValueSummaryItem = AdminClientReturns.extend({ userId: Uuid })
export type AdminClientValueSummaryItem = z.infer<typeof AdminClientValueSummaryItem>

export const AdminClientValueSummaryTotals = AdminClientReturns.extend({
  clientCount: z.number().int().nonnegative(),
})
export type AdminClientValueSummaryTotals = z.infer<typeof AdminClientValueSummaryTotals>

export const AdminClientValueSummaryData = z.strictObject({
  asOfDate: CalendarDate,
  totals: AdminClientValueSummaryTotals,
  items: z.array(AdminClientValueSummaryItem),
})
export type AdminClientValueSummaryData = z.infer<typeof AdminClientValueSummaryData>

export const listAdminClientValueSummaries = defineOperation({
  operationId: "listAdminClientValueSummaries",
  method: "GET",
  path: "/v1/admin/client-values/summary",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminClientValueSummaryQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminClientValueSummaryData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminFundValueUpdate = z.strictObject({
  fundId: Uuid,
  fundSlug: z.string(),
  fundName: z.string().nullable(),
  lastValueUpdateAt: IsoDateTime.nullable(),
  lastValueUpdateEffectiveDate: CalendarDate.nullable(),
})
export type AdminFundValueUpdate = z.infer<typeof AdminFundValueUpdate>

export const AdminFundValueUpdatesData = z.strictObject({ items: z.array(AdminFundValueUpdate) })
export type AdminFundValueUpdatesData = z.infer<typeof AdminFundValueUpdatesData>

export const listAdminFundValueUpdates = defineOperation({
  operationId: "listAdminFundValueUpdates",
  method: "GET",
  path: "/v1/admin/client-values/fund-updates",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminFundValueUpdatesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminPendingInvitesData = z.strictObject({
  count: z.number().int().nonnegative(),
  oldestInvitedAt: IsoDateTime.nullable(),
})
export type AdminPendingInvitesData = z.infer<typeof AdminPendingInvitesData>

export const getAdminPendingInvites = defineOperation({
  operationId: "getAdminPendingInvites",
  method: "GET",
  path: "/v1/admin/overview/pending-invites",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminPendingInvitesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminClientLedgerPageData = z.strictObject({
  userId: Uuid,
  items: z.array(AdminLedgerEntry),
})
export type AdminClientLedgerPageData = z.infer<typeof AdminClientLedgerPageData>

export const listAdminClientLedgerPage = defineOperation({
  operationId: "listAdminClientLedgerPage",
  method: "GET",
  path: "/v1/admin/clients/{userId}/ledger",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    params: z.strictObject({ userId: Uuid }),
    query: z.strictObject({ fundId: Uuid.optional(), after: AdminCursor, limit: AdminLimit }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminClientLedgerPageData, { page: AdminPageMeta }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const ADMIN_CLIENT_RETURN_OPERATIONS = Object.freeze([
  getAdminClientPortfolioSummary,
  listAdminClientValueSummaries,
  listAdminFundValueUpdates,
  getAdminPendingInvites,
  listAdminClientLedgerPage,
])
