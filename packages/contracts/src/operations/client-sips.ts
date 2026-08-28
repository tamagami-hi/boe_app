import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Paise, Uuid } from "../scalars.js"
import { HostedCheckout } from "./client-orders.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullableIsoDateTime = IsoDateTime.nullable()

export const MAX_AUTOPAY_AMOUNT_PAISE = 1_500_000
export const MAX_AUTOPAY_DURATION_MONTHS = 360
export const MAX_MANUAL_DURATION_MONTHS = 600
export const MIN_DEBIT_DAY = 1
export const MAX_DEBIT_DAY = 28

export const SipState = z.enum([
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
export type SipState = z.infer<typeof SipState>

export const MandateState = z.enum([
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
export type MandateState = z.infer<typeof MandateState>

export const MandateSetupState = z.enum([
  "created",
  "dispatching",
  "provider_pending",
  "authorized",
  "failed",
  "expired",
])
export type MandateSetupState = z.infer<typeof MandateSetupState>

export const MandateCancelCommandState = z.enum([
  "queued",
  "dispatching",
  "accepted",
  "rejected",
  "reconciliation_required",
])
export type MandateCancelCommandState = z.infer<typeof MandateCancelCommandState>

export const SipPlanSummary = z.strictObject({
  sipId: Uuid,
  fundId: Uuid,
  status: SipState,
  amountPaise: Paise,
  debitDay: z.number().int().min(MIN_DEBIT_DAY).max(MAX_DEBIT_DAY),
  durationMonths: z.number().int().nullable(),
  nextDueDate: NullableIsoDateTime,
  startDate: NullableIsoDateTime,
  pausedAt: NullableIsoDateTime,
  cancelledAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
})
export type SipPlanSummary = z.infer<typeof SipPlanSummary>

const SIP_READ_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "INTERNAL_ERROR",
] as const

const SIP_TRANSITION_ERRORS = [
  ...SIP_READ_ERRORS,
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "STATE_CONFLICT",
] as const

export const CreateSipBody = z.strictObject({
  fundId: Uuid,
  amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
  debitDay: z.number().int().min(MIN_DEBIT_DAY).max(MAX_DEBIT_DAY).optional(),
  durationMonths: z.number().int().min(1).max(MAX_MANUAL_DURATION_MONTHS).optional(),
})
export type CreateSipBody = z.infer<typeof CreateSipBody>

export const createClientSip = defineOperation({
  operationId: "createClientSip",
  method: "POST",
  path: "/v1/client/sips",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: CreateSipBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(SipPlanSummary) },
  errorCodes: [...SIP_TRANSITION_ERRORS],
})

export const listClientSips = defineOperation({
  operationId: "listClientSips",
  method: "GET",
  path: "/v1/client/sips",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(SipPlanSummary) })),
  },
  errorCodes: [...SIP_READ_ERRORS],
})

const sipTransition = (operationId: string, segment: string) =>
  defineOperation({
    operationId,
    method: "POST",
    path: `/v1/client/sips/{sipPlanId}/${segment}`,
    authChannel: "native-bearer",
    credentialPolicy: "native-bearer",
    idempotency: "naturally-idempotent",
    responseCacheControl: "no-store",
    request: { params: z.strictObject({ sipPlanId: Uuid }) },
    success: { status: 200, schema: createSuccessEnvelopeSchema(SipPlanSummary) },
    errorCodes: [...SIP_TRANSITION_ERRORS],
  })

export const pauseClientSip = sipTransition("pauseClientSip", "pause")
export const resumeClientSip = sipTransition("resumeClientSip", "resume")
export const cancelClientSip = sipTransition("cancelClientSip", "cancel")

export const CreateAutoPayBody = z.strictObject({
  fundId: Uuid,
  amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
  debitDay: z.number().int().min(MIN_DEBIT_DAY).max(MAX_DEBIT_DAY),
  durationMonths: z.number().int().min(1).max(MAX_AUTOPAY_DURATION_MONTHS),
})
export type CreateAutoPayBody = z.infer<typeof CreateAutoPayBody>

export const AutoPaySetupCheckoutData = z.strictObject({
  sipPlanId: Uuid,
  mandateId: Uuid,
  orderId: Uuid,
  paymentId: Uuid,
  status: z.literal("mandate_setup_in_progress"),
  checkout: HostedCheckout.nullable(),
})
export type AutoPaySetupCheckoutData = z.infer<typeof AutoPaySetupCheckoutData>

const AUTOPAY_WRITE_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "VALIDATION_FAILED",
  "DEPENDENCY_UNAVAILABLE",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "STATE_CONFLICT",
  "INTERNAL_ERROR",
] as const

export const startAutoPaySip = defineOperation({
  operationId: "startAutoPaySip",
  method: "POST",
  path: "/v1/client/sip-autopay",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: {
    body: CreateAutoPayBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AutoPaySetupCheckoutData) },
  errorCodes: [...AUTOPAY_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AutoPayDetailData = z.strictObject({
  sipPlanId: Uuid,
  fundId: Uuid,
  amountPaise: Paise,
  debitDay: z.number().int().min(MIN_DEBIT_DAY).max(MAX_DEBIT_DAY),
  durationMonths: z.number().int().nullable(),
  status: SipState,
  canRetrySetup: z.boolean(),
  setup: z
    .strictObject({
      setupAttemptId: Uuid,
      status: MandateSetupState,
      failureCode: z.string().nullable(),
      expiresAt: IsoDateTime,
    })
    .nullable(),
  cancellation: z
    .strictObject({
      status: MandateCancelCommandState,
      failureCode: z.string().nullable(),
    })
    .nullable(),
  mandate: z.strictObject({
    mandateId: Uuid,
    status: MandateState,
    authorizedAt: NullableIsoDateTime,
    cancellationRequestedAt: NullableIsoDateTime,
  }),
})
export type AutoPayDetailData = z.infer<typeof AutoPayDetailData>

export const getAutoPaySip = defineOperation({
  operationId: "getAutoPaySip",
  method: "GET",
  path: "/v1/client/sip-autopay/{sipPlanId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ sipPlanId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AutoPayDetailData) },
  errorCodes: [...SIP_READ_ERRORS, "VALIDATION_FAILED", "RESOURCE_NOT_FOUND"],
})

export const AutoPayCancelData = z.strictObject({
  mandateId: Uuid,
  status: z.enum(["cancelled", "cancel_pending"]),
})
export type AutoPayCancelData = z.infer<typeof AutoPayCancelData>

export const cancelAutoPaySip = defineOperation({
  operationId: "cancelAutoPaySip",
  method: "POST",
  path: "/v1/client/sip-autopay/{sipPlanId}/cancel",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ sipPlanId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AutoPayCancelData) },
  errorCodes: [...AUTOPAY_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const retryAutoPaySetup = defineOperation({
  operationId: "retryAutoPaySetup",
  method: "POST",
  path: "/v1/client/sip-autopay/{sipPlanId}/setup/retry",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ sipPlanId: Uuid }) },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AutoPaySetupCheckoutData) },
  errorCodes: [...AUTOPAY_WRITE_ERRORS],
})

export const CLIENT_SIP_OPERATIONS = Object.freeze([
  createClientSip,
  listClientSips,
  pauseClientSip,
  resumeClientSip,
  cancelClientSip,
  startAutoPaySip,
  getAutoPaySip,
  cancelAutoPaySip,
  retryAutoPaySetup,
])
