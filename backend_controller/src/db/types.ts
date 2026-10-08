import type { AppConfigVersionsTable, AumGrowthBatchesTable, ContentItemsTable, FinancePolicyVersionsTable, FundAumSnapshotsTable, FundDisclosureVersionsTable, FundStockDisclosuresTable, FundVersionsTable, FundsTable } from "./schema/catalog.js"
import type { EmailDeliveriesTable, EmailProviderEventsTable, EmailSendAttemptsTable, EmailSuppressionsTable, OutboxEventsTable } from "./schema/email.js"
import type { ApplicationConsentsTable, ApplicationReviewsTable, ApplicationsTable, AuthLoginEventsTable, AuthRefreshTokensTable, AuthSessionsTable, ConsentDocumentsTable, EmailVerificationCodesTable, PasswordCredentialTokensTable, UserCredentialsTable, UsersTable } from "./schema/identity.js"
import type { ClientGrowthBatchesTable, ClientPositionMaturitiesTable, ClientValueEntriesTable, NotificationsTable, SupportRequestsTable, WithdrawalOperationsTable } from "./schema/ledger.js"
import type { MandateCancelCommandsTable, MandateCollectionAttemptsTable, MandateSetupAttemptsTable, PaymentMandatesTable, SipPlansTable } from "./schema/mandates.js"
import type { FundReceiptAcknowledgementsTable, InvestmentAllocationsTable, InvestmentOrdersTable, PaymentAttemptsTable, PaymentsTable, ProviderEventsTable, ProviderPaymentDetailsTable, RefundOperationsTable } from "./schema/payments.js"
import type { AuditEventsTable, IdempotencyRecordsTable, LegalHoldsTable, PermissionsTable, RateLimitWindowsTable, RolePermissionsTable, RolesTable, UserRolesTable, WorkerHeartbeatsTable } from "./schema/platform.js"

export type * from "./schema/identity.js"
export type * from "./schema/platform.js"
export type * from "./schema/email.js"
export type * from "./schema/catalog.js"
export type * from "./schema/mandates.js"
export type * from "./schema/payments.js"
export type * from "./schema/ledger.js"

export interface Database {
  applications: ApplicationsTable
  consent_documents: ConsentDocumentsTable
  application_consents: ApplicationConsentsTable
  users: UsersTable
  user_credentials: UserCredentialsTable
  application_reviews: ApplicationReviewsTable
  auth_sessions: AuthSessionsTable
  auth_refresh_tokens: AuthRefreshTokensTable
  auth_login_events: AuthLoginEventsTable
  roles: RolesTable
  permissions: PermissionsTable
  role_permissions: RolePermissionsTable
  user_roles: UserRolesTable
  audit_events: AuditEventsTable
  idempotency_records: IdempotencyRecordsTable
  rate_limit_windows: RateLimitWindowsTable
  legal_holds: LegalHoldsTable
  outbox_events: OutboxEventsTable
  email_deliveries: EmailDeliveriesTable
  email_provider_events: EmailProviderEventsTable
  email_suppressions: EmailSuppressionsTable
  email_send_attempts: EmailSendAttemptsTable
  funds: FundsTable
  fund_versions: FundVersionsTable
  fund_disclosure_versions: FundDisclosureVersionsTable
  fund_aum_snapshots: FundAumSnapshotsTable
  aum_growth_batches: AumGrowthBatchesTable
  fund_stock_disclosures: FundStockDisclosuresTable
  finance_policy_versions: FinancePolicyVersionsTable
  app_config_versions: AppConfigVersionsTable
  content_items: ContentItemsTable
  sip_plans: SipPlansTable
  payment_mandates: PaymentMandatesTable
  mandate_setup_attempts: MandateSetupAttemptsTable
  mandate_collection_attempts: MandateCollectionAttemptsTable
  mandate_cancel_commands: MandateCancelCommandsTable
  worker_heartbeats: WorkerHeartbeatsTable
  investment_orders: InvestmentOrdersTable
  fund_receipt_acknowledgements: FundReceiptAcknowledgementsTable
  investment_allocations: InvestmentAllocationsTable
  client_growth_batches: ClientGrowthBatchesTable
  payments: PaymentsTable
  payment_attempts: PaymentAttemptsTable
  provider_payment_details: ProviderPaymentDetailsTable
  refund_operations: RefundOperationsTable
  provider_events: ProviderEventsTable
  client_value_entries: ClientValueEntriesTable
  client_position_maturities: ClientPositionMaturitiesTable
  withdrawal_operations: WithdrawalOperationsTable
  notifications: NotificationsTable
  email_verification_codes: EmailVerificationCodesTable
  password_credential_tokens: PasswordCredentialTokensTable
  support_requests: SupportRequestsTable
}
