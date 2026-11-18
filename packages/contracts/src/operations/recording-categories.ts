import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { IsoDate } from "./client.js"
import { ReceiptSipMonth } from "./client-receipts.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { AdminSipSchedule, MAX_SIP_SCHEDULE_MONTHS, SipScheduleMonth } from "./sip-schedules.js"

export const AdminAssignedRecordingCategory = z.enum(["sip", "one_time"])
export type AdminAssignedRecordingCategory = z.infer<typeof AdminAssignedRecordingCategory>

export const AdminClientRecording = z.strictObject({
  entryId: Uuid,
  fundId: Uuid,
  amountPaise: Paise,
  effectiveDate: IsoDate,
  reasonCode: z.string(),
  recordedAt: IsoDateTime,
  reversed: z.boolean(),
  category: AdminAssignedRecordingCategory.nullable(),
  categoryLabel: z.string(),
  sipScheduleId: Uuid.nullable(),
  sipMonth: ReceiptSipMonth.nullable(),
  sipLinkAllowed: z.boolean(),
  oneTimeAllowed: z.boolean(),
})
export type AdminClientRecording = z.infer<typeof AdminClientRecording>

export const AdminClientRecordingsData = z.strictObject({ items: z.array(AdminClientRecording) })
export type AdminClientRecordingsData = z.infer<typeof AdminClientRecordingsData>

const ClientParams = z.strictObject({ userId: Uuid })
const ScheduleParams = z.strictObject({ userId: Uuid, scheduleId: Uuid })
const RecordingParams = z.strictObject({ userId: Uuid, entryId: Uuid })

export const listAdminClientRecordings = defineOperation({
  operationId: "listAdminClientRecordings",
  method: "GET",
  path: "/v1/admin/clients/{userId}/recorded-contributions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: ClientParams, query: z.strictObject({ fundId: Uuid.optional() }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientRecordingsData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminSipLinkProposalMonth = z.strictObject({
  month: ReceiptSipMonth,
  monthNumber: z.number().int().positive(),
  paid: z.boolean(),
  linkedEntryId: Uuid.nullable(),
  proposedEntryId: Uuid.nullable(),
})
export type AdminSipLinkProposalMonth = z.infer<typeof AdminSipLinkProposalMonth>

export const AdminSipLinkProposalData = z.strictObject({
  scheduleId: Uuid,
  months: z.array(AdminSipLinkProposalMonth),
  candidates: z.array(AdminClientRecording),
  schedule: AdminSipSchedule,
})
export type AdminSipLinkProposalData = z.infer<typeof AdminSipLinkProposalData>

export const getAdminSipLinkProposal = defineOperation({
  operationId: "getAdminSipLinkProposal",
  method: "GET",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}/link-proposal",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: ScheduleParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipLinkProposalData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminSipMonthLinksBody = z.strictObject({
  links: z
    .array(z.strictObject({ month: SipScheduleMonth, entryId: Uuid }))
    .min(1)
    .max(MAX_SIP_SCHEDULE_MONTHS),
})
export type AdminSipMonthLinksBody = z.infer<typeof AdminSipMonthLinksBody>

export const AdminSipMonthLinksData = z.strictObject({
  linked: z.number().int().positive(),
  schedule: AdminSipSchedule,
})
export type AdminSipMonthLinksData = z.infer<typeof AdminSipMonthLinksData>

export const linkAdminSipScheduleMonths = defineOperation({
  operationId: "linkAdminSipScheduleMonths",
  method: "POST",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}/month-links",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: ScheduleParams,
    body: AdminSipMonthLinksBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminSipMonthLinksData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminRecordingCategoryBody = z.strictObject({ category: z.literal("one_time") })
export type AdminRecordingCategoryBody = z.infer<typeof AdminRecordingCategoryBody>

export const AdminRecordingCategoryData = z.strictObject({ recording: AdminClientRecording })
export type AdminRecordingCategoryData = z.infer<typeof AdminRecordingCategoryData>

export const setAdminRecordingCategory = defineOperation({
  operationId: "setAdminRecordingCategory",
  method: "POST",
  path: "/v1/admin/clients/{userId}/recorded-contributions/{entryId}/category",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: RecordingParams,
    body: AdminRecordingCategoryBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminRecordingCategoryData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const RECORDING_CATEGORY_OPERATIONS = Object.freeze([
  listAdminClientRecordings,
  getAdminSipLinkProposal,
  linkAdminSipScheduleMonths,
  setAdminRecordingCategory,
])
