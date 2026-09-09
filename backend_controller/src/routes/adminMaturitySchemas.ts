import { z } from "zod"

import { reasonCodeSchema, reasonDetailSchema, uuidParam } from "./adminRouteKit.js"

const dateSchema = z.iso.date()
const settlementFields = {
  fundId: uuidParam,
  effectiveDate: dateSchema,
  reasonCode: reasonCodeSchema,
  note: reasonDetailSchema.optional(),
}
const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const POSTGRES_BIGINT_MAX = 9223372036854775807n
const positivePaiseSchema = z.string().regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX)

export const AdminMarkMaturityBody = z.strictObject({
  fundId: uuidParam,
  maturedOn: dateSchema,
  reasonCode: reasonCodeSchema,
  note: reasonDetailSchema.optional(),
})
export const AdminWithdrawalBody = z.strictObject({
  ...settlementFields,
  amountPaise: positivePaiseSchema,
})
export const AdminReinvestmentBody = z.strictObject(settlementFields)
export const AdminPayoutStatusBody = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("paid"),
    expectedVersion: versionSchema,
    transferReference: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    state: z.literal("failed"),
    expectedVersion: versionSchema,
    failureCode: z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,80}$/u),
  }),
])
