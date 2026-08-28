import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IdempotencyKey, IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const AdminFundState = z.enum(["draft", "published", "paused", "archived"])
export type AdminFundState = z.infer<typeof AdminFundState>

export const AdminFundRiskLevel = z.enum(["low", "moderate", "high", "very_high"])
export type AdminFundRiskLevel = z.infer<typeof AdminFundRiskLevel>

export const AdminFundReturnTier = z.enum(["low", "moderate", "high"])
export type AdminFundReturnTier = z.infer<typeof AdminFundReturnTier>

const NonZeroSignedPaise = SignedPaise.refine((value) => !/^-?0$/u.test(value))
const AsOfDate = z.iso.date()
const AdminReasonCode = z.string().trim().min(1).max(80)
const AdminNote = z.string().trim().min(1).max(2000).optional()
const ShortText = z.string().trim().min(1).max(200)
const LongText = z.string().trim().max(20000)
const QuarterLabel = z.string().trim().regex(/^Q[1-4] FY[0-9]{2}$/u)
const BasisHash = z.string().regex(/^[0-9a-f]{64}$/u)
const FundSlug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
const GrowthBasisPoints = z
  .number()
  .int()
  .min(-10_000)
  .max(100_000)
  .refine((value) => value !== 0)

const PageMeta = z.strictObject({
  nextCursor: z.string().nullable(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})

const FundIdParams = z.strictObject({ fundId: Uuid })
const StockIdParams = z.strictObject({ fundId: Uuid, stockId: Uuid })
const SnapshotIdParams = z.strictObject({ snapshotId: Uuid })

const AdminCsrfHeaders = z.strictObject({ "x-csrf-token": z.string().min(1) })
const OptionalAdminMutationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey.optional(),
  "x-csrf-token": z.string().min(1),
})
const RequiredAdminMutationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey,
  "x-csrf-token": z.string().min(1),
})

export const AdminFundAum = z.strictObject({
  aumPaise: Paise,
  asOfDate: AsOfDate.nullable(),
  updatedAt: IsoDateTime.nullable(),
})
export type AdminFundAum = z.infer<typeof AdminFundAum>

export const AdminFund = z
  .strictObject({
    id: Uuid,
    slug: z.string(),
    status: AdminFundState,
    name: z.string().nullable(),
    category: z.string().nullable(),
    objective: z.string().nullable(),
    riskLevel: AdminFundRiskLevel.nullable(),
    returnTier: AdminFundReturnTier.nullable(),
    currency: z.string(),
    minimumSipPaise: Paise.nullable(),
    minimumPurchasePaise: Paise.nullable(),
    currentVersion: z.number().int().nullable(),
    currentVersionId: Uuid.nullable(),
    aum: AdminFundAum.nullable(),
    stockCount: z.number().int(),
    publishedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    version: z.number().int(),
  })
  .meta({ id: "AdminFund" })
export type AdminFund = z.infer<typeof AdminFund>

export const AdminFundVersion = z
  .strictObject({
    id: Uuid,
    version: z.number().int(),
    name: z.string(),
    category: z.string(),
    objective: z.string(),
    riskLevel: AdminFundRiskLevel,
    returnTier: AdminFundReturnTier.nullable(),
    currency: z.string(),
    minimumSipPaise: Paise,
    minimumPurchasePaise: Paise,
    minimumDurationMonths: z.number().int().nullable(),
    recommendedHoldingMonths: z.number().int().nullable(),
    disclosureVersionId: Uuid,
    createdAt: IsoDateTime,
  })
  .meta({ id: "AdminFundVersion" })
export type AdminFundVersion = z.infer<typeof AdminFundVersion>

