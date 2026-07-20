import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * Guards that legacy JavaScript superseded by the TypeScript rearchitecture stays
 * deleted. Each entry lists the batch that removed it and the TS replacement.
 */
const DELETED_LEGACY_FILES: readonly string[] = [
  // BE-008c: replaced by src/domain/onboarding/{submitApplication,verifyApplicationEmail}.ts
  // + src/routes/publicOnboardingRoutes.ts + the onboarding repositories.
  "website/services/onboardingService.js",
  // BE-009a: replaced by src/auth/passwordHasher.ts (Argon2id).
  "security/passwords.js",
  // BE-009d: HS256 token module replaced by src/auth/accessToken.ts (ES256)
  // + src/auth/sessionTokens.ts (opaque refresh/CSRF).
  "security/tokens.js",
  // BE-010: legacy request-auth + auth service/routes replaced by the canonical
  // native (domain/auth/nativeAuth.ts) and web (domain/auth/webAuth.ts) flows.
  "security/auth.js",
  "shared/services/authService.js",
  "shared/services/authService.signup.test.js",
  "shared/routes/authRoutes.js",
  // BE-011: legacy health/reachability replaced by src/runtime/health.ts
  // (/health/ready readiness + /v1/health envelope; /health/live in application.ts).
  "shared/services/healthService.js",
  "shared/routes/healthRoutes.js",
  // BE-013: legacy public content/catalog. Spec 04 declares the route inventory
  // exhaustive for the first slice and defers courses/plans/FAQs/general content/
  // financial routes to later slices; the only first-slice public content route,
  // GET /v1/public/consent-documents, is served by routes/publicOnboardingRoutes.ts.
  // Both files were already dead (publicRoutes imported the deleted onboardingService.js).
  "website/routes/publicRoutes.js",
  "website/services/disclosureService.js",
  // BE-014: legacy payment/mandate provider webhooks + provider abstractions.
  // Spec 04's first-slice webhook surface is only POST /v1/provider-events/aws-sns
  // (routes/providerEventRoutes.ts, BE-012); payment/mandate provider webhooks and
  // the wider financial domain are deferred to later slices, and this code ran on
  // the retired JSON store and non-canonical tables (payments/mandates/transactions).
  "shared/routes/webhookRoutes.js",
  "shared/services/webhookService.js",
  "shared/services/payments/mockProvider.js",
  "shared/services/payments/providerFactory.js",
  "shared/services/payments/razorpayProvider.js",
  // BE-015: legacy client investment domain. Every /v1/client/* route (dashboard,
  // portfolio, products, SIPs, orders, payments, mandates, transactions,
  // statements, notifications, KYC, support, withdrawals, redemptions) is financial
  // and deferred to later slices per spec 04; the services ran on the retired JSON
  // store. No canonical replacement in the first slice (client auth is native/web
  // from BE-010). Owner of clientRoutes.js + all client/services/*.js.
  "client/routes/clientRoutes.js",
  "client/services/clientDataService.js",
  "client/services/fundsService.js",
  "client/services/kycService.js",
  "client/services/mandateService.js",
  "client/services/notificationService.js",
  "client/services/orderService.js",
  "client/services/paymentService.js",
  "client/services/portfolioService.js",
  "client/services/sipControlService.js",
  "client/services/sipService.js",
  "client/services/statementService.js",
  "client/services/supportService.js",
  "client/services/supportTicketDetailService.js",
  "client/services/transactionService.js",
  "client/services/withdrawalService.js",
  // BE-017: legacy admin finance/content/compliance domain. Every /v1/admin/*
  // route (overview, users, approvals, KYC/risk, products/funds/capital,
  // payments/mandates/SIP/reconciliation, app/landing config, notifications,
  // FAQs/courses/plans, support) is financial/content and deferred to later
  // slices per spec 04; the services ran on the retired JSON store. The
  // first-slice admin identity surface is served by routes/adminIdentityRoutes.ts
  // (BE-016). Owner of adminRoutes.js + all admin/services/*.js.
  "admin/routes/adminRoutes.js",
  "admin/services/adminDataService.js",
  "admin/services/faqAdminService.js",
  "admin/services/fundsService.js",
  "admin/services/kycReviewService.js",
  "admin/services/mandateAdminService.js",
  "admin/services/notificationComposerService.js",
  "admin/services/paymentReconcileService.js",
  "admin/services/reconcileService.js",
  "admin/services/sipControlAdminService.js",
  "admin/services/supportTicketAdminService.js",
  "admin/services/userDetailService.js",
  // BE-018: remaining legacy shared routes/services/contracts/config/utils. All
  // served deferred content/financial domains on the retired JSON store and had
  // no TypeScript consumers; the canonical first-slice surface lives in
  // src/routes/*.ts + src/runtime. The legacy transport (http/*.js, router.js)
  // and legacy persistence (db/{client,pgAdapter,store}.js) are retired in BE-019.
  "shared/config/taxConfig.js",
  "shared/config/taxConfig.test.js",
  "shared/contracts/index.js",
  "shared/contracts/moneyState.js",
  "shared/contracts/payloads.js",
  "shared/contracts/receipt.js",
  "shared/routes/constants.js",
  "shared/routes/index.js",
  "shared/routes/internalRoutes.js",
  "shared/routes/receiptRoutes.js",
  "shared/routes/timelineRoutes.js",
  "shared/services/appConfigService.js",
  "shared/services/copyRegistry.js",
  "shared/services/courseService.js",
  "shared/services/fundCatalogService.js",
  "shared/services/fundClientView.js",
  "shared/services/fundClientView.test.js",
  "shared/services/landingConfigSchema.js",
  "shared/services/landingConfigSchema.test.js",
  "shared/services/landingConfigService.js",
  "shared/services/placeholderService.js",
  "shared/services/planService.js",
  "shared/services/receiptService.js",
  "shared/services/timelineService.js",
  "shared/services/withReceipt.js",
  "shared/utils/istDate.js",
  // BE-019: legacy transport + persistence scaffolding and the legacy route-
  // inventory scripts. The canonical transport is src/http/*.ts (boundary,
  // errorCatalog, envelope, validation, idempotencyProtocol, cursor) and the
  // canonical persistence is src/db/*.ts (pool, database, repositories, types).
  // With these gone the backend has zero authored JavaScript (asserted by the
  // zero-JavaScript guard).
  "http/errors.js",
  "http/idempotency.js",
  "http/response.js",
  "http/router.js",
  "http/validate.js",
  "router.js",
  "db/client.js",
  "db/pgAdapter.js",
  "db/store.js",
  "../scripts/check-admin-rbac-routes.js",
  "../scripts/check-auth-403-envelope.js",
  "../scripts/print-routes.js",
  "../scripts/t11-route-inventory.js",
]

describe("legacy deletion guard", () => {
  test.each(DELETED_LEGACY_FILES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })
})
