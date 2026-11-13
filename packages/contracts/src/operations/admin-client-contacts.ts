import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, IsoDateTime, Uuid } from "../scalars.js"
import {
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminReasonCode,
  AdminReasonDetail,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { AdminQueuedPasswordLink } from "./admin-oversight.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const ExpectedUserVersion = z.number().int().positive()

export const AdminClientContactCorrectionBody = z
  .strictObject({
    email: EmailInput.optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    expectedVersion: ExpectedUserVersion,
  })
  .refine((body) => body.email !== undefined || body.phone !== undefined, {
    message: "must include an email or a phone",
    path: ["email"],
  })
export type AdminClientContactCorrectionBody = z.infer<typeof AdminClientContactCorrectionBody>

export const AdminClientContactCorrectionData = z.strictObject({
  userId: Uuid,
  email: z.string(),
  phone: z.string(),
  version: z.number().int(),
  emailChanged: z.boolean(),
  phoneChanged: z.boolean(),
  passwordLink: AdminQueuedPasswordLink.nullable(),
})
export type AdminClientContactCorrectionData = z.infer<typeof AdminClientContactCorrectionData>

export const correctAdminClientContacts = defineOperation({
  operationId: "correctAdminClientContacts",
  method: "POST",
  path: "/v1/admin/clients/{userId}/contact-correction",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid }),
    body: AdminClientContactCorrectionBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientContactCorrectionData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminUserContactReleaseBody = z.strictObject({
  expectedVersion: ExpectedUserVersion,
  reasonCode: AdminReasonCode.optional(),
  reason: AdminReasonDetail.optional(),
})
export type AdminUserContactReleaseBody = z.infer<typeof AdminUserContactReleaseBody>

export const AdminUserContactReleaseData = z.strictObject({
  userId: Uuid,
  version: z.number().int(),
  releasedAt: IsoDateTime,
})
export type AdminUserContactReleaseData = z.infer<typeof AdminUserContactReleaseData>

export const releaseAdminUserContacts = defineOperation({
  operationId: "releaseAdminUserContacts",
  method: "POST",
  path: "/v1/admin/users/{userId}/contact-release",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: z.strictObject({ userId: Uuid }),
    body: AdminUserContactReleaseBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminUserContactReleaseData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminContactChangeKind = z.enum(["admin_correction", "closed_release"])
export type AdminContactChangeKind = z.infer<typeof AdminContactChangeKind>

export const AdminContactHistoryEntry = z.strictObject({
  id: Uuid,
  kind: AdminContactChangeKind,
  previousEmail: z.string(),
  previousPhone: z.string(),
  newEmail: z.string(),
  newPhone: z.string(),
  actorUserId: Uuid,
  actorName: z.string().nullable(),
  reasonCode: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: IsoDateTime,
})
export type AdminContactHistoryEntry = z.infer<typeof AdminContactHistoryEntry>

export const AdminUserContactHistoryData = z.strictObject({
  userId: Uuid,
  contactsReleasedAt: IsoDateTime.nullable(),
  entries: z.array(AdminContactHistoryEntry),
})
export type AdminUserContactHistoryData = z.infer<typeof AdminUserContactHistoryData>

export const getAdminUserContactHistory = defineOperation({
  operationId: "getAdminUserContactHistory",
  method: "GET",
  path: "/v1/admin/users/{userId}/contact-history",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminUserContactHistoryData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ADMIN_CLIENT_CONTACT_OPERATIONS = Object.freeze([
  correctAdminClientContacts,
  releaseAdminUserContacts,
  getAdminUserContactHistory,
])
