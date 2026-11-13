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
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { MAX_SIP_SCHEDULE_MONTHS, SipScheduleMonth } from "./sip-schedules.js"

const CalendarDate = z.iso.date()
export const MaturityDate = CalendarDate.refine(
  (value) => value >= "2000-01-01" && value <= "2199-12-31",
  "must be from 2000-01-01 to 2199-12-31",
)
const PositivePaise = Paise.refine((value) => !/^0$/u.test(value))
const Version = z.number().int().positive()

export const AdminMaturityScheduleState = z.enum(["scheduled", "resolved", "cancelled"])
export type AdminMaturityScheduleState = z.infer<typeof AdminMaturityScheduleState>

export const AdminMaturityResolution = z.enum(["return_all", "one_time_and_sip", "sip_reinvestment", "sip_extension"])
export type AdminMaturityResolution = z.infer<typeof AdminMaturityResolution>

export const MaturityOptionKey = z.enum(["return_all", "one_time_and_sip", "sip_extension"])
export type MaturityOptionKey = z.infer<typeof MaturityOptionKey>

export const MaturityOfferSip = z.strictObject({
  monthlyAmountPaise: Paise,
  startMonth: SipScheduleMonth,
  monthCount: z.number().int().min(1).max(MAX_SIP_SCHEDULE_MONTHS),
})
export type MaturityOfferSip = z.infer<typeof MaturityOfferSip>

export const MaturitySipExtension = z.strictObject({
  months: z.number().int().min(1).max(MAX_SIP_SCHEDULE_MONTHS - 1),
  nextMaturityDate: MaturityDate,
})
export type MaturitySipExtension = z.infer<typeof MaturitySipExtension>

export const AdminMaturityOffer = z.strictObject({
  offerId: Uuid,
  version: Version,
  sentAt: IsoDateTime,
  chosenOption: z.string().nullable(),
  chosenAt: IsoDateTime.nullable(),
  sip: MaturityOfferSip,
  extension: MaturitySipExtension.nullable(),
})
export type AdminMaturityOffer = z.infer<typeof AdminMaturityOffer>

export const AdminMaturitySchedule = z.strictObject({
  scheduleId: Uuid,
  userId: Uuid,
  clientName: z.string(),
  fundId: Uuid,
  fundName: z.string(),
  maturityDate: CalendarDate,
  state: z.string(),
  resolution: z.string().nullable(),
  dueStatus: z.string(),
  daysUntil: z.number().int(),
  maturityId: Uuid.nullable(),
  followUpSipScheduleId: Uuid.nullable(),
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  offer: AdminMaturityOffer.nullable(),
})
export type AdminMaturitySchedule = z.infer<typeof AdminMaturitySchedule>

export const AdminMaturitySchedulesData = z.strictObject({ items: z.array(AdminMaturitySchedule) })
export type AdminMaturitySchedulesData = z.infer<typeof AdminMaturitySchedulesData>

export const AdminMaturityScheduleData = z.strictObject({ schedule: AdminMaturitySchedule })
export type AdminMaturityScheduleData = z.infer<typeof AdminMaturityScheduleData>

export const AdminMaturityDashboardQuery = z.strictObject({
  state: AdminMaturityScheduleState.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})
export type AdminMaturityDashboardQuery = z.infer<typeof AdminMaturityDashboardQuery>

export const AdminDueMaturitiesQuery = z.strictObject({ limit: AdminLimit })
export type AdminDueMaturitiesQuery = z.infer<typeof AdminDueMaturitiesQuery>

export const AdminDueMaturitiesData = z.strictObject({
  asOf: CalendarDate,
  dueThrough: CalendarDate,
  windowDays: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(AdminMaturitySchedule),
})
export type AdminDueMaturitiesData = z.infer<typeof AdminDueMaturitiesData>

