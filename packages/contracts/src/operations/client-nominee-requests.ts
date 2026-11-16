import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, PasswordInput, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"
import { Nominee, NomineeName, NomineeRelation } from "./nominee.js"

export const NomineeRequestState = z.enum(["pending", "accepted", "declined", "withdrawn"])
export type NomineeRequestState = z.infer<typeof NomineeRequestState>

export const ClientNomineeRequest = z.strictObject({
  id: Uuid,
  nominee: Nominee,
  state: NomineeRequestState,
  declineReason: z.string().nullable(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  version: z.number().int().positive(),
})
export type ClientNomineeRequest = z.infer<typeof ClientNomineeRequest>

export const ClientNomineeRequestData = z.strictObject({ request: ClientNomineeRequest })
export type ClientNomineeRequestData = z.infer<typeof ClientNomineeRequestData>

export const LatestClientNomineeRequestData = z.strictObject({ request: ClientNomineeRequest.nullable() })
export type LatestClientNomineeRequestData = z.infer<typeof LatestClientNomineeRequestData>

export const SendClientNomineeRequestBody = z.strictObject({
  name: NomineeName,
  relation: NomineeRelation,
  currentPassword: PasswordInput,
})
export type SendClientNomineeRequestBody = z.infer<typeof SendClientNomineeRequestBody>

export const WithdrawClientNomineeRequestBody = z.strictObject({ expectedVersion: z.number().int().positive() })
export type WithdrawClientNomineeRequestBody = z.infer<typeof WithdrawClientNomineeRequestBody>

const CLIENT_AUTH_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "CSRF_INVALID",
  "INTERNAL_ERROR",
] as const

const CLIENT_WRITE_ERRORS = [
  ...CLIENT_AUTH_ERRORS,
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "RESOURCE_NOT_FOUND",
  "STATE_CONFLICT",
] as const

export const getLatestClientNomineeRequest = defineOperation({
  operationId: "getLatestClientNomineeRequest",
  method: "GET",
  path: "/v1/client/nominee-requests/latest",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(LatestClientNomineeRequestData) },
  errorCodes: [...CLIENT_AUTH_ERRORS],
})

export const sendClientNomineeRequest = defineOperation({
  operationId: "sendClientNomineeRequest",
  method: "POST",
  path: "/v1/client/nominee-requests",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: { body: SendClientNomineeRequestBody, mediaType: "application/json", maxBodyBytes: MAX_JSON_BODY_BYTES },
  success: { status: 201, schema: createSuccessEnvelopeSchema(ClientNomineeRequestData) },
  errorCodes: [...CLIENT_WRITE_ERRORS, "INVALID_CREDENTIALS", "RATE_LIMITED"],
})

export const withdrawClientNomineeRequest = defineOperation({
  operationId: "withdrawClientNomineeRequest",
  method: "POST",
  path: "/v1/client/nominee-requests/{requestId}/withdraw",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: {
    params: z.strictObject({ requestId: Uuid }),
    body: WithdrawClientNomineeRequestBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientNomineeRequestData) },
  errorCodes: [...CLIENT_WRITE_ERRORS],
})

export const CLIENT_NOMINEE_REQUEST_OPERATIONS = Object.freeze([
  getLatestClientNomineeRequest,
  sendClientNomineeRequest,
  withdrawClientNomineeRequest,
])
