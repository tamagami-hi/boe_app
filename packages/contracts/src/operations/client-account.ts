import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import { ClientInvestmentStatus, IsoDate } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullableIsoDateTime = IsoDateTime.nullable()

export const MAX_ACCOUNT_LIST_LIMIT = 200

export const AccountListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_ACCOUNT_LIST_LIMIT).optional(),
})

const ACCOUNT_READ_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "INTERNAL_ERROR",
] as const

export const NotificationItem = z.strictObject({
  id: Uuid,
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  readAt: NullableIsoDateTime,
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTime,
})
export type NotificationItem = z.infer<typeof NotificationItem>

export const listClientNotifications = defineOperation({
  operationId: "listClientNotifications",
  method: "GET",
  path: "/v1/client/notifications",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: AccountListQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({
        items: z.array(NotificationItem),
        unreadCount: z.number().int(),
      }),
    ),
  },
  errorCodes: [...ACCOUNT_READ_ERRORS, "VALIDATION_FAILED"],
})

export const markNotificationRead = defineOperation({
  operationId: "markNotificationRead",
  method: "PATCH",
  path: "/v1/client/notifications/{notificationId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {
    params: z.strictObject({ notificationId: Uuid }),
    body: z.strictObject({ read: z.literal(true) }),
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(NotificationItem) },
  errorCodes: [...ACCOUNT_READ_ERRORS, "VALIDATION_FAILED", "RESOURCE_NOT_FOUND"],
})

export const PAYMENT_STATE_FILTERS = Object.freeze([
  "created",
  "provider_pending",
  "succeeded",
  "failed",
  "expired",
  "reconciliation_required",
  "refund_pending",
  "refund_failed",
  "refunded",
  "pending",
  "gateway_initiated",
  "success",
  "confirmed",
  "reconciled",
  "rejected",
  "refund_in_progress",
  "support_required",
  "payment_in_progress",
  "processing",
  "payment_failed",
] as const)

export const PaymentStateFilter = z.enum(PAYMENT_STATE_FILTERS)
export type PaymentStateFilter = z.infer<typeof PaymentStateFilter>

export const PaymentHistoryQuery = z.strictObject({
  status: z.union([PaymentStateFilter, z.array(PaymentStateFilter)]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ACCOUNT_LIST_LIMIT).optional(),
})

export const PaymentHistoryItem = z.strictObject({
  id: Uuid,
  orderId: Uuid,
  fundId: Uuid.nullable(),
  status: ClientInvestmentStatus,
  amountPaise: Paise,
  currency: z.string(),
  provider: z.string().nullable(),
  failureCode: z.string().nullable(),
  succeededAt: NullableIsoDateTime,
  confirmedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItem>

export const listClientPayments = defineOperation({
  operationId: "listClientPayments",
  method: "GET",
  path: "/v1/client/payments",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: PaymentHistoryQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(PaymentHistoryItem) }),
    ),
  },
  errorCodes: [...ACCOUNT_READ_ERRORS, "VALIDATION_FAILED"],
})

export const StatementPeriod = z.strictObject({
  id: z.string().regex(/^\d{4}-\d{2}$/u),
  period: z.string().regex(/^\d{4}-\d{2}$/u),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  openingValuePaise: SignedPaise,
  contributionsPaise: SignedPaise,
  growthPaise: SignedPaise,
  reversalsPaise: SignedPaise,
  closingValuePaise: SignedPaise,
  totalInvestmentPaise: SignedPaise,
  entryCount: z.number().int(),
})
export type StatementPeriod = z.infer<typeof StatementPeriod>

export const listClientStatements = defineOperation({
  operationId: "listClientStatements",
  method: "GET",
  path: "/v1/client/statements",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(StatementPeriod) })),
  },
  errorCodes: [...ACCOUNT_READ_ERRORS],
})

export const FaqItem = z.strictObject({
  key: z.string(),
  q: z.string(),
  a: z.string(),
  version: z.number().int(),
})
export type FaqItem = z.infer<typeof FaqItem>

export const listSupportFaqs = defineOperation({
  operationId: "listSupportFaqs",
  method: "GET",
  path: "/v1/client/support/faqs",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(FaqItem) })),
  },
  errorCodes: [...ACCOUNT_READ_ERRORS],
})

export const SupportRequestState = z.enum(["open", "in_progress", "resolved", "closed"])
export type SupportRequestState = z.infer<typeof SupportRequestState>

export const SupportTicket = z.strictObject({
  id: Uuid,
  reference: z.string(),
  category: z.string(),
  subject: z.string(),
  body: z.string(),
  status: SupportRequestState,
  resolutionNote: z.string().nullable(),
  resolvedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type SupportTicket = z.infer<typeof SupportTicket>

export const listSupportTickets = defineOperation({
  operationId: "listSupportTickets",
  method: "GET",
  path: "/v1/client/support/tickets",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: AccountListQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(SupportTicket) })),
  },
  errorCodes: [...ACCOUNT_READ_ERRORS, "VALIDATION_FAILED"],
})

export const MAX_TICKET_SUBJECT_LENGTH = 200
export const MAX_TICKET_BODY_LENGTH = 5_000
export const MAX_TICKET_CATEGORY_LENGTH = 60

export const CreateSupportTicketBody = z.strictObject({
  subject: z.string().trim().min(1).max(MAX_TICKET_SUBJECT_LENGTH),
  body: z.string().trim().min(1).max(MAX_TICKET_BODY_LENGTH),
  category: z.string().trim().min(1).max(MAX_TICKET_CATEGORY_LENGTH).optional(),
})
export type CreateSupportTicketBody = z.infer<typeof CreateSupportTicketBody>

export const createSupportTicket = defineOperation({
  operationId: "createSupportTicket",
  method: "POST",
  path: "/v1/client/support/tickets",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: CreateSupportTicketBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(SupportTicket) },
  errorCodes: [
    ...ACCOUNT_READ_ERRORS,
    "VALIDATION_FAILED",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
  ],
})

export const ResearchContextData = z.strictObject({
  items: z.array(z.unknown()),
  title: z.string().optional(),
  version: z.number().int().optional(),
  publishedAt: NullableIsoDateTime.optional(),
})
export type ResearchContextData = z.infer<typeof ResearchContextData>

export const getResearchContext = defineOperation({
  operationId: "getResearchContext",
  method: "GET",
  path: "/v1/client/research-context",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ResearchContextData) },
  errorCodes: [...ACCOUNT_READ_ERRORS],
})

export const CLIENT_ACCOUNT_OPERATIONS = Object.freeze([
  listClientNotifications,
  markNotificationRead,
  listClientPayments,
  listClientStatements,
  listSupportFaqs,
  listSupportTickets,
  createSupportTicket,
  getResearchContext,
])