const ClientParams = z.strictObject({ userId: Uuid })
const ScheduleParams = z.strictObject({ userId: Uuid, scheduleId: Uuid })
const AdminRead = {
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
} as const
const AdminWrite = {
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
} as const
const MutationRequest = {
  headers: RequiredAdminMutationHeaders,
  mediaType: "application/json",
  maxBodyBytes: MAX_JSON_BODY_BYTES,
} as const
const WRITE_ERRORS = [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"] as const

export const listAdminMaturities = defineOperation({
  ...AdminRead,
  operationId: "listAdminMaturities",
  method: "GET",
  path: "/v1/admin/maturities",
  request: { query: AdminMaturityDashboardQuery },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturitySchedulesData, { page: AdminPageMeta }) },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const listAdminDueMaturities = defineOperation({
  ...AdminRead,
  operationId: "listAdminDueMaturities",
  method: "GET",
  path: "/v1/admin/maturities/due",
  request: { query: AdminDueMaturitiesQuery },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminDueMaturitiesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const listAdminClientMaturitySchedules = defineOperation({
  ...AdminRead,
  operationId: "listAdminClientMaturitySchedules",
  method: "GET",
  path: "/v1/admin/clients/{userId}/maturity-schedules",
  request: { params: ClientParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturitySchedulesData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminSetMaturityDateBody = z.strictObject({ fundId: Uuid, maturityDate: MaturityDate })
export type AdminSetMaturityDateBody = z.infer<typeof AdminSetMaturityDateBody>

export const setAdminClientMaturityDate = defineOperation({
  ...AdminWrite,
  operationId: "setAdminClientMaturityDate",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules",
  request: { ...MutationRequest, params: ClientParams, body: AdminSetMaturityDateBody },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminMaturityScheduleData) },
  errorCodes: [...WRITE_ERRORS],
})

export const AdminEditMaturityDateBody = z.strictObject({ expectedVersion: Version, maturityDate: MaturityDate })
export type AdminEditMaturityDateBody = z.infer<typeof AdminEditMaturityDateBody>

export const editAdminClientMaturityDate = defineOperation({
  ...AdminWrite,
  operationId: "editAdminClientMaturityDate",
  method: "PATCH",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}",
  request: { ...MutationRequest, params: ScheduleParams, body: AdminEditMaturityDateBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturityScheduleData) },
  errorCodes: [...WRITE_ERRORS],
})

export const AdminCancelMaturityBody = z.strictObject({ expectedVersion: Version })
export type AdminCancelMaturityBody = z.infer<typeof AdminCancelMaturityBody>

export const cancelAdminClientMaturity = defineOperation({
  ...AdminWrite,
  operationId: "cancelAdminClientMaturity",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}/cancel",
  request: { ...MutationRequest, params: ScheduleParams, body: AdminCancelMaturityBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturityScheduleData) },
  errorCodes: [...WRITE_ERRORS],
})

export const AdminMaturityFollowUpSip = z.strictObject({
  monthlyAmountPaise: PositivePaise,
  startMonth: SipScheduleMonth,
  monthCount: z.number().int().min(1).max(MAX_SIP_SCHEDULE_MONTHS),
})
export type AdminMaturityFollowUpSip = z.infer<typeof AdminMaturityFollowUpSip>

export const AdminResolveMaturityBody = z.discriminatedUnion("resolution", [
  z.strictObject({
    resolution: z.literal("return_all"),
    expectedVersion: Version,
    effectiveDate: CalendarDate,
    amountPaise: PositivePaise,
  }),
  z.strictObject({
    resolution: z.literal("one_time_and_sip"),
    expectedVersion: Version,
    effectiveDate: CalendarDate,
    expectedPrincipalPaise: Paise,
    expectedCurrentValuePaise: Paise,
    sip: AdminMaturityFollowUpSip,
  }),
  z.strictObject({
    resolution: z.literal("sip_extension"),
    expectedVersion: Version,
    extension: MaturitySipExtension,
  }),
])
export type AdminResolveMaturityBody = z.infer<typeof AdminResolveMaturityBody>

