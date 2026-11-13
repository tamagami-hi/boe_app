import { z } from "zod"

import {
  EARLIEST_MATURITY_DATE,
  LATEST_MATURITY_DATE,
  daysUntilMaturity,
  maturityDueStatus,
  type MaturityDueWindow,
} from "../domain/admin/maturityDueWindow.js"
import { MAX_SCHEDULE_MONTHS } from "../domain/admin/sipScheduleMonths.js"
import type { MaturityScheduleRow } from "../repositories/clientMaturityScheduleRepository.js"
import { iso, isoOrNull, limitSchema, positivePaiseSchema, uuidParam } from "./adminRouteKit.js"
import { sipMonthSchema } from "./sipScheduleProjection.js"

export const maturityDateSchema = z.iso
  .date()
  .refine((value) => value >= EARLIEST_MATURITY_DATE && value <= LATEST_MATURITY_DATE, "must be from 2000-01-01 to 2199-12-31")

const versionSchema = z.number().int().positive()
const NON_NEGATIVE_PAISE = /^(0|[1-9][0-9]{0,18})$/u
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n
const nonNegativePaiseSchema = z
  .string()
  .regex(NON_NEGATIVE_PAISE, "must be a whole number of paise, zero or more")
  .refine((value) => NON_NEGATIVE_PAISE.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX, "is out of range")
const effectiveDateSchema = z.iso.date()
const followUpSchema = z.strictObject({
  monthlyAmountPaise: positivePaiseSchema,
  startMonth: sipMonthSchema,
  monthCount: z.number().int().min(1).max(MAX_SCHEDULE_MONTHS),
})
const extensionSchema = z.strictObject({
  months: z.number().int().min(1).max(MAX_SCHEDULE_MONTHS - 1),
  nextMaturityDate: maturityDateSchema,
})

export const scheduleStateSchema = z.enum(["scheduled", "resolved", "cancelled"])

export const setMaturityBodySchema = z.strictObject({ fundId: uuidParam, maturityDate: maturityDateSchema })
export const editMaturityBodySchema = z.strictObject({ expectedVersion: versionSchema, maturityDate: maturityDateSchema })
export const cancelMaturityBodySchema = z.strictObject({ expectedVersion: versionSchema })
export const resolveMaturityBodySchema = z.discriminatedUnion("resolution", [
  z.strictObject({
    resolution: z.literal("return_all"),
    expectedVersion: versionSchema,
    effectiveDate: effectiveDateSchema,
    amountPaise: positivePaiseSchema,
  }),
  z.strictObject({
    resolution: z.literal("one_time_and_sip"),
    expectedVersion: versionSchema,
    effectiveDate: effectiveDateSchema,
    expectedPrincipalPaise: nonNegativePaiseSchema,
    expectedCurrentValuePaise: nonNegativePaiseSchema,
    sip: followUpSchema,
  }),
  z.strictObject({
    resolution: z.literal("sip_extension"),
    expectedVersion: versionSchema,
    extension: extensionSchema,
  }),
])
export type ResolveMaturityBody = z.infer<typeof resolveMaturityBodySchema>

export const sendOptionsBodySchema = z.strictObject({
  expectedVersion: versionSchema,
  sip: followUpSchema,
  extension: extensionSchema.nullable(),
})
export type SendOptionsBody = z.infer<typeof sendOptionsBodySchema>

const offerVersions = { expectedVersion: versionSchema, offerVersion: versionSchema }

export const withdrawOfferBodySchema = z.strictObject(offerVersions)

export const confirmOfferBodySchema = z.discriminatedUnion("option", [
  z.strictObject({
    option: z.literal("return_all"),
    ...offerVersions,
    effectiveDate: effectiveDateSchema,
    amountPaise: positivePaiseSchema,
  }),
  z.strictObject({
    option: z.literal("one_time_and_sip"),
    ...offerVersions,
    effectiveDate: effectiveDateSchema,
    expectedPrincipalPaise: nonNegativePaiseSchema,
    expectedCurrentValuePaise: nonNegativePaiseSchema,
  }),
  z.strictObject({ option: z.literal("sip_extension"), ...offerVersions }),
])
export type ConfirmOfferBody = z.infer<typeof confirmOfferBodySchema>

export const dashboardQuerySchema = z.strictObject({
  state: scheduleStateSchema.default("scheduled"),
  after: z.string().min(1).optional(),
  limit: limitSchema,
})
export const dueQuerySchema = z.strictObject({ limit: limitSchema })

const mapOpenOffer = (row: MaturityScheduleRow): Record<string, unknown> | null =>
  row.offerId === null
    ? null
    : {
        offerId: row.offerId,
        version: Number(row.offerVersion),
        sentAt: isoOrNull(row.offerSentAt),
        chosenOption: row.offerChosenOption,
        chosenAt: isoOrNull(row.offerChosenAt),
        sip: {
          monthlyAmountPaise: row.offerSipMonthlyAmountPaise,
          startMonth: row.offerSipStartMonth,
          monthCount: row.offerSipMonthCount,
        },
        extension:
          row.offerExtensionMonths === null
            ? null
            : { months: row.offerExtensionMonths, nextMaturityDate: row.offerNextMaturityDate },
      }

export const mapMaturitySchedule = (row: MaturityScheduleRow, window: MaturityDueWindow): Record<string, unknown> => ({
  scheduleId: row.id,
  userId: row.userId,
  clientName: row.clientName,
  fundId: row.fundId,
  fundName: row.fundName,
  maturityDate: row.maturityDate,
  state: row.state,
  resolution: row.resolution,
  dueStatus: maturityDueStatus(row, window),
  daysUntil: daysUntilMaturity(row.maturityDate, window),
  maturityId: row.maturityId,
  followUpSipScheduleId: row.followUpSipScheduleId,
  version: Number(row.version),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  resolvedAt: isoOrNull(row.resolvedAt),
  cancelledAt: isoOrNull(row.cancelledAt),
  offer: mapOpenOffer(row),
})

export const mapDueWindow = (window: MaturityDueWindow): Record<string, unknown> => ({
  asOf: window.asOf,
  dueThrough: window.dueThrough,
  windowDays: window.windowDays,
})