export const AdminFundStock = z
  .strictObject({
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
  .meta({ id: "AdminFundStock" })
export type AdminFundStock = z.infer<typeof AdminFundStock>

export const AdminFundDisclosure = z
  .strictObject({
    id: Uuid,
    version: z.number().int(),
    title: z.string(),
    body: z.string(),
    effectiveFrom: IsoDateTime,
    createdAt: IsoDateTime,
  })
  .meta({ id: "AdminFundDisclosure" })
export type AdminFundDisclosure = z.infer<typeof AdminFundDisclosure>

export const AdminAumSnapshot = z
  .strictObject({
    id: Uuid,
    fundId: Uuid,
    asOfDate: AsOfDate,
    revision: z.number().int(),
    aumPaise: Paise,
    reasonCode: z.string(),
    note: z.string().nullable(),
    growthBatchId: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: "AdminAumSnapshot" })
export type AdminAumSnapshot = z.infer<typeof AdminAumSnapshot>

export const AdminFundTermsInput = z
  .strictObject({
    name: ShortText,
    category: ShortText,
    objective: LongText.default(""),
    riskLevel: AdminFundRiskLevel,
    returnTier: AdminFundReturnTier.nullish(),
    minimumSipPaise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    minimumPurchasePaise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    minimumDurationMonths: z.number().int().positive().max(1200).nullish(),
    recommendedHoldingMonths: z.number().int().positive().max(1200).nullish(),
    disclosure: z.strictObject({ title: ShortText, body: LongText.min(1) }),
  })
  .meta({ id: "AdminFundTermsInput" })
export type AdminFundTermsInput = z.infer<typeof AdminFundTermsInput>

export const AdminFundListQuery = z.strictObject({
  after: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  state: AdminFundState.optional(),
  search: z.string().trim().min(1).max(120).optional(),
})
export type AdminFundListQuery = z.infer<typeof AdminFundListQuery>

export const AdminAumHistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z.string().min(1).optional(),
})
export type AdminAumHistoryQuery = z.infer<typeof AdminAumHistoryQuery>

export const AdminFundCreateBody = z.strictObject({
  slug: FundSlug,
  terms: AdminFundTermsInput,
  openingAum: z.strictObject({
    aumPaise: Paise,
    asOfDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminNote,
  }),
})
export type AdminFundCreateBody = z.infer<typeof AdminFundCreateBody>

export const AdminFundLifecycleBody = z.strictObject({
  status: z.enum(["published", "paused", "archived"]),
})
export type AdminFundLifecycleBody = z.infer<typeof AdminFundLifecycleBody>

export const AdminFundStockBody = z.strictObject({
  stockName: ShortText,
  quarterLabel: QuarterLabel,
  weightPercent: z.number().min(0).max(100).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
})
export type AdminFundStockBody = z.infer<typeof AdminFundStockBody>

export const AdminAumInitializeBody = z.strictObject({
  aumPaise: Paise,
  asOfDate: AsOfDate,
  reasonCode: AdminReasonCode,
  note: AdminNote,
})
export type AdminAumInitializeBody = z.infer<typeof AdminAumInitializeBody>

export const AdminAumGrowthBody = z
  .strictObject({
    growthPaise: NonZeroSignedPaise.optional(),
    growthBasisPoints: GrowthBasisPoints.optional(),
    asOfDate: AsOfDate,
    reasonCode: AdminReasonCode,
    note: AdminNote,
  })
  .refine((body) => (body.growthPaise === undefined) !== (body.growthBasisPoints === undefined))
export type AdminAumGrowthBody = z.infer<typeof AdminAumGrowthBody>

export const AdminAumCorrectionBody = z.strictObject({
  aumPaise: Paise,
  reasonCode: AdminReasonCode,
  note: AdminNote,
})
export type AdminAumCorrectionBody = z.infer<typeof AdminAumCorrectionBody>

const collectiveFields = {
  asOfDate: AsOfDate,
  reasonCode: AdminReasonCode,
  note: AdminNote,
  fundIds: z.array(Uuid).min(1).max(100).optional(),
  growthBasisPoints: GrowthBasisPoints.optional(),
  items: z
    .array(z.strictObject({ fundId: Uuid, growthPaise: NonZeroSignedPaise }))
    .min(1)
    .max(100)
    .optional(),
} as const

type CollectiveBody = {
  readonly fundIds?: readonly string[] | undefined
  readonly growthBasisPoints?: number | undefined
  readonly items?: readonly { readonly fundId: string }[] | undefined
}

const hasExactlyOneCollectiveForm = (body: CollectiveBody): boolean =>
  (body.growthBasisPoints !== undefined &&
    body.fundIds !== undefined &&
    body.items === undefined) ||
  (body.items !== undefined && body.growthBasisPoints === undefined && body.fundIds === undefined)

const hasUniqueCollectiveFunds = (body: CollectiveBody): boolean => {
  const ids = body.items !== undefined ? body.items.map((item) => item.fundId) : (body.fundIds ?? [])
  return new Set(ids).size === ids.length
}

