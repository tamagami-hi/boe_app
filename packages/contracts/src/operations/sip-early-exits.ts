import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import { AdminWithdrawalPayout } from "./admin-maturity.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { IsoDate } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const PositivePaise = Paise.refine((value) => !/^0$/u.test(value))
const ClientParams = z.strictObject({ userId: Uuid })
const ScheduleParams = z.strictObject({ userId: Uuid, scheduleId: Uuid })

export const SipEarlyExitRefusalCode = z.enum(["schedule_closed", "no_value", "maturity_settling", "maturity_due", "later_entry"])
export type SipEarlyExitRefusalCode = z.infer<typeof SipEarlyExitRefusalCode>

export const AdminSipEarlyExitPayout = AdminWithdrawalPayout.omit({ maturityId: true })
export type AdminSipEarlyExitPayout = z.infer<typeof AdminSipEarlyExitPayout>

export const AdminSipEarlyExit = z.strictObject({
  earlyExitId: Uuid,
  scheduleId: Uuid,
  userId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  entryId: Uuid,
  amountPaise: Paise,
  principalBeforePaise: Paise,
  valueBeforePaise: Paise,
  effectiveDate: IsoDate,
  cancelledMaturityScheduleId: Uuid.nullable(),
  cancelledMaturityDate: IsoDate.nullable(),
  createdAt: IsoDateTime,
  payout: AdminSipEarlyExitPayout,
})
export type AdminSipEarlyExit = z.infer<typeof AdminSipEarlyExit>

export const AdminSipEarlyExitPreview = z.strictObject({
  scheduleId: Uuid,
  scheduleVersion: z.number().int().positive(),
  scheduleState: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  principalPaise: SignedPaise,
  currentValuePaise: Paise,
  principalPortionPaise: Paise,
  growthPortionPaise: Paise,
  effectiveDate: IsoDate,
  maturity: z.strictObject({ scheduleId: Uuid, maturityDate: IsoDate }).nullable(),
  refusal: z.strictObject({ code: SipEarlyExitRefusalCode, message: z.string() }).nullable(),
})
export type AdminSipEarlyExitPreview = z.infer<typeof AdminSipEarlyExitPreview>

export const AdminSipEarlyExitBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  expectedValuePaise: PositivePaise,
})
export type AdminSipEarlyExitBody = z.infer<typeof AdminSipEarlyExitBody>

export const AdminSipEarlyExitData = z.strictObject({ earlyExit: AdminSipEarlyExit })
export type AdminSipEarlyExitData = z.infer<typeof AdminSipEarlyExitData>

export const AdminSipEarlyExitsData = z.strictObject({ items: z.array(AdminSipEarlyExit) })
export type AdminSipEarlyExitsData = z.infer<typeof AdminSipEarlyExitsData>

export const ClientSipEarlyExit = z.strictObject({
  earlyExitId: Uuid,
  scheduleId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  entryId: Uuid,
  amountPaise: Paise,
  effectiveDate: IsoDate,
  closedAt: IsoDateTime,
})
export type ClientSipEarlyExit = z.infer<typeof ClientSipEarlyExit>

export const ClientSipEarlyExitsData = z.strictObject({ items: z.array(ClientSipEarlyExit) })
export type ClientSipEarlyExitsData = z.infer<typeof ClientSipEarlyExitsData>

const AdminOperation = {
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
} as const

export const getAdminSipEarlyExitPreview = defineOperation({
  ...AdminOperation,
  operationId: "getAdminSipEarlyExitPreview",
  method: "GET",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}/early-exit",
  idempotency: "none",
  request: { params: ScheduleParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipEarlyExitPreview) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const exitAdminSipScheduleEarly = defineOperation({
  ...AdminOperation,
  operationId: "exitAdminSipScheduleEarly",
  method: "POST",
  path: "/v1/admin/clients/{userId}/sip-schedules/{scheduleId}/early-exit",
  idempotency: "required-key",
  request: {
    params: ScheduleParams,
    body: AdminSipEarlyExitBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminSipEarlyExitData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const listAdminClientSipEarlyExits = defineOperation({
  ...AdminOperation,
  operationId: "listAdminClientSipEarlyExits",
  method: "GET",
  path: "/v1/admin/clients/{userId}/sip-early-exits",
  idempotency: "none",
  request: { params: ClientParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSipEarlyExitsData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const listClientSipEarlyExits = defineOperation({
  operationId: "listClientSipEarlyExits",
  method: "GET",
  path: "/v1/client/sip-early-exits",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientSipEarlyExitsData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const SIP_EARLY_EXIT_OPERATIONS = Object.freeze([
  getAdminSipEarlyExitPreview,
  exitAdminSipScheduleEarly,
  listAdminClientSipEarlyExits,
  listClientSipEarlyExits,
])
