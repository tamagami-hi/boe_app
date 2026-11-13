import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { ReceiptSipMonth } from "./client-receipts.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const SipScheduleMonth = z.string().regex(/^2[01]\d{2}-(0[1-9]|1[0-2])$/u)
export const MAX_SIP_SCHEDULE_MONTHS = 600

const SipScheduleMonthCount = z.number().int().min(1).max(MAX_SIP_SCHEDULE_MONTHS)
const PositivePaise = Paise.refine((value) => !/^0$/u.test(value))

export const AdminSipScheduleState = z.enum(["active", "closed"])
export type AdminSipScheduleState = z.infer<typeof AdminSipScheduleState>

export const AdminSipScheduleLink = z.strictObject({ scheduleId: Uuid, month: SipScheduleMonth })
export type AdminSipScheduleLink = z.infer<typeof AdminSipScheduleLink>

export const AdminSipSchedule = z.strictObject({
  scheduleId: Uuid,
  userId: Uuid,
  clientName: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  monthlyAmountPaise: Paise,
  startMonth: ReceiptSipMonth,
  endMonth: ReceiptSipMonth,
  monthCount: z.number().int(),
  state: z.string(),
  version: z.number().int().positive(),
  monthsPaid: z.number().int(),
  monthsDue: z.number().int(),
  nextUnpaidMonth: ReceiptSipMonth.nullable(),
  paidMonths: z.array(ReceiptSipMonth),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: IsoDateTime.nullable(),
})
export type AdminSipSchedule = z.infer<typeof AdminSipSchedule>

export const AdminSipSchedulesData = z.strictObject({ items: z.array(AdminSipSchedule) })
export type AdminSipSchedulesData = z.infer<typeof AdminSipSchedulesData>

export const AdminSipSchedulePage = createSuccessEnvelopeSchema(AdminSipSchedulesData, { page: AdminPageMeta })

export const AdminFundSipSchedulesQuery = z.strictObject({
  fundId: Uuid,
  state: AdminSipScheduleState.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})
export type AdminFundSipSchedulesQuery = z.infer<typeof AdminFundSipSchedulesQuery>

export const AdminSipScheduleData = z.strictObject({ schedule: AdminSipSchedule })
export type AdminSipScheduleData = z.infer<typeof AdminSipScheduleData>

const ClientParams = z.strictObject({ userId: Uuid })
const ScheduleParams = z.strictObject({ userId: Uuid, scheduleId: Uuid })

export const listAdminClientSipSchedules = defineOperation({
  operationId: "listAdminClientSipSchedules",
  method: "GET",
  path: "/v1/admin/clients/{userId}/sip-schedules",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: ClientParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipSchedulesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const listAdminFundSipSchedules = defineOperation({
  operationId: "listAdminFundSipSchedules",
  method: "GET",
  path: "/v1/admin/sip-schedules",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminFundSipSchedulesQuery },
  success: { status: 200, schema: AdminSipSchedulePage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminCreateSipScheduleBody = z.strictObject({
  fundId: Uuid,
  monthlyAmountPaise: PositivePaise,
  startMonth: SipScheduleMonth,
  monthCount: SipScheduleMonthCount,
})
export type AdminCreateSipScheduleBody = z.infer<typeof AdminCreateSipScheduleBody>

export const createAdminSipSchedule = defineOperation({
  operationId: "createAdminSipSchedule",
  method: "POST",
  path: "/v1/admin/clients/{userId}/sip-schedules",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: ClientParams,
    body: AdminCreateSipScheduleBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminSipScheduleData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminEditSipScheduleBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  monthlyAmountPaise: PositivePaise.optional(),
  monthCount: SipScheduleMonthCount.optional(),
  state: AdminSipScheduleState.optional(),
})
export type AdminEditSipScheduleBody = z.infer<typeof AdminEditSipScheduleBody>

export const editAdminSipSchedule = defineOperation({
  operationId: "editAdminSipSchedule",
  method: "PATCH",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: ScheduleParams,
    body: AdminEditSipScheduleBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipScheduleData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminCloseSipScheduleBody = z.strictObject({ expectedVersion: z.number().int().positive() })
export type AdminCloseSipScheduleBody = z.infer<typeof AdminCloseSipScheduleBody>

export const closeAdminSipSchedule = defineOperation({
  operationId: "closeAdminSipSchedule",
  method: "POST",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}/close",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: ScheduleParams,
    body: AdminCloseSipScheduleBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipScheduleData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ClientSipSchedule = z.strictObject({
  scheduleId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  monthlyAmountPaise: Paise,
  startMonth: ReceiptSipMonth,
  totalMonths: z.number().int(),
  monthsPaid: z.number().int(),
  state: z.string(),
})
export type ClientSipSchedule = z.infer<typeof ClientSipSchedule>

export const ClientSipSchedulesData = z.strictObject({ items: z.array(ClientSipSchedule) })
export type ClientSipSchedulesData = z.infer<typeof ClientSipSchedulesData>

export const listClientSipSchedules = defineOperation({
  operationId: "listClientSipSchedules",
  method: "GET",
  path: "/v1/client/sip-schedules",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientSipSchedulesData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const SIP_SCHEDULE_OPERATIONS = Object.freeze([
  listAdminClientSipSchedules,
  listAdminFundSipSchedules,
  createAdminSipSchedule,
  editAdminSipSchedule,
  closeAdminSipSchedule,
  listClientSipSchedules,
])
