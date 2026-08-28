import { z } from "zod"

import { createPaginatedSuccessEnvelopeSchema, createSuccessEnvelopeSchema } from "../envelope.js"
import { Cursor, IsoDateTime, Paise, Uuid } from "../scalars.js"
import { ClientInvestmentStatus } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullableIsoDateTime = IsoDateTime.nullable()

export const OrderType = z.enum(["lump_sum", "sip_installment"])
export type OrderType = z.infer<typeof OrderType>

export const PaymentAttemptState = z.enum([
  "created",
  "provider_pending",
  "succeeded",
  "failed",
  "expired",
  "reconciliation_required",
  "refund_pending",
  "refunded",
  "refund_failed",
])
export type PaymentAttemptState = z.infer<typeof PaymentAttemptState>

export const OrderSummary = z.strictObject({
  orderId: Uuid,
  fundId: Uuid,
  sipPlanId: Uuid.nullable(),
  type: OrderType,
  status: ClientInvestmentStatus,
  amountPaise: Paise,
  currency: z.string(),
  requestedAt: IsoDateTime,
  paymentConfirmedAt: NullableIsoDateTime,
  acceptedAt: NullableIsoDateTime,
  cancelledAt: NullableIsoDateTime,
  failureCode: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int(),
})
export type OrderSummary = z.infer<typeof OrderSummary>

export const OrderHistoryQuery = z.strictObject({
  after: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const listClientOrders = defineOperation({
  operationId: "listClientOrders",
  method: "GET",
  path: "/v1/client/orders",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: OrderHistoryQuery },
  success: {
    status: 200,
    schema: createPaginatedSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(OrderSummary) }),
    ),
  },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CURSOR_INVALID",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const getClientOrder = defineOperation({
  operationId: "getClientOrder",
  method: "GET",
  path: "/v1/client/orders/{orderId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ orderId: Uuid }) },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ order: OrderSummary })),
  },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "RESOURCE_NOT_FOUND",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const PaymentDetail = z.strictObject({
  paymentId: Uuid,
  orderId: Uuid,
  fundId: Uuid,
  amountPaise: Paise,
  currency: z.string(),
  status: ClientInvestmentStatus,
  provider: z.string().nullable(),
  attemptStatus: PaymentAttemptState.nullable(),
  failureCode: z.string().nullable(),
  expiresAt: NullableIsoDateTime,
  succeededAt: NullableIsoDateTime,
  failedAt: NullableIsoDateTime,
  refundedAt: NullableIsoDateTime,
  confirmedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type PaymentDetail = z.infer<typeof PaymentDetail>

export const getClientPayment = defineOperation({
  operationId: "getClientPayment",
  method: "GET",
  path: "/v1/client/payments/{paymentId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ paymentId: Uuid }) },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ payment: PaymentDetail })),
  },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "RESOURCE_NOT_FOUND",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const CreateOrderBody = z.strictObject({
  fundId: Uuid,
  amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
})
export type CreateOrderBody = z.infer<typeof CreateOrderBody>

export const CreatedOrderData = z.strictObject({
  orderId: Uuid,
  fundId: Uuid,
  type: OrderType,
  status: z.literal("payment_in_progress"),
  amountPaise: Paise,
  currency: z.string(),
  version: z.number().int(),
  createdAt: IsoDateTime,
})
export type CreatedOrderData = z.infer<typeof CreatedOrderData>

export const createClientOrder = defineOperation({
  operationId: "createClientOrder",
  method: "POST",
  path: "/v1/client/orders",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: {
    body: CreateOrderBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(CreatedOrderData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "VALIDATION_FAILED",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_IN_PROGRESS",
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    "INTERNAL_ERROR",
  ],
})

export const PayOrderBody = z.strictObject({
  checkoutChannel: z.literal("hosted_redirect"),
})
export type PayOrderBody = z.infer<typeof PayOrderBody>

export const HostedCheckout = z.strictObject({
  type: z.literal("redirect"),
  url: z.string(),
})
export type HostedCheckout = z.infer<typeof HostedCheckout>

export const TerminalOrderPayData = z.strictObject({
  orderId: Uuid,
  status: ClientInvestmentStatus,
  terminal: z.literal(true),
})
export type TerminalOrderPayData = z.infer<typeof TerminalOrderPayData>

export const CheckoutPayData = z.strictObject({
  orderId: Uuid,
  paymentId: Uuid,
  provider: z.literal("phonepe"),
  status: z.literal("payment_in_progress"),
  checkout: HostedCheckout.nullable(),
  expiresAt: IsoDateTime,
})
export type CheckoutPayData = z.infer<typeof CheckoutPayData>

export const PayOrderData = z.union([TerminalOrderPayData, CheckoutPayData])
export type PayOrderData = z.infer<typeof PayOrderData>

export const payClientOrder = defineOperation({
  operationId: "payClientOrder",
  method: "POST",
  path: "/v1/client/orders/{orderId}/pay",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: {
    params: z.strictObject({ orderId: Uuid }),
    body: PayOrderBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(PayOrderData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "VALIDATION_FAILED",
    "DEPENDENCY_UNAVAILABLE",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_IN_PROGRESS",
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    "INTERNAL_ERROR",
  ],
})

export const CLIENT_ORDER_OPERATIONS = Object.freeze([
  listClientOrders,
  getClientOrder,
  getClientPayment,
  createClientOrder,
  payClientOrder,
])