export const AdminAumCollectivePreviewBody = z
  .strictObject({ ...collectiveFields })
  .refine(hasExactlyOneCollectiveForm)
  .refine(hasUniqueCollectiveFunds)
export type AdminAumCollectivePreviewBody = z.infer<typeof AdminAumCollectivePreviewBody>

export const AdminAumCollectiveCommitBody = z
  .strictObject({ ...collectiveFields, basisHash: BasisHash })
  .refine(hasExactlyOneCollectiveForm)
  .refine(hasUniqueCollectiveFunds)
export type AdminAumCollectiveCommitBody = z.infer<typeof AdminAumCollectiveCommitBody>

export const AdminFundListData = z.strictObject({
  items: z.array(AdminFund),
  summary: z.strictObject({
    total: z.number().int(),
    byState: z.strictObject({
      draft: z.number().int(),
      published: z.number().int(),
      paused: z.number().int(),
      archived: z.number().int(),
    }),
  }),
})
export type AdminFundListData = z.infer<typeof AdminFundListData>

export const AdminFundListSuccessEnvelope = createSuccessEnvelopeSchema(AdminFundListData, {
  page: PageMeta,
})
export type AdminFundListSuccessEnvelope = z.infer<typeof AdminFundListSuccessEnvelope>

export const AdminFundDetailData = z.strictObject({
  fund: AdminFund,
  versions: z.array(AdminFundVersion),
  stocks: z.array(AdminFundStock),
  disclosures: z.array(AdminFundDisclosure),
})
export type AdminFundDetailData = z.infer<typeof AdminFundDetailData>

export const AdminFundDetailSuccessEnvelope = createSuccessEnvelopeSchema(AdminFundDetailData)
export type AdminFundDetailSuccessEnvelope = z.infer<typeof AdminFundDetailSuccessEnvelope>

export const AdminFundCreateData = z.strictObject({
  fund: z.strictObject({
    id: Uuid,
    slug: z.string(),
    status: AdminFundState,
    currentVersion: z.number().int(),
    createdAt: IsoDateTime,
  }),
  aum: z.strictObject({ snapshotId: Uuid, aumPaise: Paise, asOfDate: AsOfDate }),
})
export type AdminFundCreateData = z.infer<typeof AdminFundCreateData>

export const AdminFundCreateSuccessEnvelope = createSuccessEnvelopeSchema(AdminFundCreateData)
export type AdminFundCreateSuccessEnvelope = z.infer<typeof AdminFundCreateSuccessEnvelope>

export const AdminFundVersionPublishData = z.strictObject({
  fundId: Uuid,
  status: AdminFundState,
  fundVersionId: Uuid,
  version: z.number().int(),
  disclosureVersionId: Uuid,
})
export type AdminFundVersionPublishData = z.infer<typeof AdminFundVersionPublishData>

export const AdminFundVersionPublishSuccessEnvelope = createSuccessEnvelopeSchema(
  AdminFundVersionPublishData,
)
export type AdminFundVersionPublishSuccessEnvelope = z.infer<
  typeof AdminFundVersionPublishSuccessEnvelope
>

export const AdminFundLifecycleData = z.strictObject({
  fundId: Uuid,
  status: AdminFundState,
  version: z.number().int(),
})
export type AdminFundLifecycleData = z.infer<typeof AdminFundLifecycleData>

export const AdminFundLifecycleSuccessEnvelope = createSuccessEnvelopeSchema(AdminFundLifecycleData)
export type AdminFundLifecycleSuccessEnvelope = z.infer<typeof AdminFundLifecycleSuccessEnvelope>

export const AdminFundStockData = z.strictObject({ stock: AdminFundStock })
export type AdminFundStockData = z.infer<typeof AdminFundStockData>

export const AdminFundStockSuccessEnvelope = createSuccessEnvelopeSchema(AdminFundStockData)
export type AdminFundStockSuccessEnvelope = z.infer<typeof AdminFundStockSuccessEnvelope>

export const AdminAumInitializeData = z.strictObject({
  snapshot: AdminAumSnapshot,
  growthBatchId: Uuid,
})
export type AdminAumInitializeData = z.infer<typeof AdminAumInitializeData>

export const AdminAumInitializeSuccessEnvelope = createSuccessEnvelopeSchema(AdminAumInitializeData)
export type AdminAumInitializeSuccessEnvelope = z.infer<typeof AdminAumInitializeSuccessEnvelope>

