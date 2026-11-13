import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import { ADMIN_PAGED_READ_ERRORS, AdminCursor, AdminLimit, AdminPageMeta } from "./admin-shared.js"
import { ReportCalendarDate } from "./admin-reports.js"
import { ReceiptSipMonth } from "./client-receipts.js"
import { defineOperation } from "./descriptor.js"
import { SipScheduleMonth } from "./sip-schedules.js"

export const AdminRecordingSheetEntry = z.strictObject({
  entryId: Uuid,
  amountPaise: Paise,
  effectiveDate: ReportCalendarDate,
  recordedAt: IsoDateTime,
})
export type AdminRecordingSheetEntry = z.infer<typeof AdminRecordingSheetEntry>

export const AdminRecordingSheetRow = z.strictObject({
  scheduleId: Uuid,
  userId: Uuid,
  clientName: z.string(),
  clientEmail: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  monthlyAmountPaise: Paise,
  startMonth: ReceiptSipMonth,
  monthCount: z.number().int(),
  recorded: AdminRecordingSheetEntry.nullable(),
})
export type AdminRecordingSheetRow = z.infer<typeof AdminRecordingSheetRow>

export const AdminRecordingSheetData = z.strictObject({
  month: SipScheduleMonth,
  items: z.array(AdminRecordingSheetRow),
})
export type AdminRecordingSheetData = z.infer<typeof AdminRecordingSheetData>

export const AdminRecordingSheetQuery = z.strictObject({
  month: SipScheduleMonth,
  fundId: Uuid.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})
export type AdminRecordingSheetQuery = z.infer<typeof AdminRecordingSheetQuery>

export const listAdminRecordingSheet = defineOperation({
  operationId: "listAdminRecordingSheet",
  method: "GET",
  path: "/v1/admin/recording-sheet",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminRecordingSheetQuery },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminRecordingSheetData, { page: AdminPageMeta }) },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const RECORDING_SHEET_OPERATIONS = Object.freeze([listAdminRecordingSheet])
