import { z } from "zod"

import { createPaginatedSuccessEnvelopeSchema, createSuccessEnvelopeSchema } from "../envelope.js"
import { Cursor, Decimal24x8, IsoDateTime, Paise, SignedPaise, Uuid } from "../scalars.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

const NullablePaise = Paise.nullable()

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
export type IsoDate = z.infer<typeof IsoDate>

const NullableIsoDate = IsoDate.nullable()
const NullableIsoDateTime = IsoDateTime.nullable()

export const ClientInvestmentStatus = z.enum([
  "payment_in_progress",
  "processing",
  "confirmed",
  "refund_in_progress",
  "support_required",
  "refunded",
  "payment_failed",
])
export type ClientInvestmentStatus = z.infer<typeof ClientInvestmentStatus>

export const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  after: Cursor.optional(),
})

export const EmailVerificationStateValue = z.enum(["not_started", "pending", "verified"])
export type EmailVerificationStateValue = z.infer<typeof EmailVerificationStateValue>

export const EligibilityData = z.strictObject({
  eligibility: z.string(),
  reason: z.string().nullable(),
  canInvest: z.boolean(),
  emailVerificationState: EmailVerificationStateValue.nullable(),
  evaluatedAt: IsoDateTime,
})
export type EligibilityData = z.infer<typeof EligibilityData>

export const getClientEligibility = defineOperation({
  operationId: "getClientEligibility",
  method: "GET",
  path: "/v1/client/eligibility",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(EligibilityData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "RESOURCE_NOT_FOUND", "INTERNAL_ERROR"],
})

const ContributionBreakdown = {
  sipInstallmentCount: z.number().int(),
  sipTotalPaise: Paise,
  lumpSumCount: z.number().int(),
  lumpSumTotalPaise: Paise,
} as const

export const PortfolioPool = z.strictObject({
  fundId: Uuid,
  totalInvestmentPaise: Paise,
  currentValuePaise: SignedPaise,
  totalGrowthPaise: SignedPaise,
  returnPercent: z.number().nullable(),
  contributionCount: z.number().int(),
  contributionTotalPaise: Paise,
  growthAdjustmentTotalPaise: SignedPaise,
  firstContributionDate: NullableIsoDate,
  lastActivityDate: NullableIsoDate,
  firstInvestmentDate: NullableIsoDate,
  allocatedGainPaise: SignedPaise,
  redeemedTotalPaise: Paise,
  ...ContributionBreakdown,
})
export type PortfolioPool = z.infer<typeof PortfolioPool>

export const PortfolioData = z.strictObject({
  currentValuePaise: SignedPaise,
  totalInvestmentPaise: Paise,
  totalGrowthPaise: SignedPaise,
  returnPercent: z.number().nullable(),
  returnSince: NullableIsoDate,
  lastUpdated: NullableIsoDate,
  summary: z.strictObject({
    contributionCount: z.number().int(),
    contributionTotalPaise: Paise,
    growthAdjustmentTotalPaise: SignedPaise,
    reversalCount: z.number().int(),
    allocatedGainPaise: SignedPaise,
    redeemedTotalPaise: Paise,
    redemptionCount: z.number().int(),
    ...ContributionBreakdown,
  }),
  pools: z.array(PortfolioPool),
})
export type PortfolioData = z.infer<typeof PortfolioData>

