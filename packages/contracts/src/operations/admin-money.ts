import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  AdminReasonCode,
  AdminReasonDetail,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullableIsoDateTime = IsoDateTime.nullable()
const AsOfDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const NonZeroSignedPaise = SignedPaise.refine((value) => !/^-?0$/u.test(value))
const BasisHash = z.string().regex(/^[0-9a-f]{64}$/u)

export const AdminGrowthTarget = z.strictObject({
  userId: Uuid,
  beforePaise: SignedPaise,
  currentValuePaise: SignedPaise,
  deltaPaise: SignedPaise,
  growthPaise: SignedPaise,
  afterPaise: SignedPaise,
  newValuePaise: SignedPaise,
})
export type AdminGrowthTarget = z.infer<typeof AdminGrowthTarget>

export const AdminIndividualClientGrowthBody = z
  .strictObject({
    userId: Uuid,
    fundId: Uuid,
    growthPaise: NonZeroSignedPaise.optional(),
    growthBasisPoints: z.coerce.number().int().min(-10_000).max(100_000).optional(),
    effectiveDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminReasonDetail.optional(),
  })
  .refine(
    (value) =>
      (value.growthPaise === undefined) !== (value.growthBasisPoints === undefined),
    { message: "Provide exactly one of growthPaise or growthBasisPoints." },
  )
export type AdminIndividualClientGrowthBody = z.infer<typeof AdminIndividualClientGrowthBody>

export const AdminIndividualClientGrowthData = z.strictObject({
  batchId: Uuid,
  entryId: Uuid,
  userId: Uuid,
  fundId: Uuid,
  effectiveDate: AsOfDate,
  reasonCode: z.string(),
  beforePaise: SignedPaise,
  currentValuePaise: SignedPaise,
  deltaPaise: SignedPaise,
  growthPaise: SignedPaise,
  afterPaise: SignedPaise,
  newValuePaise: SignedPaise,
})
export type AdminIndividualClientGrowthData = z.infer<typeof AdminIndividualClientGrowthData>

