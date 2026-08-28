import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminListQuery,
  AdminPageMeta,
  AdminReasonDetail,
  OptionalAdminMutationHeaders,
} from "./admin-shared.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const ShortText = z.string().trim().max(200)
const LongText = z.string().trim().max(8_000)
const SortOrder = z.coerce.number().int().min(0).max(100_000).optional()
const Semverish = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9]+(?:\.[0-9]+){0,3}$/u)

export const AdminContentState = z.enum(["draft", "published", "archived"])
export type AdminContentState = z.infer<typeof AdminContentState>

export const AdminFaq = z.strictObject({
  id: Uuid,
  contentKey: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.string(),
  order: z.number().int(),
  status: AdminContentState,
  version: z.number().int(),
  publishedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AdminFaq = z.infer<typeof AdminFaq>

export const listAdminFaqs = defineOperation({
  operationId: "listAdminFaqs",
  method: "GET",
  path: "/v1/admin/faqs",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminListQuery },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(AdminFaq) }), {
      page: AdminPageMeta,
    }),
  },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

export const AdminFaqFieldsBody = z.strictObject({
  question: LongText.min(1),
  answer: LongText.min(1),
  category: ShortText.optional(),
  order: SortOrder,
})
export type AdminFaqFieldsBody = z.infer<typeof AdminFaqFieldsBody>

export const createAdminFaq = defineOperation({
  operationId: "createAdminFaq",
  method: "POST",
  path: "/v1/admin/faqs",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFaqFieldsBody,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(z.strictObject({ faq: AdminFaq })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const editAdminFaq = defineOperation({
  operationId: "editAdminFaq",
  method: "PATCH",
  path: "/v1/admin/faqs/{faqId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    params: z.strictObject({ faqId: Uuid }),
    body: AdminFaqFieldsBody,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ faq: AdminFaq })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminFaqStatusBody = z.strictObject({ status: AdminContentState })
export type AdminFaqStatusBody = z.infer<typeof AdminFaqStatusBody>

export const setAdminFaqStatus = defineOperation({
  operationId: "setAdminFaqStatus",
  method: "PATCH",
  path: "/v1/admin/faqs/{faqId}/status",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    params: z.strictObject({ faqId: Uuid }),
    body: AdminFaqStatusBody,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ faq: AdminFaq })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const archiveAdminFaq = defineOperation({
  operationId: "archiveAdminFaq",
  method: "DELETE",
  path: "/v1/admin/faqs/{faqId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    params: z.strictObject({ faqId: Uuid }),
    headers: OptionalAdminMutationHeaders,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.strictObject({ faq: AdminFaq })) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminAppConfigPayload = z.strictObject({
  featureFlags: z.record(z.string().max(80), z.boolean()).optional(),
  minimumSupportedVersion: z
    .strictObject({
      android: Semverish.optional(),
      ios: Semverish.optional(),
      web: Semverish.optional(),
    })
    .optional(),
  downloads: z
    .strictObject({
      androidUrl: z.string().url().max(2_048).optional(),
      iosUrl: z.string().url().max(2_048).optional(),
    })
    .optional(),
  maintenance: z
    .strictObject({
      enabled: z.boolean().optional(),
      message: LongText.optional(),
    })
    .optional(),
  presentation: z
    .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean()]))
    .optional(),
})
export type AdminAppConfigPayload = z.infer<typeof AdminAppConfigPayload>

export const AdminAppConfigData = z.looseObject({
  version: z.number().int().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  publishedAt: IsoDateTime.nullable(),
  publishedBy: Uuid.nullable(),
  contentSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
})
export type AdminAppConfigData = z.infer<typeof AdminAppConfigData>

export const getAdminAppConfig = defineOperation({
  operationId: "getAdminAppConfig",
  method: "GET",
  path: "/v1/admin/app-config",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminAppConfigData) },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const AdminAppConfigPatchBody = z.strictObject({
  config: AdminAppConfigPayload,
  reason: AdminReasonDetail.optional(),
})
export type AdminAppConfigPatchBody = z.infer<typeof AdminAppConfigPatchBody>

export const publishAdminAppConfig = defineOperation({
  operationId: "publishAdminAppConfig",
  method: "PATCH",
  path: "/v1/admin/app-config",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminAppConfigPatchBody,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminAppConfigData) },
  errorCodes: [...ADMIN_WRITE_ERRORS],
})

export const AdminFundStockItem = z.strictObject({
  id: Uuid,
  stockName: z.string(),
  quarterLabel: z.string(),
  weightPercent: z.string().nullable(),
  state: z.enum(["active", "exited"]),
  sortOrder: z.number().int(),
  exitedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type AdminFundStockItem = z.infer<typeof AdminFundStockItem>

export const listAdminFundStocks = defineOperation({
  operationId: "listAdminFundStocks",
  method: "GET",
  path: "/v1/admin/funds/{fundId}/stocks",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ fundId: Uuid }) },
  success: {
    status: 200,
    schema: createSuccessEnvelopeSchema(z.strictObject({ items: z.array(AdminFundStockItem) })),
  },
  errorCodes: [...ADMIN_READ_ERRORS],
})

export const ADMIN_CONTENT_OPERATIONS = Object.freeze([
  listAdminFaqs,
  createAdminFaq,
  editAdminFaq,
  setAdminFaqStatus,
  archiveAdminFaq,
  getAdminAppConfig,
  publishAdminAppConfig,
  listAdminFundStocks,
])