export const AdminMaturityResolutionData = z.strictObject({
  schedule: AdminMaturitySchedule,
  settlementEntryId: Uuid.nullable(),
  payoutId: Uuid.nullable(),
  closedSipScheduleId: Uuid.nullable(),
  nextScheduleId: Uuid.nullable(),
})
export type AdminMaturityResolutionData = z.infer<typeof AdminMaturityResolutionData>

export const resolveAdminClientMaturity = defineOperation({
  ...AdminWrite,
  operationId: "resolveAdminClientMaturity",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}/resolve",
  request: { ...MutationRequest, params: ScheduleParams, body: AdminResolveMaturityBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturityResolutionData) },
  errorCodes: [...WRITE_ERRORS],
})

export const AdminSendMaturityOptionsBody = z.strictObject({
  expectedVersion: Version,
  offerVersion: Version.nullable(),
  sip: AdminMaturityFollowUpSip,
  extension: MaturitySipExtension.nullable(),
})
export type AdminSendMaturityOptionsBody = z.infer<typeof AdminSendMaturityOptionsBody>

export const sendAdminMaturityOptions = defineOperation({
  ...AdminWrite,
  operationId: "sendAdminMaturityOptions",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}/offers",
  request: { ...MutationRequest, params: ScheduleParams, body: AdminSendMaturityOptionsBody },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminMaturityScheduleData) },
  errorCodes: [...WRITE_ERRORS],
})

const OfferParams = z.strictObject({ userId: Uuid, scheduleId: Uuid, offerId: Uuid })
const OfferVersions = { expectedVersion: Version, offerVersion: Version }

export const AdminWithdrawMaturityOfferBody = z.strictObject(OfferVersions)
export type AdminWithdrawMaturityOfferBody = z.infer<typeof AdminWithdrawMaturityOfferBody>

export const withdrawAdminMaturityOffer = defineOperation({
  ...AdminWrite,
  operationId: "withdrawAdminMaturityOffer",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}/offers/{offerId}/withdraw",
  request: { ...MutationRequest, params: OfferParams, body: AdminWithdrawMaturityOfferBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturityScheduleData) },
  errorCodes: [...WRITE_ERRORS],
})

export const AdminConfirmMaturityOfferBody = z.discriminatedUnion("option", [
  z.strictObject({
    option: z.literal("return_all"),
    ...OfferVersions,
    effectiveDate: CalendarDate,
    amountPaise: PositivePaise,
  }),
  z.strictObject({
    option: z.literal("one_time_and_sip"),
    ...OfferVersions,
    effectiveDate: CalendarDate,
    expectedPrincipalPaise: Paise,
    expectedCurrentValuePaise: Paise,
  }),
  z.strictObject({ option: z.literal("sip_extension"), ...OfferVersions }),
])
export type AdminConfirmMaturityOfferBody = z.infer<typeof AdminConfirmMaturityOfferBody>

export const confirmAdminMaturityOffer = defineOperation({
  ...AdminWrite,
  operationId: "confirmAdminMaturityOffer",
  method: "POST",
  path: "/v1/admin/clients/{userId}/maturity-schedules/{scheduleId}/offers/{offerId}/confirm",
  request: { ...MutationRequest, params: OfferParams, body: AdminConfirmMaturityOfferBody },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMaturityResolutionData) },
  errorCodes: [...WRITE_ERRORS],
})

export const ADMIN_MATURITY_SCHEDULE_OPERATIONS = Object.freeze([
  listAdminMaturities,
  listAdminDueMaturities,
  listAdminClientMaturitySchedules,
  setAdminClientMaturityDate,
  editAdminClientMaturityDate,
  cancelAdminClientMaturity,
  resolveAdminClientMaturity,
  sendAdminMaturityOptions,
  withdrawAdminMaturityOffer,
  confirmAdminMaturityOffer,
])
