import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const MAX_VERSION_CODE = 2_000_000_000

export const ReleasePlatform = z.enum(["android"])
export type ReleasePlatform = z.infer<typeof ReleasePlatform>

export const ReleaseVariant = z.enum(["client", "admin"])
export type ReleaseVariant = z.infer<typeof ReleaseVariant>

export const AppConfigData = z.strictObject({
  version: z.number().int().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  publishedAt: z.string().nullable(),
})
export type AppConfigData = z.infer<typeof AppConfigData>

export const getAppConfig = defineOperation({
  operationId: "getAppConfig",
  method: "GET",
  path: "/v1/app-config",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(AppConfigData) },
  errorCodes: ["INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
})

export const AppUpdateQuery = z.strictObject({
  platform: ReleasePlatform.optional(),
  variant: ReleaseVariant.optional(),
  applicationId: z.string().trim().max(200).optional(),
  versionCode: z.coerce.number().int().min(0).max(MAX_VERSION_CODE).optional(),
  version: z.string().trim().max(64).optional(),
})

export const ReleaseArtifactData = z.strictObject({
  version: z.string(),
  versionName: z.string(),
  versionCode: z.number().int(),
  applicationId: z.string().min(1),
  sizeBytes: z.number().int(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  url: z.string().nullable(),
  publishedAt: z.string().nullable(),
})
export type ReleaseArtifactData = z.infer<typeof ReleaseArtifactData>

export const AppUpdateData = z.strictObject({
  platform: ReleasePlatform,
  variant: ReleaseVariant,
  updateAvailable: z.boolean(),
  mandatory: z.boolean(),
  current: z.strictObject({
    version: z.string().nullable(),
    versionCode: z.number().int().nullable(),
    applicationId: z.string().nullable(),
  }),
  latest: ReleaseArtifactData.nullable(),
  minimumSupportedVersion: z.string().nullable(),
  maintenance: z.record(z.string(), z.unknown()),
})
export type AppUpdateData = z.infer<typeof AppUpdateData>

export const getAppUpdate = defineOperation({
  operationId: "getAppUpdate",
  method: "GET",
  path: "/v1/app/update",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: { query: AppUpdateQuery },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AppUpdateData) },
  errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
})

export const ReportAppVersionBody = z.strictObject({
  platform: ReleasePlatform.optional(),
  variant: ReleaseVariant.optional(),
  applicationId: z.string().trim().min(1).max(200),
  versionName: z.string().trim().min(1).max(64),
  versionCode: z.number().int().min(0).max(MAX_VERSION_CODE),
})
export type ReportAppVersionBody = z.infer<typeof ReportAppVersionBody>

export const ReportAppVersionData = z.strictObject({
  updateAvailable: z.boolean(),
  notified: z.boolean(),
  retired: z.boolean(),
  latest: z
    .strictObject({ versionCode: z.number().int(), version: z.string() })
    .nullable(),
})
export type ReportAppVersionData = z.infer<typeof ReportAppVersionData>

export const reportAppVersion = defineOperation({
  operationId: "reportAppVersion",
  method: "POST",
  path: "/v1/client/app-version",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {
    body: ReportAppVersionBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ReportAppVersionData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ],
})

export const APP_OPERATIONS = Object.freeze([getAppConfig, getAppUpdate, reportAppVersion])
