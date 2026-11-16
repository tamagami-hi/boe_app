import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { ClientNomineeRequest, NomineeRequestState } from "./client-nominee-requests.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { NOMINEE_LETTER_OR_NUMBER, NOMINEE_VISIBLE_TEXT, NomineeData, NomineeVersion } from "./nominee.js"

export const MAX_NOMINEE_DECLINE_REASON_LENGTH = 500

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u

export const NomineeDeclineReason = z
  .string()
  .trim()
  .refine((value) => {
    const length = [...value].length
    return length >= 1 && length <= MAX_NOMINEE_DECLINE_REASON_LENGTH
  })
  .refine((value) => !CONTROL_CHARACTERS.test(value))
  .regex(NOMINEE_VISIBLE_TEXT)
  .regex(NOMINEE_LETTER_OR_NUMBER)
export type NomineeDeclineReason = z.infer<typeof NomineeDeclineReason>

export const AdminNomineeRequest = ClientNomineeRequest.extend({
  userId: Uuid,
  clientName: z.string(),
  decidedByName: z.string().nullable(),
})
export type AdminNomineeRequest = z.infer<typeof AdminNomineeRequest>

const AdminNomineeRequestPage = createSuccessEnvelopeSchema(
  z.strictObject({ items: z.array(AdminNomineeRequest) }),
  { page: AdminPageMeta },
)

export const AdminNomineeRequestSummary = z.strictObject({
  pendingCount: z.number().int().nonnegative(),
  oldestPendingAt: IsoDateTime.nullable(),
})
export type AdminNomineeRequestSummary = z.infer<typeof AdminNomineeRequestSummary>

export const AdminNomineeDecisionData = z.strictObject({ request: AdminNomineeRequest, nominee: NomineeData })
export type AdminNomineeDecisionData = z.infer<typeof AdminNomineeDecisionData>

export const AcceptNomineeRequestBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  expectedNomineeVersion: NomineeVersion,
})
export type AcceptNomineeRequestBody = z.infer<typeof AcceptNomineeRequestBody>

export const DeclineNomineeRequestBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: NomineeDeclineReason.nullable(),
})
export type DeclineNomineeRequestBody = z.infer<typeof DeclineNomineeRequestBody>

const RequestParams = z.strictObject({ requestId: Uuid })

export const listAdminNomineeRequests = defineOperation({
  operationId: "listAdminNomineeRequests",
  method: "GET",
  path: "/v1/admin/nominee-requests",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({ after: AdminCursor, limit: AdminLimit, state: NomineeRequestState.optional() }),
  },
  success: { status: 200, schema: AdminNomineeRequestPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const getAdminNomineeRequestSummary = defineOperation({
  operationId: "getAdminNomineeRequestSummary",
  method: "GET",
  path: "/v1/admin/overview/nominee-requests",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminNomineeRequestSummary) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const listAdminUserNomineeRequests = defineOperation({
  operationId: "listAdminUserNomineeRequests",
  method: "GET",
  path: "/v1/admin/users/{userId}/nominee-requests",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }), query: z.strictObject({ after: AdminCursor, limit: AdminLimit }) },
  success: { status: 200, schema: AdminNomineeRequestPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const acceptAdminNomineeRequest = defineOperation({
  operationId: "acceptAdminNomineeRequest",
  method: "POST",
  path: "/v1/admin/nominee-requests/{requestId}/accept",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: RequestParams,
    body: AcceptNomineeRequestBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminNomineeDecisionData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const declineAdminNomineeRequest = defineOperation({
  operationId: "declineAdminNomineeRequest",
  method: "POST",
  path: "/v1/admin/nominee-requests/{requestId}/decline",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: RequestParams,
    body: DeclineNomineeRequestBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminNomineeDecisionData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ADMIN_NOMINEE_REQUEST_OPERATIONS = Object.freeze([
  listAdminNomineeRequests,
  getAdminNomineeRequestSummary,
  listAdminUserNomineeRequests,
  acceptAdminNomineeRequest,
  declineAdminNomineeRequest,
])
