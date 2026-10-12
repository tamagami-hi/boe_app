import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import { ADMIN_READ_ERRORS, ADMIN_WRITE_ERRORS, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const AdminTemplatePlaceholder = z.enum(["first_name", "full_name"])

export const AdminEmailTemplate = z.strictObject({
  templateId: Uuid,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  preloaded: z.boolean(),
  archivedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
  version: z.number().int().positive(),
  currentRevision: z.number().int().positive(),
  subject: z.string(),
  body: z.string(),
})
export type AdminEmailTemplate = z.infer<typeof AdminEmailTemplate>

export const AdminEmailTemplateRevision = z.strictObject({
  revision: z.number().int().positive(),
  subject: z.string(),
  body: z.string(),
  createdAt: IsoDateTime,
})

export const AdminEmailTemplateListData = z.strictObject({
  items: z.array(AdminEmailTemplate),
  placeholders: z.array(AdminTemplatePlaceholder),
})

export const AdminEmailTemplateDetailData = AdminEmailTemplate.extend({
  revisions: z.array(AdminEmailTemplateRevision),
  placeholders: z.array(AdminTemplatePlaceholder),
})

const TemplateId = z.strictObject({ templateId: Uuid })

const writeRequest = <TBody extends z.ZodType>(body: TBody, params?: typeof TemplateId) => ({
  ...(params === undefined ? {} : { params }),
  body,
  headers: RequiredAdminMutationHeaders,
  mediaType: "application/json" as const,
  maxBodyBytes: MAX_JSON_BODY_BYTES,
})

export const AdminEmailTemplateContentBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  subject: z.string().min(1).max(150),
  body: z.string().min(1).max(5_000),
})

export const AdminEmailTemplateReviseBody = AdminEmailTemplateContentBody.extend({
  expectedVersion: z.number().int().positive(),
})

export const AdminEmailTemplateVersionBody = z.strictObject({ expectedVersion: z.number().int().positive() })