export const appendAdminIndividualClientGrowth = defineOperation({
  operationId: "appendAdminIndividualClientGrowth",
  method: "POST",
  path: "/v1/admin/client-growth/individual",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminIndividualClientGrowthBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminIndividualClientGrowthData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

const CollectiveExplicitItem = z.strictObject({
  userId: Uuid,
  growthPaise: NonZeroSignedPaise,
})

export const AdminCollectiveClientGrowthPreviewBody = z
  .strictObject({
    fundId: Uuid,
    growthBasisPoints: z.coerce.number().int().min(-10_000).max(100_000).optional(),
    items: z.array(CollectiveExplicitItem).min(1).max(500).optional(),
  })
  .refine(
    (value) => (value.growthBasisPoints === undefined) !== (value.items === undefined),
    { message: "Provide exactly one of growthBasisPoints or items." },
  )
export type AdminCollectiveClientGrowthPreviewBody = z.infer<
  typeof AdminCollectiveClientGrowthPreviewBody
>

export const AdminClientGrowthMode = z.enum(["percentage", "explicit_deltas"])
export type AdminClientGrowthMode = z.infer<typeof AdminClientGrowthMode>

export const AdminCollectiveClientGrowthPreviewData = z.strictObject({
  fundId: Uuid,
  mode: AdminClientGrowthMode,
  basisHash: BasisHash,
  excludedCount: z.number().int(),
  targetCount: z.number().int(),
  totalDeltaPaise: SignedPaise,
  targets: z.array(AdminGrowthTarget),
  items: z.array(AdminGrowthTarget),
})
export type AdminCollectiveClientGrowthPreviewData = z.infer<
  typeof AdminCollectiveClientGrowthPreviewData
>

export const previewAdminCollectiveClientGrowth = defineOperation({
  operationId: "previewAdminCollectiveClientGrowth",
  method: "POST",
  path: "/v1/admin/client-growth/collective/preview",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: AdminCollectiveClientGrowthPreviewBody,
    headers: z.strictObject({ "x-csrf-token": z.string().min(1) }),
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(AdminCollectiveClientGrowthPreviewData),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const AdminCollectiveClientGrowthCommitBody = z
  .strictObject({
    fundId: Uuid,
    growthBasisPoints: z.coerce.number().int().min(-10_000).max(100_000).optional(),
    items: z.array(CollectiveExplicitItem).min(1).max(500).optional(),
    basisHash: BasisHash,
    effectiveDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminReasonDetail.optional(),
  })
  .refine(
    (value) => (value.growthBasisPoints === undefined) !== (value.items === undefined),
    { message: "Provide exactly one of growthBasisPoints or items." },
  )
export type AdminCollectiveClientGrowthCommitBody = z.infer<
  typeof AdminCollectiveClientGrowthCommitBody
>

export const AdminCollectiveClientGrowthCommitData = z.strictObject({
  batchId: Uuid,
  fundId: Uuid,
  mode: AdminClientGrowthMode,
  effectiveDate: AsOfDate,
  excludedCount: z.number().int(),
  targetCount: z.number().int(),
  totalDeltaPaise: SignedPaise,
  targets: z.array(AdminGrowthTarget),
  items: z.array(AdminGrowthTarget),
})
export type AdminCollectiveClientGrowthCommitData = z.infer<
  typeof AdminCollectiveClientGrowthCommitData
>

export const commitAdminCollectiveClientGrowth = defineOperation({
  operationId: "commitAdminCollectiveClientGrowth",
  method: "POST",
  path: "/v1/admin/client-growth/collective",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminCollectiveClientGrowthCommitBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: {
    status: 201,
    schema: createSuccessEnvelopeSchema(AdminCollectiveClientGrowthCommitData),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const AdminPaymentState = z.enum([
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
export type AdminPaymentState = z.infer<typeof AdminPaymentState>

export const AdminReceiptState = z.enum(["pending", "acknowledged"])
export type AdminReceiptState = z.infer<typeof AdminReceiptState>

export const AdminFundReceipt = z.strictObject({
  orderId: Uuid,
  client: z.strictObject({ id: Uuid, name: z.string(), email: z.string() }),
  amountPaise: Paise,
  currency: z.string(),
  selectedFund: z.strictObject({
    id: Uuid,
    name: z.string(),
    versionId: Uuid,
    state: z.enum(["draft", "published", "paused", "archived"]),
  }),
  payment: z.strictObject({
    id: Uuid,
    state: AdminPaymentState,
    provider: z.literal("phonepe"),
    merchantOrderId: z.string().nullable(),
    providerReference: z.string().nullable(),
    succeededAt: NullableIsoDateTime,
  }),
  acknowledgement: z.strictObject({
    id: Uuid,
    state: AdminReceiptState,
    acknowledgedAt: NullableIsoDateTime,
    privateNote: z.string().nullable(),
    version: z.number().int(),
  }),
  createdAt: IsoDateTime,
})
export type AdminFundReceipt = z.infer<typeof AdminFundReceipt>

export const listAdminFundReceipts = defineOperation({
  operationId: "listAdminFundReceipts",
  method: "GET",
  path: "/v1/admin/fund-receipts",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({
      state: AdminReceiptState.optional(),
      after: AdminCursor,
      limit: AdminLimit,
    }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminFundReceipt) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const getAdminFundReceipt = defineOperation({
  operationId: "getAdminFundReceipt",
  method: "GET",
  path: "/v1/admin/fund-receipts/{orderId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ orderId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminFundReceipt) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminAcknowledgeReceiptBody = z.strictObject({
  expectedVersion: z.coerce.number().int().min(1),
  privateNote: AdminReasonDetail.optional(),
})
export type AdminAcknowledgeReceiptBody = z.infer<typeof AdminAcknowledgeReceiptBody>

export const AdminAcknowledgeReceiptData = z.strictObject({
  orderId: Uuid,
  state: z.literal("acknowledged"),
  acknowledgedAt: IsoDateTime,
})
export type AdminAcknowledgeReceiptData = z.infer<typeof AdminAcknowledgeReceiptData>

export const acknowledgeAdminFundReceipt = defineOperation({
  operationId: "acknowledgeAdminFundReceipt",
  method: "POST",
  path: "/v1/admin/fund-receipts/{orderId}/acknowledge",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ orderId: Uuid }),
    body: AdminAcknowledgeReceiptBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminAcknowledgeReceiptData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminRefundState = z.enum(["pending", "provider_pending", "refunded", "failed"])
export type AdminRefundState = z.infer<typeof AdminRefundState>

export const AdminRefund = z.strictObject({
  id: Uuid,
  orderId: Uuid,
  paymentId: Uuid,
  merchantRefundId: z.string(),
  providerRefundId: z.string().nullable(),
  amountPaise: Paise,
  state: AdminRefundState,
  failureCode: z.string().nullable(),
  attemptCount: z.number().int(),
  client: z.strictObject({ name: z.string(), email: z.string() }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AdminRefund = z.infer<typeof AdminRefund>

export const listAdminRefunds = defineOperation({
  operationId: "listAdminRefunds",
  method: "GET",
  path: "/v1/admin/refunds",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({
      state: z.enum(["pending", "provider_pending", "refunded", "failed", "all"]).optional(),
      after: AdminCursor,
      limit: AdminLimit,
    }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminRefund) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const retryAdminRefund = defineOperation({
  operationId: "retryAdminRefund",
  method: "POST",
  path: "/v1/admin/refunds/{refundId}/retry",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ refundId: Uuid }),
    headers: RequiredAdminMutationHeaders,
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ refundId: Uuid, state: z.literal("pending") }),
    ),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const reconcileAdminRefund = defineOperation({
  operationId: "reconcileAdminRefund",
  method: "POST",
  path: "/v1/admin/refunds/{refundId}/reconcile",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ refundId: Uuid }),
    headers: RequiredAdminMutationHeaders,
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({
        refundId: Uuid,
        state: z.enum(["refunded", "failed", "pending"]),
      }),
    ),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminPayment = z.strictObject({
  id: Uuid,
  orderId: Uuid,
  userId: Uuid,
  userEmail: z.string(),
  amountPaise: Paise,
  status: AdminPaymentState,
  provider: z.string().nullable(),
  providerReference: z.string().nullable(),
  attemptCount: z.number().int(),
  succeededAt: NullableIsoDateTime,
  failedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
})
export type AdminPayment = z.infer<typeof AdminPayment>

export const listAdminPayments = defineOperation({
  operationId: "listAdminPayments",
  method: "GET",
  path: "/v1/admin/payments",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: z.strictObject({ after: AdminCursor, limit: AdminLimit }) },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminPayment) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminMandateState = z.enum([
  "setup_pending",
  "active",
  "pause_pending",
  "paused",
  "cancel_pending",
  "cancelled",
  "revoke_pending",
  "revoked",
  "expired",
  "failed",
])
export type AdminMandateState = z.infer<typeof AdminMandateState>

const AdminSipState = z.enum([
  "draft",
  "pending_mandate",
  "active",
  "paused",
  "cancel_pending",
  "cancelled",
  "completed",
  "setup_failed",
  "mandate_failed",
  "expired",
  "revoked",
])

const AdminMandateSetupState = z.enum([
  "created",
  "dispatching",
  "provider_pending",
  "authorized",
  "failed",
  "expired",
])

const AdminMandateNotifyState = z.enum(["created", "dispatching", "notified", "failed"])

const AdminMandateCancelState = z.enum([
  "queued",
  "dispatching",
  "accepted",
  "rejected",
  "reconciliation_required",
])

export const AdminMandateListItem = z.strictObject({
  mandateId: Uuid,
  sipPlanId: Uuid,
  userId: Uuid,
  userEmail: z.string(),
  userName: z.string(),
  fundId: Uuid,
  fundName: z.string().nullable(),
  amountPaise: z.number(),
  debitDay: z.number().int(),
  sipState: AdminSipState,
  mandateState: AdminMandateState,
  setupState: AdminMandateSetupState.nullable(),
  collectionState: AdminMandateNotifyState.nullable(),
  cancelState: AdminMandateCancelState.nullable(),
  latestDuePeriod: z.string().nullable(),
  attentionReason: z.string().nullable(),
  lastStatusCheckedAt: NullableIsoDateTime,
  updatedAt: IsoDateTime,
})
export type AdminMandateListItem = z.infer<typeof AdminMandateListItem>

export const listAdminMandates = defineOperation({
  operationId: "listAdminMandates",
  method: "GET",
  path: "/v1/admin/mandates",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({
      limit: AdminLimit,
      state: AdminMandateState.optional(),
      attention: z.enum(["true", "false"]).optional(),
      after: AdminCursor,
    }),
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminMandateListItem) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminMandateDetailData = z.strictObject({
  mandate: z.strictObject({
    mandateId: Uuid,
    sipPlanId: Uuid,
    userId: Uuid,
    fundId: Uuid,
    amountPaise: z.number(),
    state: AdminMandateState,
    merchantSubscriptionId: z.string(),
    providerSubscriptionId: z.string().nullable(),
    failureCode: z.string().nullable(),
    lastStatusCheckedAt: NullableIsoDateTime,
    updatedAt: IsoDateTime,
  }),
  user: z.strictObject({
    id: Uuid,
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  fund: z.strictObject({ id: Uuid, name: z.string().nullable() }),
  sip: z.strictObject({
    id: Uuid,
    state: AdminSipState,
    collectionMode: z.enum(["manual_checkout", "phonepe_autopay"]),
    debitDay: z.number().int(),
  }),
  setupAttempts: z.array(
    z.strictObject({
      setupAttemptId: Uuid,
      state: AdminMandateSetupState,
      orderId: Uuid.nullable(),
      paymentId: Uuid.nullable(),
      paymentAttemptId: Uuid.nullable(),
      providerOrderId: z.string().nullable(),
      failureCode: z.string().nullable(),
      expiresAt: IsoDateTime,
      lastStatusCheckedAt: NullableIsoDateTime,
      updatedAt: IsoDateTime,
    }),
  ),
  collectionAttempts: z.array(
    z.strictObject({
      collectionId: Uuid,
      duePeriod: AsOfDate,
      amountPaise: z.number(),
      notifyState: AdminMandateNotifyState,
      paymentState: z.null(),
      orderId: Uuid,
      paymentId: Uuid,
      paymentAttemptId: Uuid,
      scheduledDebitAt: IsoDateTime,
      notifiedAt: NullableIsoDateTime,
      failureCode: z.string().nullable(),
      updatedAt: IsoDateTime,
    }),
  ),
  cancelCommands: z.array(
    z.strictObject({
      commandId: Uuid,
      state: AdminMandateCancelState,
      failureCode: z.string().nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    }),
  ),
})
export type AdminMandateDetailData = z.infer<typeof AdminMandateDetailData>

export const getAdminMandate = defineOperation({
  operationId: "getAdminMandate",
  method: "GET",
  path: "/v1/admin/mandates/{mandateId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ mandateId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMandateDetailData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminMandateReasonBody = z.strictObject({ reason: AdminReasonDetail })
export type AdminMandateReasonBody = z.infer<typeof AdminMandateReasonBody>

export const reconcileAdminMandate = defineOperation({
  operationId: "reconcileAdminMandate",
  method: "POST",
  path: "/v1/admin/mandates/{mandateId}/reconcile",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ mandateId: Uuid }),
    body: AdminMandateReasonBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminMandateDetailData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const cancelAdminMandate = defineOperation({
  operationId: "cancelAdminMandate",
  method: "POST",
  path: "/v1/admin/mandates/{mandateId}/cancel",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ mandateId: Uuid }),
    body: AdminMandateReasonBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ commandId: Uuid, state: AdminMandateCancelState }),
    ),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const reconcileAdminMandateCollection = defineOperation({
  operationId: "reconcileAdminMandateCollection",
  method: "POST",
  path: "/v1/admin/mandate-collections/{collectionId}/reconcile",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ collectionId: Uuid }),
    body: AdminMandateReasonBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({
        collectionId: Uuid,
        mandateId: Uuid,
        state: AdminMandateNotifyState,
        paymentState: z.enum(["succeeded", "failed"]).nullable(),
        providerState: z.string(),
      }),
    ),
  },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ADMIN_MONEY_OPERATIONS = Object.freeze([
  appendAdminIndividualClientGrowth,
  previewAdminCollectiveClientGrowth,
  commitAdminCollectiveClientGrowth,
  listAdminFundReceipts,
  getAdminFundReceipt,
  acknowledgeAdminFundReceipt,
  listAdminRefunds,
  retryAdminRefund,
  reconcileAdminRefund,
  listAdminPayments,
  listAdminMandates,
  getAdminMandate,
  reconcileAdminMandate,
  cancelAdminMandate,
  reconcileAdminMandateCollection,
])
