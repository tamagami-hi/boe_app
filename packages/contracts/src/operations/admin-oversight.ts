import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminListQuery,
  AdminPageMeta,
  AdminReasonCode,
  AdminReasonDetail,
  OptionalAdminMutationHeaders,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullableIsoDateTime = IsoDateTime.nullable()

export const AdminApplicationState = z.enum(["submitted", "approved", "rejected", "withdrawn"])
export type AdminApplicationState = z.infer<typeof AdminApplicationState>

export const AdminApplication = z.strictObject({
  applicationId: Uuid,
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  isPiiTombstoned: z.boolean(),
  status: AdminApplicationState,
  hasSignupPassword: z.boolean(),
  createdAt: IsoDateTime,
  version: z.number().int(),
})
export type AdminApplication = z.infer<typeof AdminApplication>

export const AdminApplicationQueueQuery = z.strictObject({
  status: AdminApplicationState.optional(),
  createdFrom: IsoDateTime.optional(),
  createdTo: IsoDateTime.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})

export const listAdminApplications = defineOperation({
  operationId: "listAdminApplications",
  method: "GET",
  path: "/v1/admin/applications",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminApplicationQueueQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminApplication) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminEmailDeliveryState = z.enum([
  "queued",
  "sending",
  "sent",
  "delivered",
  "retryable_failed",
  "permanent_failed",
  "cancelled",
])
export type AdminEmailDeliveryState = z.infer<typeof AdminEmailDeliveryState>

export const AdminEmailTemplateKey = z.enum(["application_rejected", "account_approved"])
export type AdminEmailTemplateKey = z.infer<typeof AdminEmailTemplateKey>

export const AdminEmailDelivery = z.looseObject({
  emailDeliveryId: Uuid,
  templateKey: z.string(),
  recipientMasked: z.string(),
  state: AdminEmailDeliveryState,
  attemptCount: z.number().int(),
  lastErrorCode: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  outboxEventId: Uuid.optional(),
  applicationId: Uuid.nullable().optional(),
  userId: Uuid.nullable().optional(),
  templateVersion: z.union([z.string(), z.number()]).optional(),
  sesConfigurationSet: z.string().nullable().optional(),
  sesMessageId: z.string().nullable().optional(),
  sesRequestId: z.string().nullable().optional(),
})
export type AdminEmailDelivery = z.infer<typeof AdminEmailDelivery>

export const AdminApplicationConsent = z.strictObject({
  kind: z.enum(["terms", "privacy"]),
  version: z.string(),
  acceptedAt: IsoDateTime,
})

export const AdminApplicationReview = z.strictObject({
  reviewId: Uuid,
  decision: z.enum(["approved", "rejected"]),
  reasonCode: z.string(),
  reasonDetail: z.string().nullable(),
  reviewerUserId: Uuid,
  decidedAt: IsoDateTime,
})

export const AdminApplicationDetailData = z.strictObject({
  application: AdminApplication,
  consents: z.array(AdminApplicationConsent),
  reviews: z.array(AdminApplicationReview),
  deliveries: z.strictObject({
    items: z.array(AdminEmailDelivery),
    page: AdminPageMeta,
  }),
})
export type AdminApplicationDetailData = z.infer<typeof AdminApplicationDetailData>

export const getAdminApplication = defineOperation({
  operationId: "getAdminApplication",
  method: "GET",
  path: "/v1/admin/applications/{applicationId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    params: z.strictObject({ applicationId: Uuid }),
    query: z.strictObject({ deliveryAfter: AdminCursor, deliveryLimit: AdminLimit }),
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminApplicationDetailData) },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminApplicationDecisionData = z.looseObject({
  applicationId: Uuid,
  status: AdminApplicationState,
  version: z.number().int(),
  userId: Uuid.optional(),
  accountActivated: z.boolean(),
  emailDeliveryId: Uuid,
  decidedAt: IsoDateTime,
})
export type AdminApplicationDecisionData = z.infer<typeof AdminApplicationDecisionData>

export const decideAdminApplication = defineOperation({
  operationId: "decideAdminApplication",
  method: "POST",
  path: "/v1/admin/applications/{applicationId}/decision",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ applicationId: Uuid }),
    query: z.strictObject({ outcome: z.enum(["approved", "rejected"]) }),
    body: z.strictObject({}),
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminApplicationDecisionData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminEmailDeliveryQuery = z.strictObject({
  state: AdminEmailDeliveryState.optional(),
  templateKey: AdminEmailTemplateKey.optional(),
  applicationId: Uuid.optional(),
  userId: Uuid.optional(),
  after: AdminCursor,
  limit: AdminLimit,
})

export const listAdminEmailDeliveries = defineOperation({
  operationId: "listAdminEmailDeliveries",
  method: "GET",
  path: "/v1/admin/email-deliveries",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminEmailDeliveryQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(
      z.strictObject({ items: z.array(AdminEmailDelivery) }),
      { page: AdminPageMeta },
    ),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminUserAccountState = z.enum(["invited", "active", "suspended", "closed"])
export type AdminUserAccountState = z.infer<typeof AdminUserAccountState>

export const AdminEmailVerificationState = z.enum(["not_started", "pending", "verified"])

export const AdminUser = z.strictObject({
  id: Uuid,
  name: z.string(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  status: AdminUserAccountState,
  accountState: AdminUserAccountState,
  isPiiTombstoned: z.boolean(),
  emailVerificationStatus: AdminEmailVerificationState.nullable(),
  ordersCount: z.number().int(),
  activatedAt: NullableIsoDateTime,
  suspendedAt: NullableIsoDateTime,
  closedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int(),
})
export type AdminUser = z.infer<typeof AdminUser>

export const AdminUserDirectoryQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
  status: AdminUserAccountState.optional(),
  q: z.string().trim().min(1).max(120).optional(),
})

export const listAdminUsers = defineOperation({
  operationId: "listAdminUsers",
  method: "GET",
  path: "/v1/admin/users",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminUserDirectoryQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(AdminUser) }), {
      page: AdminPageMeta,
    }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminOrderState = z.enum([
  "submitted",
  "payment_pending",
  "accepted",
  "refund_pending",
  "refunded",
  "refund_failed",
  "payment_failed",
  "cancelled",
])
export type AdminOrderState = z.infer<typeof AdminOrderState>

export const AdminUserOrder = z.strictObject({
  id: Uuid,
  userId: Uuid,
  userEmail: z.string(),
  fundId: Uuid,
  fundSlug: z.string(),
  fundName: z.string().nullable(),
  sipPlanId: Uuid.nullable(),
  type: z.enum(["lump_sum", "sip_installment"]),
  status: AdminOrderState,
  amountPaise: Paise,
  currency: z.string(),
  requestedAt: IsoDateTime,
  acceptedAt: NullableIsoDateTime,
  failureCode: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AdminUserOrder = z.infer<typeof AdminUserOrder>

export const AdminUserEmailVerification = z.strictObject({
  id: Uuid,
  userId: Uuid,
  userEmail: z.string(),
  name: z.string(),
  emailVerificationStatus: AdminEmailVerificationState,
  status: AdminEmailVerificationState,
  provider: z.string().nullable(),
  submittedAt: NullableIsoDateTime,
  emailVerifiedAt: NullableIsoDateTime,
  decidedAt: NullableIsoDateTime,
  reviewCount: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int(),
})

export const AdminUserDetailData = z.strictObject({
  user: AdminUser,
  roles: z.array(z.string()),
  emailVerification: AdminUserEmailVerification.nullable(),
  orders: z.array(AdminUserOrder),
})
export type AdminUserDetailData = z.infer<typeof AdminUserDetailData>

export const getAdminUser = defineOperation({
  operationId: "getAdminUser",
  method: "GET",
  path: "/v1/admin/users/{userId}/detail",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminUserDetailData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminLoginOutcome = z.enum([
  "success",
  "invalid_credentials",
  "unknown_identity",
  "account_not_active",
  "password_changed",
  "not_authorized",
])
export type AdminLoginOutcome = z.infer<typeof AdminLoginOutcome>

export const AdminLoginEvent = z.strictObject({
  id: Uuid,
  occurredAt: IsoDateTime,
  createdAt: IsoDateTime,
  userId: Uuid.nullable(),
  email: z.string(),
  channel: z.enum(["native", "web"]),
  outcome: AdminLoginOutcome,
  succeeded: z.boolean(),
  sessionId: Uuid.nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string(),
})
export type AdminLoginEvent = z.infer<typeof AdminLoginEvent>

export const listAdminUserLoginEvents = defineOperation({
  operationId: "listAdminUserLoginEvents",
  method: "GET",
  path: "/v1/admin/users/{userId}/login-events",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }), query: AdminListQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(AdminLoginEvent) }), {
      page: AdminPageMeta,
    }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminUserLifecycleBody = z.strictObject({
  reasonCode: AdminReasonCode.optional(),
  reason: AdminReasonDetail.optional(),
})
export type AdminUserLifecycleBody = z.infer<typeof AdminUserLifecycleBody>

export const AdminUserLifecycleData = z.strictObject({
  userId: Uuid,
  status: AdminUserAccountState,
  version: z.number().int(),
})
export type AdminUserLifecycleData = z.infer<typeof AdminUserLifecycleData>

const userLifecycle = (operationId: string, segment: string) =>
  defineOperation({
    operationId,
    method: "POST",
    path: `/v1/admin/users/{userId}/${segment}`,
    authChannel: "admin-web",
    credentialPolicy: "admin-session-cookie-and-csrf",
    idempotency: "optional-key",
    request: {
      params: z.strictObject({ userId: Uuid }),
      body: AdminUserLifecycleBody,
      headers: OptionalAdminMutationHeaders,
      mediaType: "application/json",
      maxBodyBytes: MAX_JSON_BODY_BYTES,
    },
    success: { status: 200, schema: createSuccessEnvelopeSchema(AdminUserLifecycleData) },
    errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
  })

export const suspendAdminUser = userLifecycle("suspendAdminUser", "suspend")
export const reinstateAdminUser = userLifecycle("reinstateAdminUser", "reinstate")
export const closeAdminUser = userLifecycle("closeAdminUser", "close")

export const AdminAuditEvent = z.strictObject({
  id: Uuid,
  occurredAt: IsoDateTime,
  createdAt: IsoDateTime,
  actorType: z.string(),
  actorUserId: Uuid.nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  command: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  reasonCode: z.string().nullable(),
  requestId: z.string(),
  entityVersion: z.number().int(),
  metadata: z.unknown(),
})
export type AdminAuditEvent = z.infer<typeof AdminAuditEvent>

export const AdminAuditQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
  entityType: z.string().trim().max(80).optional(),
  command: z.string().trim().max(120).optional(),
  actorUserId: Uuid.optional(),
  occurredFrom: IsoDateTime.optional(),
  occurredTo: IsoDateTime.optional(),
})

export const listAdminAuditEvents = defineOperation({
  operationId: "listAdminAuditEvents",
  method: "GET",
  path: "/v1/admin/audit-logs",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminAuditQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(AdminAuditEvent) }), {
      page: AdminPageMeta,
    }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const ADMIN_OVERSIGHT_OPERATIONS = Object.freeze([
  listAdminApplications,
  getAdminApplication,
  decideAdminApplication,
  listAdminEmailDeliveries,
  listAdminUsers,
  getAdminUser,
  listAdminUserLoginEvents,
  suspendAdminUser,
  reinstateAdminUser,
  closeAdminUser,
  listAdminAuditEvents,
])
