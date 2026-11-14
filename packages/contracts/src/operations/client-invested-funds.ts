import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { Uuid } from "../scalars.js"
import { defineOperation } from "./descriptor.js"

export const ClientInvestedFund = z.strictObject({
  fundId: Uuid,
  fundName: z.string(),
  fundPublished: z.boolean(),
})
export type ClientInvestedFund = z.infer<typeof ClientInvestedFund>

export const ClientInvestedFundsData = z.strictObject({ items: z.array(ClientInvestedFund) })
export type ClientInvestedFundsData = z.infer<typeof ClientInvestedFundsData>

export const ClientInvestedFundData = z.strictObject({ investedFund: ClientInvestedFund })
export type ClientInvestedFundData = z.infer<typeof ClientInvestedFundData>

export const listClientInvestedFunds = defineOperation({
  operationId: "listClientInvestedFunds",
  method: "GET",
  path: "/v1/client/invested-funds",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientInvestedFundsData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const getClientInvestedFund = defineOperation({
  operationId: "getClientInvestedFund",
  method: "GET",
  path: "/v1/client/invested-funds/{fundId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ fundId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientInvestedFundData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "RESOURCE_NOT_FOUND",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const CLIENT_INVESTED_FUND_OPERATIONS = Object.freeze([listClientInvestedFunds, getClientInvestedFund])
