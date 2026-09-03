import type { Kysely, Selectable } from "kysely"

import type { Database } from "./types.js"

export type Transaction = Kysely<Database>

export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T

export type Row<TableName extends keyof Database> = ReadonlyDeep<Selectable<Database[TableName]>>

export type Application = Row<"applications">
export type ConsentDocument = Row<"consent_documents">
export type ApplicationReview = Row<"application_reviews">
export type User = Row<"users">
export type UserCredential = Row<"user_credentials">
export type AuthSession = Row<"auth_sessions">
export type AuthRefreshToken = Row<"auth_refresh_tokens">
export type AuditEvent = Row<"audit_events">
export type IdempotencyRecord = Row<"idempotency_records">
export type OutboxEvent = Row<"outbox_events">
export type EmailDelivery = Row<"email_deliveries">
export type EmailProviderEvent = Row<"email_provider_events">
export type EmailSuppression = Row<"email_suppressions">
export type EmailVerificationCode = Row<"email_verification_codes">
export type Fund = Row<"funds">
export type FundVersion = Row<"fund_versions">
export type AppConfigVersion = Row<"app_config_versions">
export type ContentItem = Row<"content_items">
export type SipPlan = Row<"sip_plans">
export type PaymentMandate = Row<"payment_mandates">
export type MandateSetupAttempt = Row<"mandate_setup_attempts">
export type MandateCollectionAttempt = Row<"mandate_collection_attempts">
export type MandateCancelCommand = Row<"mandate_cancel_commands">
export type InvestmentOrder = Row<"investment_orders">
export type FundReceiptAcknowledgement = Row<"fund_receipt_acknowledgements">
export type InvestmentAllocation = Row<"investment_allocations">
export type Payment = Row<"payments">
export type PaymentAttempt = Row<"payment_attempts">
export type ProviderPaymentDetail = Row<"provider_payment_details">
export type RefundOperation = Row<"refund_operations">
export type Notification = Row<"notifications">

export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand }
export type UserId = Brand<string, "UserId">
export type ConsentKind = "terms" | "privacy"
export type CreatedSession = ReadonlyDeep<{
  session: AuthSession
  refreshToken: AuthRefreshToken
}>
export type IdempotencyScope = ReadonlyDeep<{
  actorScope: string
  actorScopeKeyVersion: string | null
  candidateActorScopes: readonly string[]
  method: string
  routeTemplate: string
  key: string
}>
export type CompleteIdempotencyInput = ReadonlyDeep<{
  scope: IdempotencyScope
  requestHash: Uint8Array
  responseStatus: number
  responseBody: unknown
  completedAt: string
  expiresAt: string
}>
export interface IdempotencyRepository {
  tryAcquireTransactionLock(tx: Transaction, scope: Readonly<IdempotencyScope>): Promise<boolean>
  findCompleted(tx: Transaction, scope: Readonly<IdempotencyScope>): Promise<IdempotencyRecord | null>
  insertCompleted(tx: Transaction, input: Readonly<CompleteIdempotencyInput>): Promise<IdempotencyRecord>
}