export const AdminAumGrowthData = z.strictObject({
  snapshot: AdminAumSnapshot,
  growthBatchId: Uuid,
  deltaPaise: SignedPaise,
})
export type AdminAumGrowthData = z.infer<typeof AdminAumGrowthData>

export const AdminAumGrowthSuccessEnvelope = createSuccessEnvelopeSchema(AdminAumGrowthData)
export type AdminAumGrowthSuccessEnvelope = z.infer<typeof AdminAumGrowthSuccessEnvelope>

export const AdminAumCorrectionData = z.strictObject({ snapshot: AdminAumSnapshot })
export type AdminAumCorrectionData = z.infer<typeof AdminAumCorrectionData>

export const AdminAumCorrectionSuccessEnvelope = createSuccessEnvelopeSchema(AdminAumCorrectionData)
export type AdminAumCorrectionSuccessEnvelope = z.infer<typeof AdminAumCorrectionSuccessEnvelope>

export const AdminAumHistoryData = z.strictObject({ items: z.array(AdminAumSnapshot) })
export type AdminAumHistoryData = z.infer<typeof AdminAumHistoryData>

export const AdminAumHistorySuccessEnvelope = createSuccessEnvelopeSchema(AdminAumHistoryData, {
  page: PageMeta,
})
export type AdminAumHistorySuccessEnvelope = z.infer<typeof AdminAumHistorySuccessEnvelope>

const CollectiveCommitItem = z.strictObject({
  fundId: Uuid,
  snapshotId: Uuid,
  revision: z.number().int(),
  beforeAumPaise: Paise,
  deltaPaise: SignedPaise,
  afterAumPaise: Paise,
})

export const AdminAumCollectiveCommitData = z.strictObject({
  growthBatchId: Uuid,
  targetCount: z.number().int(),
  totalDeltaPaise: SignedPaise,
  basisHash: BasisHash,
  items: z.array(CollectiveCommitItem),
})
export type AdminAumCollectiveCommitData = z.infer<typeof AdminAumCollectiveCommitData>

export const AdminAumCollectiveCommitSuccessEnvelope = createSuccessEnvelopeSchema(
  AdminAumCollectiveCommitData,
)
export type AdminAumCollectiveCommitSuccessEnvelope = z.infer<
  typeof AdminAumCollectiveCommitSuccessEnvelope
>

const CollectivePreviewItem = z.strictObject({
  fundId: Uuid,
  basisSnapshotId: Uuid,
  basisRevision: z.number().int(),
  beforeAumPaise: Paise,
  deltaPaise: SignedPaise,
  afterAumPaise: Paise,
})

export const AdminAumCollectivePreviewData = z.strictObject({
  basisHash: BasisHash,
  items: z.array(CollectivePreviewItem),
})
export type AdminAumCollectivePreviewData = z.infer<typeof AdminAumCollectivePreviewData>

export const AdminAumCollectivePreviewSuccessEnvelope = createSuccessEnvelopeSchema(
  AdminAumCollectivePreviewData,
)
export type AdminAumCollectivePreviewSuccessEnvelope = z.infer<
  typeof AdminAumCollectivePreviewSuccessEnvelope
>

const ADMIN_AUTH_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "AUTHORIZATION_DENIED",
] as const
const ADMIN_CSRF_ERRORS = ["CSRF_INVALID"] as const
const ADMIN_BODY_ERRORS = ["VALIDATION_FAILED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] as const
const ADMIN_IDEMPOTENCY_ERRORS = ["IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_IN_PROGRESS"] as const
const ADMIN_INFRA_ERRORS = ["RATE_LIMITED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"] as const

export const listAdminFunds = defineOperation({
  operationId: "listAdminFunds",
  method: "GET",
  path: "/v1/admin/funds",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminFundListQuery },
  success: { status: 200, schema: AdminFundListSuccessEnvelope },
  errorCodes: ["VALIDATION_FAILED", "CURSOR_INVALID", ...ADMIN_AUTH_ERRORS, ...ADMIN_INFRA_ERRORS],
})