export const listAdminEmailTemplates = defineOperation({
  operationId: "listAdminEmailTemplates",
  method: "GET",
  path: "/v1/admin/email-templates",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: z.strictObject({ includeArchived: z.enum(["true", "false"]).optional() }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailTemplateListData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const getAdminEmailTemplate = defineOperation({
  operationId: "getAdminEmailTemplate",
  method: "GET",
  path: "/v1/admin/email-templates/{templateId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: TemplateId },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailTemplateDetailData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const createAdminEmailTemplate = defineOperation({
  operationId: "createAdminEmailTemplate",
  method: "POST",
  path: "/v1/admin/email-templates",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailTemplateContentBody),
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminEmailTemplate) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const reviseAdminEmailTemplate = defineOperation({
  operationId: "reviseAdminEmailTemplate",
  method: "POST",
  path: "/v1/admin/email-templates/{templateId}/revisions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailTemplateReviseBody, TemplateId),
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailTemplate) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const archiveAdminEmailTemplate = defineOperation({
  operationId: "archiveAdminEmailTemplate",
  method: "POST",
  path: "/v1/admin/email-templates/{templateId}/archive",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailTemplateVersionBody, TemplateId),
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailTemplate) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const restoreAdminEmailTemplate = defineOperation({
  operationId: "restoreAdminEmailTemplate",
  method: "POST",
  path: "/v1/admin/email-templates/{templateId}/restore",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailTemplateVersionBody, TemplateId),
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailTemplate) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminEmailRecipientBlock = z.enum(["not_client", "inactive", "suppressed"])

export const AdminEmailPreviewData = z.strictObject({
  templateId: Uuid,
  templateName: z.string(),
  revision: z.number().int().positive(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  sample: z.boolean(),
  recipient: z
    .strictObject({
      userId: Uuid,
      fullName: z.string(),
      maskedEmail: z.string(),
      emailRevision: z.string().regex(/^[1-9][0-9]{0,18}$/u),
      block: AdminEmailRecipientBlock.nullable(),
      nextSendAllowedAt: IsoDateTime.nullable(),
    })
    .nullable(),
})
export type AdminEmailPreviewData = z.infer<typeof AdminEmailPreviewData>

export const AdminEmailQueuedData = z.strictObject({
  messageId: Uuid,
  deliveryId: Uuid,
  recipient: z.string(),
  test: z.boolean(),
  state: z.literal("queued"),
  queuedAt: IsoDateTime,
})

export const AdminEmailSendBody = z.strictObject({
  templateId: Uuid,
  revision: z.number().int().positive(),
  userId: Uuid,
  expectedEmailRevision: z.string().regex(/^[1-9][0-9]{0,18}$/u),
})

export const AdminEmailTestBody = z.strictObject({
  templateId: Uuid,
  revision: z.number().int().positive(),
})

const SEND_ERRORS = [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT", "RATE_LIMITED"] as const

export const previewAdminEmailMessage = defineOperation({
  operationId: "previewAdminEmailMessage",
  method: "GET",
  path: "/v1/admin/email-messages/preview",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: z.strictObject({ templateId: Uuid, userId: Uuid.optional() }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminEmailPreviewData) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const sendAdminEmailMessage = defineOperation({
  operationId: "sendAdminEmailMessage",
  method: "POST",
  path: "/v1/admin/email-messages",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailSendBody),
  success: { status: 202, schema: createSuccessEnvelopeSchema(AdminEmailQueuedData) },
  errorCodes: [...SEND_ERRORS],
})

export const sendTestAdminEmailMessage = defineOperation({
  operationId: "sendTestAdminEmailMessage",
  method: "POST",
  path: "/v1/admin/email-messages/test",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminEmailTestBody),
  success: { status: 202, schema: createSuccessEnvelopeSchema(AdminEmailQueuedData) },
  errorCodes: [...SEND_ERRORS],
})

export const AdminAppUpdateRelease = z.strictObject({
  version: z.string(),
  versionCode: z.number().int().positive(),
  url: z.url(),
})

export const AdminAppUpdatePreviewData = z.strictObject({
  release: AdminAppUpdateRelease.nullable(),
  subject: z.string().nullable(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  recipientCount: z.number().int().nonnegative(),
  alreadySent: z.boolean(),
  currentMinimum: z.string().nullable(),
})
export type AdminAppUpdatePreviewData = z.infer<typeof AdminAppUpdatePreviewData>

export const AdminAppUpdateSendBody = z.strictObject({
  versionCode: z.number().int().positive(),
  mandatory: z.boolean(),
  message: z.string().trim().max(500).optional(),
})

export const AdminAppUpdateSentData = z.strictObject({
  announcementId: Uuid,
  version: z.string(),
  versionCode: z.number().int().positive(),
  mandatory: z.boolean(),
  recipientCount: z.number().int().nonnegative(),
  appConfigVersion: z.number().int().positive().nullable(),
})

export const AdminAppUpdateTestData = z.strictObject({
  deliveryId: Uuid,
  recipient: z.string(),
  state: z.literal("queued"),
})

export const previewAppUpdateAnnouncement = defineOperation({
  operationId: "previewAppUpdateAnnouncement",
  method: "GET",
  path: "/v1/admin/app-update-announcements/preview",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    query: z.strictObject({ mandatory: z.enum(["true", "false"]).optional(), message: z.string().max(500).optional() }),
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminAppUpdatePreviewData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const sendAppUpdateAnnouncement = defineOperation({
  operationId: "sendAppUpdateAnnouncement",
  method: "POST",
  path: "/v1/admin/app-update-announcements",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminAppUpdateSendBody),
  success: { status: 202, schema: createSuccessEnvelopeSchema(AdminAppUpdateSentData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const sendTestAppUpdateAnnouncement = defineOperation({
  operationId: "sendTestAppUpdateAnnouncement",
  method: "POST",
  path: "/v1/admin/app-update-announcements/test",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: writeRequest(AdminAppUpdateSendBody),
  success: { status: 202, schema: createSuccessEnvelopeSchema(AdminAppUpdateTestData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT", "RESOURCE_NOT_FOUND", "RATE_LIMITED"],
})

export const ADMIN_EMAIL_OPERATIONS = Object.freeze([
  listAdminEmailTemplates,
  getAdminEmailTemplate,
  createAdminEmailTemplate,
  reviseAdminEmailTemplate,
  archiveAdminEmailTemplate,
  restoreAdminEmailTemplate,
  previewAdminEmailMessage,
  sendAdminEmailMessage,
  sendTestAdminEmailMessage,
  previewAppUpdateAnnouncement,
  sendAppUpdateAnnouncement,
  sendTestAppUpdateAnnouncement,
])
