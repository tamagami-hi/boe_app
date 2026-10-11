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

export const ADMIN_EMAIL_OPERATIONS = Object.freeze([
  listAdminEmailTemplates,
  getAdminEmailTemplate,
  createAdminEmailTemplate,
  reviseAdminEmailTemplate,
  archiveAdminEmailTemplate,
  restoreAdminEmailTemplate,
])