export const createAdminFund = defineOperation({
  operationId: "createAdminFund",
  method: "POST",
  path: "/v1/admin/funds",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFundCreateBody,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminFundCreateSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const getAdminFund = defineOperation({
  operationId: "getAdminFund",
  method: "GET",
  path: "/v1/admin/funds/{fundId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: FundIdParams },
  success: { status: 200, schema: AdminFundDetailSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    ...ADMIN_AUTH_ERRORS,
    "RESOURCE_NOT_FOUND",
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const publishAdminFundVersion = defineOperation({
  operationId: "publishAdminFundVersion",
  method: "POST",
  path: "/v1/admin/funds/{fundId}/versions",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFundTermsInput,
    params: FundIdParams,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminFundVersionPublishSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const transitionAdminFundLifecycle = defineOperation({
  operationId: "transitionAdminFundLifecycle",
  method: "PATCH",
  path: "/v1/admin/funds/{fundId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFundLifecycleBody,
    params: FundIdParams,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminFundLifecycleSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const addAdminFundStock = defineOperation({
  operationId: "addAdminFundStock",
  method: "POST",
  path: "/v1/admin/funds/{fundId}/stocks",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFundStockBody,
    params: FundIdParams,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminFundStockSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const editAdminFundStock = defineOperation({
  operationId: "editAdminFundStock",
  method: "PATCH",
  path: "/v1/admin/funds/{fundId}/stocks/{stockId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: {
    body: AdminFundStockBody,
    params: StockIdParams,
    headers: OptionalAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminFundStockSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const exitAdminFundStock = defineOperation({
  operationId: "exitAdminFundStock",
  method: "DELETE",
  path: "/v1/admin/funds/{fundId}/stocks/{stockId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "optional-key",
  request: { params: StockIdParams, headers: OptionalAdminMutationHeaders },
  success: { status: 200, schema: AdminFundStockSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const initializeAdminFundAum = defineOperation({
  operationId: "initializeAdminFundAum",
  method: "POST",
  path: "/v1/admin/aum/funds/{fundId}/initialize",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminAumInitializeBody,
    params: FundIdParams,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminAumInitializeSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const appendAdminFundAumGrowth = defineOperation({
  operationId: "appendAdminFundAumGrowth",
  method: "POST",
  path: "/v1/admin/aum/funds/{fundId}/growth",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminAumGrowthBody,
    params: FundIdParams,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminAumGrowthSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const correctAdminFundAumSnapshot = defineOperation({
  operationId: "correctAdminFundAumSnapshot",
  method: "POST",
  path: "/v1/admin/aum/snapshots/{snapshotId}/corrections",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminAumCorrectionBody,
    params: SnapshotIdParams,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminAumCorrectionSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const getAdminFundAumHistory = defineOperation({
  operationId: "getAdminFundAumHistory",
  method: "GET",
  path: "/v1/admin/aum/funds/{fundId}/history",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: FundIdParams, query: AdminAumHistoryQuery },
  success: { status: 200, schema: AdminAumHistorySuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "CURSOR_INVALID",
    ...ADMIN_AUTH_ERRORS,
    "RESOURCE_NOT_FOUND",
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const previewAdminCollectiveAumGrowth = defineOperation({
  operationId: "previewAdminCollectiveAumGrowth",
  method: "POST",
  path: "/v1/admin/aum/growth/collective/preview",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: {
    body: AdminAumCollectivePreviewBody,
    headers: AdminCsrfHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: AdminAumCollectivePreviewSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const commitAdminCollectiveAumGrowth = defineOperation({
  operationId: "commitAdminCollectiveAumGrowth",
  method: "POST",
  path: "/v1/admin/aum/growth/collective",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    body: AdminAumCollectiveCommitBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: AdminAumCollectiveCommitSuccessEnvelope },
  errorCodes: [
    ...ADMIN_BODY_ERRORS,
    ...ADMIN_AUTH_ERRORS,
    ...ADMIN_CSRF_ERRORS,
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
    ...ADMIN_IDEMPOTENCY_ERRORS,
    ...ADMIN_INFRA_ERRORS,
  ],
})

export const ADMIN_FUND_AUM_OPERATIONS = Object.freeze([
  listAdminFunds,
  createAdminFund,
  getAdminFund,
  publishAdminFundVersion,
  transitionAdminFundLifecycle,
  addAdminFundStock,
  editAdminFundStock,
  exitAdminFundStock,
  initializeAdminFundAum,
  appendAdminFundAumGrowth,
  correctAdminFundAumSnapshot,
  getAdminFundAumHistory,
  previewAdminCollectiveAumGrowth,
  commitAdminCollectiveAumGrowth,
])
