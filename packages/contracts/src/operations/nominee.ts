import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { FullName, PasswordInput, Uuid } from "../scalars.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const VISIBLE_TEXT = /^(?!\u200C|\u200D)(?:[^\p{Cf}\p{Zl}\p{Zp}]|\u200C|\u200D)*(?<!\u200C|\u200D)$/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

export const NomineeText = FullName.regex(VISIBLE_TEXT).regex(LETTER_OR_NUMBER)
export type NomineeText = z.infer<typeof NomineeText>

export const NomineeName = NomineeText
export type NomineeName = z.infer<typeof NomineeName>

export const NomineeRelation = NomineeText
export type NomineeRelation = z.infer<typeof NomineeRelation>

const NomineeVersion = z.number().int().nonnegative()

export const Nominee = z.strictObject({ name: NomineeName, relation: NomineeRelation })
export type Nominee = z.infer<typeof Nominee>

export const NomineeData = z.strictObject({
  userId: Uuid,
  nominee: Nominee.nullable(),
  version: NomineeVersion,
})
export type NomineeData = z.infer<typeof NomineeData>

export const NomineeChangeData = NomineeData.extend({ status: z.enum(["changed", "unchanged"]) })
export type NomineeChangeData = z.infer<typeof NomineeChangeData>

export const ClientNomineeBody = z.union([
  z.strictObject({ name: NomineeName, relation: NomineeRelation, currentPassword: PasswordInput }),
  z.strictObject({ name: z.null(), relation: z.null(), currentPassword: PasswordInput }),
])
export type ClientNomineeBody = z.infer<typeof ClientNomineeBody>

export const AdminNomineeBody = z.union([
  z.strictObject({ name: NomineeName, relation: NomineeRelation, expectedVersion: NomineeVersion }),
  z.strictObject({ name: z.null(), relation: z.null(), expectedVersion: NomineeVersion }),
])
export type AdminNomineeBody = z.infer<typeof AdminNomineeBody>

export const getClientNominee = defineOperation({
  operationId: "getClientNominee",
  method: "GET",
  path: "/v1/client/profile/nominee",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(NomineeData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "RESOURCE_NOT_FOUND",
    "INTERNAL_ERROR",
  ],
})

export const changeClientNominee = defineOperation({
  operationId: "changeClientNominee",
  method: "POST",
  path: "/v1/client/profile/nominee",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: { body: ClientNomineeBody, mediaType: "application/json", maxBodyBytes: MAX_JSON_BODY_BYTES },
  success: { status: 200, schema: createSuccessEnvelopeSchema(NomineeChangeData) },
  errorCodes: [
    "VALIDATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "INVALID_CREDENTIALS",
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ],
})

export const getAdminUserNominee = defineOperation({
  operationId: "getAdminUserNominee",
  method: "GET",
  path: "/v1/admin/users/{userId}/nominee",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(NomineeData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const changeAdminUserNominee = defineOperation({
  operationId: "changeAdminUserNominee",
  method: "POST",
  path: "/v1/admin/users/{userId}/nominee",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid }),
    body: AdminNomineeBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(NomineeChangeData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const NOMINEE_OPERATIONS = Object.freeze([
  getClientNominee,
  changeClientNominee,
  getAdminUserNominee,
  changeAdminUserNominee,
])
