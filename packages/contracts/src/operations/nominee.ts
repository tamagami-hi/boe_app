import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { FullName, Uuid } from "../scalars.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const NomineeName = FullName
export type NomineeName = z.infer<typeof NomineeName>

export const NomineeRelation = FullName
export type NomineeRelation = z.infer<typeof NomineeRelation>

const ExpectedUserVersion = z.number().int().positive()

export const Nominee = z.strictObject({ name: z.string(), relation: z.string() })
export type Nominee = z.infer<typeof Nominee>

export const NomineeData = z.strictObject({
  userId: Uuid,
  nominee: Nominee.nullable(),
  version: z.number().int().positive(),
})
export type NomineeData = z.infer<typeof NomineeData>

export const NomineeChangeData = NomineeData.extend({ status: z.enum(["changed", "unchanged"]) })
export type NomineeChangeData = z.infer<typeof NomineeChangeData>

export const ClientNomineeBody = z.union([
  z.strictObject({ name: NomineeName, relation: NomineeRelation }),
  z.strictObject({ name: z.null(), relation: z.null() }),
])
export type ClientNomineeBody = z.infer<typeof ClientNomineeBody>

export const AdminNomineeBody = z.union([
  z.strictObject({ name: NomineeName, relation: NomineeRelation, expectedVersion: ExpectedUserVersion }),
  z.strictObject({ name: z.null(), relation: z.null(), expectedVersion: ExpectedUserVersion }),
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
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "RESOURCE_NOT_FOUND", "INTERNAL_ERROR"],
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
    "STATE_CONFLICT",
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
