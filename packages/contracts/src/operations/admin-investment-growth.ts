import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { SignedPaise, Uuid } from "../scalars.js"
import { ADMIN_WRITE_ERRORS, AdminReasonCode, AdminReasonDetail, RequiredAdminMutationHeaders } from "./admin-shared.js"
import { AdminInvestmentRef } from "./admin-investments.js"
import { CLIENT_GROWTH_MAX_BASIS_POINTS, CLIENT_GROWTH_MIN_BASIS_POINTS } from "./admin-money.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const MAX_INVESTMENT_GROWTH_ITEMS = 500

const AsOfDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const NonZeroSignedPaise = SignedPaise.refine((value) => !/^-?0$/u.test(value))
const BasisHash = z.string().regex(/^[0-9a-f]{64}$/u)
const GrowthBasisPoints = z.coerce.number().int().min(CLIENT_GROWTH_MIN_BASIS_POINTS).max(CLIENT_GROWTH_MAX_BASIS_POINTS)

export const AdminInvestmentGrowthMode = z.enum(["percentage", "gain_since_invested"])
export type AdminInvestmentGrowthMode = z.infer<typeof AdminInvestmentGrowthMode>

export const AdminInvestmentGrowthSkipReason = z.enum(["categorise_first", "zero_invested", "unchanged"])
export type AdminInvestmentGrowthSkipReason = z.infer<typeof AdminInvestmentGrowthSkipReason>

export const AdminInvestmentGrowthPart = z.strictObject({
  ref: AdminInvestmentRef,
  label: z.string(),
  investedPaise: SignedPaise,
  beforePaise: SignedPaise,
  deltaPaise: SignedPaise,
  afterPaise: SignedPaise,
})
export type AdminInvestmentGrowthPart = z.infer<typeof AdminInvestmentGrowthPart>

export const AdminInvestmentGrowthEntry = z.strictObject({
  userId: Uuid,
  beforePaise: SignedPaise,
  deltaPaise: SignedPaise,
  afterPaise: SignedPaise,
  parts: z.array(AdminInvestmentGrowthPart),
})
export type AdminInvestmentGrowthEntry = z.infer<typeof AdminInvestmentGrowthEntry>

export const AdminInvestmentGrowthSkip = z.strictObject({
  userId: Uuid,
  ref: AdminInvestmentRef.nullable(),
  reason: AdminInvestmentGrowthSkipReason,
})
export type AdminInvestmentGrowthSkip = z.infer<typeof AdminInvestmentGrowthSkip>

const GainItem = z.strictObject({ userId: Uuid, ref: AdminInvestmentRef, gainSinceInvestedPaise: SignedPaise })

const exactlyOneMode = (value: { growthBasisPoints?: number | undefined; items?: unknown[] | undefined }): boolean =>
  (value.growthBasisPoints === undefined) !== (value.items === undefined)
const MODE_MESSAGE = { message: "Provide exactly one of growthBasisPoints or items." }

const PREVIEW_FIELDS = {
  fundId: Uuid,
  growthBasisPoints: GrowthBasisPoints.optional(),
  items: z.array(GainItem).min(1).max(MAX_INVESTMENT_GROWTH_ITEMS).optional(),
}

export const AdminInvestmentGrowthPreviewBody = z.strictObject(PREVIEW_FIELDS).refine(exactlyOneMode, MODE_MESSAGE)
export type AdminInvestmentGrowthPreviewBody = z.infer<typeof AdminInvestmentGrowthPreviewBody>

export const AdminInvestmentGrowthPreviewData = z.strictObject({
  fundId: Uuid,
  mode: AdminInvestmentGrowthMode,
  basisHash: BasisHash,
  targetCount: z.number().int(),
  totalDeltaPaise: SignedPaise,
  entries: z.array(AdminInvestmentGrowthEntry),
  skipped: z.array(AdminInvestmentGrowthSkip),
})
export type AdminInvestmentGrowthPreviewData = z.infer<typeof AdminInvestmentGrowthPreviewData>

export const previewAdminInvestmentGrowth = defineOperation({
  operationId: "previewAdminInvestmentGrowth",
  method: "POST",
  path: "/v1/admin/investment-growth/preview",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: AdminInvestmentGrowthPreviewBody,
    headers: z.strictObject({ "x-csrf-token": z.string().min(1) }),
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminInvestmentGrowthPreviewData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const AdminInvestmentGrowthCommitBody = z
  .strictObject({
    ...PREVIEW_FIELDS,
    basisHash: BasisHash,
    effectiveDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminReasonDetail.optional(),
  })
  .refine(exactlyOneMode, MODE_MESSAGE)
export type AdminInvestmentGrowthCommitBody = z.infer<typeof AdminInvestmentGrowthCommitBody>

export const AdminInvestmentGrowthCommitData = z.strictObject({
  batchId: Uuid,
  fundId: Uuid,
  mode: AdminInvestmentGrowthMode,
  effectiveDate: AsOfDate,
  targetCount: z.number().int(),
  totalDeltaPaise: SignedPaise,
  entries: z.array(AdminInvestmentGrowthEntry),
  skipped: z.array(AdminInvestmentGrowthSkip),
})
export type AdminInvestmentGrowthCommitData = z.infer<typeof AdminInvestmentGrowthCommitData>

export const commitAdminInvestmentGrowth = defineOperation({
  operationId: "commitAdminInvestmentGrowth",
  method: "POST",
  path: "/v1/admin/investment-growth/commit",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminInvestmentGrowthCommitBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminInvestmentGrowthCommitData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "STATE_CONFLICT"],
})

export const AdminIndividualInvestmentGrowthBody = z
  .strictObject({
    userId: Uuid,
    fundId: Uuid,
    ref: AdminInvestmentRef,
    growthPaise: NonZeroSignedPaise.optional(),
    growthBasisPoints: GrowthBasisPoints.optional(),
    effectiveDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminReasonDetail.optional(),
  })
  .refine((value) => (value.growthPaise === undefined) !== (value.growthBasisPoints === undefined), {
    message: "Provide exactly one of growthPaise or growthBasisPoints.",
  })
export type AdminIndividualInvestmentGrowthBody = z.infer<typeof AdminIndividualInvestmentGrowthBody>

export const AdminIndividualInvestmentGrowthData = z.strictObject({
  batchId: Uuid,
  entryId: Uuid,
  userId: Uuid,
  fundId: Uuid,
  effectiveDate: AsOfDate,
  reasonCode: z.string(),
  principalPaise: SignedPaise,
  beforePaise: SignedPaise,
  currentValuePaise: SignedPaise,
  deltaPaise: SignedPaise,
  growthPaise: SignedPaise,
  afterPaise: SignedPaise,
  newValuePaise: SignedPaise,
  part: AdminInvestmentGrowthPart,
})
export type AdminIndividualInvestmentGrowthData = z.infer<typeof AdminIndividualInvestmentGrowthData>

export const appendAdminIndividualInvestmentGrowth = defineOperation({
  operationId: "appendAdminIndividualInvestmentGrowth",
  method: "POST",
  path: "/v1/admin/investment-growth/individual",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminIndividualInvestmentGrowthBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(AdminIndividualInvestmentGrowthData) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const ADMIN_INVESTMENT_GROWTH_OPERATIONS = Object.freeze([
  appendAdminIndividualInvestmentGrowth,
  previewAdminInvestmentGrowth,
  commitAdminInvestmentGrowth,
])
