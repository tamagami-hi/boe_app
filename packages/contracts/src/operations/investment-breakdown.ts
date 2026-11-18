import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { SignedPaise, Uuid } from "../scalars.js"
import { BasisPoints } from "./admin-client-returns.js"
import { IsoDate } from "./client.js"
import { defineOperation } from "./descriptor.js"

export const InvestmentBreakdownStatus = z.enum(["ready", "preparing"])
export type InvestmentBreakdownStatus = z.infer<typeof InvestmentBreakdownStatus>

export const InvestmentBreakdownSipState = z.enum(["active", "ended"])
export type InvestmentBreakdownSipState = z.infer<typeof InvestmentBreakdownSipState>

export const InvestmentBreakdownSip = z.strictObject({
  scheduleId: Uuid,
  state: InvestmentBreakdownSipState,
  investedPaise: SignedPaise,
  valuePaise: SignedPaise,
  growthPaise: SignedPaise,
  simpleReturnBasisPoints: BasisPoints.nullable(),
  xirrBasisPoints: BasisPoints.nullable(),
  monthsPaid: z.number().int().nonnegative(),
  monthsTotal: z.number().int().positive(),
})
export type InvestmentBreakdownSip = z.infer<typeof InvestmentBreakdownSip>

export const InvestmentBreakdownOneTime = z.strictObject({
  entryId: Uuid,
  effectiveDate: IsoDate,
  investedPaise: SignedPaise,
  valuePaise: SignedPaise,
  growthPaise: SignedPaise,
  simpleReturnBasisPoints: BasisPoints.nullable(),
  reversed: z.boolean(),
})
export type InvestmentBreakdownOneTime = z.infer<typeof InvestmentBreakdownOneTime>

export const InvestmentBreakdownLineKind = z.enum(["other_adjustments"])
export type InvestmentBreakdownLineKind = z.infer<typeof InvestmentBreakdownLineKind>

export const InvestmentBreakdownLine = z.strictObject({
  kind: InvestmentBreakdownLineKind,
  valuePaise: SignedPaise,
})
export type InvestmentBreakdownLine = z.infer<typeof InvestmentBreakdownLine>

export const InvestmentBreakdownFund = z.strictObject({
  fundId: Uuid,
  fundName: z.string(),
  status: InvestmentBreakdownStatus,
  sips: z.array(InvestmentBreakdownSip),
  oneTime: z.array(InvestmentBreakdownOneTime),
  lines: z.array(InvestmentBreakdownLine),
})
export type InvestmentBreakdownFund = z.infer<typeof InvestmentBreakdownFund>

export const ClientInvestmentBreakdownData = z.strictObject({
  asOfDate: IsoDate,
  funds: z.array(InvestmentBreakdownFund),
})
export type ClientInvestmentBreakdownData = z.infer<typeof ClientInvestmentBreakdownData>

export const getClientInvestmentBreakdown = defineOperation({
  operationId: "getClientInvestmentBreakdown",
  method: "GET",
  path: "/v1/client/investment-breakdown",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientInvestmentBreakdownData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const INVESTMENT_BREAKDOWN_OPERATIONS = Object.freeze([getClientInvestmentBreakdown])