export const getClientPortfolio = defineOperation({
  operationId: "getClientPortfolio",
  method: "GET",
  path: "/v1/client/portfolio",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(PortfolioData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const LedgerEntryType = z.enum([
  "lump_sum",
  "sip_installment",
  "gain_allocation",
  "adjustment",
])

export const TransactionItem = z.strictObject({
  id: Uuid,
  fundId: Uuid,
  type: LedgerEntryType,
  principalDeltaPaise: SignedPaise,
  valueDeltaPaise: SignedPaise,
  date: IsoDate,
  orderId: Uuid.nullable(),
  createdAt: IsoDateTime,
})
export type TransactionItem = z.infer<typeof TransactionItem>

export const TransactionsData = z.strictObject({ items: z.array(TransactionItem) })

export const listClientTransactions = defineOperation({
  operationId: "listClientTransactions",
  method: "GET",
  path: "/v1/client/transactions",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: ListQuery },
  success: { status: 200, schema: createSuccessEnvelopeSchema(TransactionsData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "CURSOR_INVALID", "VALIDATION_FAILED", "INTERNAL_ERROR"],
})

export const FundRiskLevelValue = z.enum(["low", "moderate", "high", "very_high"])
export const FundReturnTierValue = z.enum(["low", "moderate", "high"])

export const FundSize = z.strictObject({
  aumPaise: Paise,
  asOfDate: NullableIsoDate,
  lastUpdatedAt: NullableIsoDateTime,
})

export const FundSummary = z.strictObject({
  id: Uuid,
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  objective: z.string().nullable(),
  riskLevel: FundRiskLevelValue,
  returnTier: FundReturnTierValue,
  currency: z.string(),
  minimumSipPaise: NullablePaise,
  minimumPurchasePaise: NullablePaise,
  status: z.literal("published"),
  minimumDurationMonths: z.number().int().nullable(),
  recommendedHoldingMonths: z.number().int().nullable(),
  version: z.number().int(),
  fundSize: FundSize.nullable(),
  stockCount: z.number().int(),
  publishedAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
})
export type FundSummary = z.infer<typeof FundSummary>

export const FundListData = z.strictObject({ items: z.array(FundSummary) })

export const listClientFunds = defineOperation({
  operationId: "listClientFunds",
  method: "GET",
  path: "/v1/client/funds",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: ListQuery },
  success: { status: 200, schema: createPaginatedSuccessEnvelopeSchema(FundListData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "CURSOR_INVALID", "VALIDATION_FAILED", "INTERNAL_ERROR"],
})

export const FundDisclosure = z.strictObject({
  version: z.number().int(),
  title: z.string(),
  body: z.string(),
  effectiveFrom: IsoDateTime,
})

export const FundStock = z.strictObject({
  stockName: z.string(),
  quarterLabel: z.string(),
  weightPercent: Decimal24x8.nullable(),
  sortOrder: z.number().int(),
})
export type FundStock = z.infer<typeof FundStock>

export const FundDetailData = z.strictObject({
  fund: FundSummary,
  stocks: z.array(FundStock),
  disclosure: FundDisclosure.nullable(),
})
export type FundDetailData = z.infer<typeof FundDetailData>

export const getClientFund = defineOperation({
  operationId: "getClientFund",
  method: "GET",
  path: "/v1/client/funds/{fundId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: z.strictObject({ fundId: Uuid }) },
  success: { status: 200, schema: createSuccessEnvelopeSchema(FundDetailData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "RESOURCE_NOT_FOUND", "VALIDATION_FAILED", "INTERNAL_ERROR"],
})

export const EmailVerificationStatusData = z.looseObject({
  emailVerificationState: EmailVerificationStateValue.nullable(),
})
export type EmailVerificationStatusData = z.infer<typeof EmailVerificationStatusData>

export const getEmailVerificationStatus = defineOperation({
  operationId: "getEmailVerificationStatus",
  method: "GET",
  path: "/v1/client/email-verification-status",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(EmailVerificationStatusData) },
  errorCodes: ["AUTHENTICATION_REQUIRED", "SESSION_INVALID", "ACCOUNT_NOT_ACTIVE", "INTERNAL_ERROR"],
})

export const EmailVerificationIssueData = z.looseObject({})

export const startEmailVerification = defineOperation({
  operationId: "startEmailVerification",
  method: "POST",
  path: "/v1/client/email-verification/start",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(EmailVerificationIssueData) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "STATE_CONFLICT",
    "RATE_LIMITED",
    "DEPENDENCY_UNAVAILABLE",
    "INTERNAL_ERROR",
  ],
})

export const VerifyEmailBody = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9]{6}$/u),
})
export type VerifyEmailBody = z.infer<typeof VerifyEmailBody>

export const verifyEmail = defineOperation({
  operationId: "verifyEmail",
  method: "POST",
  path: "/v1/client/email-verification/verify",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: VerifyEmailBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(z.looseObject({})) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "VALIDATION_FAILED",
    "TOKEN_INVALID",
    "TOKEN_EXPIRED",
    "STATE_CONFLICT",
    "INTERNAL_ERROR",
  ],
})

export const CLIENT_OPERATIONS = Object.freeze([
  getClientEligibility,
  getClientPortfolio,
  listClientTransactions,
  listClientFunds,
  getClientFund,
  getEmailVerificationStatus,
  startEmailVerification,
  verifyEmail,
])
