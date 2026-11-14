import { z } from "zod"

import { createPaginatedSuccessEnvelopeSchema, createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import { IsoDate, ListQuery } from "./client.js"
import { defineOperation } from "./descriptor.js"

export const ReceiptSipMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u)

export const ClientReceipt = z.strictObject({
  entryId: Uuid,
  orderId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  amountPaise: Paise,
  effectiveDate: IsoDate,
  recordedAt: IsoDateTime,
  reversedAt: IsoDateTime.nullable(),
  sipMonth: ReceiptSipMonth.nullable(),
})
export type ClientReceipt = z.infer<typeof ClientReceipt>

export const ClientReceiptsQuery = ListQuery.extend({ fundId: Uuid.optional() })

export const ClientReceiptsData = z.strictObject({ items: z.array(ClientReceipt) })
export type ClientReceiptsData = z.infer<typeof ClientReceiptsData>

export const ClientReceiptData = z.strictObject({ receipt: ClientReceipt })
export type ClientReceiptData = z.infer<typeof ClientReceiptData>

export const listClientReceipts = defineOperation({
  operationId: "listClientReceipts",
  method: "GET",
  path: "/v1/client/receipts",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: ClientReceiptsQuery },
  success: { status: 200, schema: createPaginatedSuccessEnvelopeSchema(ClientReceiptsData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CURSOR_INVALID",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const getClientReceipt = defineOperation({
  operationId: "getClientReceipt",
  method: "GET",
  path: "/v1/client/receipts/{entryId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ entryId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientReceiptData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "RESOURCE_NOT_FOUND",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const CLIENT_RECEIPT_OPERATIONS = Object.freeze([listClientReceipts, getClientReceipt])
