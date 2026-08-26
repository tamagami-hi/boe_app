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
export type ApplicationConsent = Row<"application_consents">
export type ConsentDocument = Row<"consent_documents">
export type ApplicationReview = Row<"application_reviews">
export type User = Row<"users">
export type UserCredential = Row<"user_credentials">
export type AuthSession = Row<"auth_sessions">
export type AuthRefreshToken = Row<"auth_refresh_tokens">
export type Role = Row<"roles">
export type Permission = Row<"permissions">
export type RolePermission = Row<"role_permissions">
export type UserRole = Row<"user_roles">
export type AuditEvent = Row<"audit_events">
export type IdempotencyRecord = Row<"idempotency_records">
export type RateLimitWindow = Row<"rate_limit_windows">
export type LegalHold = Row<"legal_holds">
export type OutboxEvent = Row<"outbox_events">
export type EmailDelivery = Row<"email_deliveries">
export type EmailProviderEvent = Row<"email_provider_events">
export type EmailSuppression = Row<"email_suppressions">
export type EmailVerificationCode = Row<"email_verification_codes">
export type Fund = Row<"funds">
export type FundVersion = Row<"fund_versions">
export type FundDisclosureVersion = Row<"fund_disclosure_versions">
export type FundAumSnapshot = Row<"fund_aum_snapshots">
export type AumGrowthBatch = Row<"aum_growth_batches">
export type FundStockDisclosure = Row<"fund_stock_disclosures">
export type FinancePolicyVersion = Row<"finance_policy_versions">
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
export type ClientGrowthBatch = Row<"client_growth_batches">
export type Payment = Row<"payments">
export type PaymentAttempt = Row<"payment_attempts">
export type ProviderPaymentDetail = Row<"provider_payment_details">
export type RefundOperation = Row<"refund_operations">
export type ProviderEvent = Row<"provider_events">
export type ClientValueEntry = Row<"client_value_entries">
export type Notification = Row<"notifications">

export type CursorInput = ReadonlyDeep<{
  after?: string
  limit: number
}>
export type CursorPage<Item> = ReadonlyDeep<{
  items: readonly Item[]
  nextCursor: string | null
}>
export type ApplicationQueueQuery = ReadonlyDeep<
  CursorInput & {
    states?: readonly Application["state"][]
    createdFrom?: string
    createdTo?: string
  }
>
export type ApplicationQueueItem = ReadonlyDeep<{
  application: Application
  latestReview: ApplicationReview | null
}>
export type ApplicationDeliverySummary = ReadonlyDeep<{
  emailDeliveryId: string
  templateKey: string
  recipientMasked: string
  state: EmailDelivery["state"]
  attemptCount: number
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}>
export type ApplicationConsentDetail = ReadonlyDeep<{
  consent: ApplicationConsent
  kind: ConsentKind
  version: string
}>
export type ApplicationDetail = ReadonlyDeep<{
  application: Application
  consents: readonly ApplicationConsentDetail[]
  reviews: readonly ApplicationReview[]
  deliveries: CursorPage<ApplicationDeliverySummary>
}>
export type ActiveIdentityCollision = ReadonlyDeep<{
  applicationByEmail: Application | null
  applicationByPhone: Application | null
  userByEmail: User | null
  userByPhone: User | null
}>
export type UserWithCredential = ReadonlyDeep<{
  user: User
  credential: UserCredential
}>
export type RevokeSessionsResult = ReadonlyDeep<{
  revokedSessionCount: number
  revokedRefreshTokenCount: number
}>
export type EmailDeliveryQuery = ReadonlyDeep<
  CursorInput & {
    states?: readonly EmailDelivery["state"][]
    templateKeys?: readonly string[]
    applicationId?: string
    userId?: string
  }
>
export type RetentionEntityType =
  | "application"
  | "user"
  | "email_delivery"
  | "email_provider_event"
  | "audit_event"
  | "investment_order"
  | "payment"
export type CleanupRecordType =
  | RetentionEntityType
  | "auth_session"
  | "auth_refresh_token"
  | "idempotency_record"
  | "outbox_event"
  | "email_provider_event"
  | "email_suppression"
  | "rate_limit_window"
export type CleanupCandidateQuery = ReadonlyDeep<{
  recordType: CleanupRecordType
  action: "tombstone" | "erase" | "delete"
  before: string
  after?: string
  limit: number
}>
export type CleanupCandidate = ReadonlyDeep<{
  recordType: CleanupRecordType
  recordId: string
  retentionParentType: RetentionEntityType
  retentionParentId: string
  cursor: string
}>

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }
export type ApplicationId = Brand<string, "ApplicationId">
export type UserId = Brand<string, "UserId">
export type EmailDeliveryId = Brand<string, "EmailDeliveryId">
export type DeliveryCorrelationId = Brand<string, "DeliveryCorrelationId">
export type ConsentKind = "terms" | "privacy"
export type PermissionCode = Brand<string, "PermissionCode">
export type CommandContext = ReadonlyDeep<{
  actorUserId: UserId | null
  requestId: string
  expectedVersion?: number
  idempotencyKey?: string
  reasonCode?: string
  reasonDetail?: string
}>
export type CreateApplicationInput = ReadonlyDeep<{
  fullName: string
  emailNormalized: string
  phoneE164: string
  consentDocumentIds: readonly string[]
  ipHmac: Uint8Array
  ipHmacKeyVersion: string
  userAgent: string | null
}>
export type WithdrawApplicationCommand = ReadonlyDeep<
  CommandContext & {
    applicationId: ApplicationId
    applicantRequestEvidence: string
  }
>
export type RecordConsentAcceptancesInput = ReadonlyDeep<{
  applicationId: ApplicationId
  documentIds: readonly string[]
  acceptedAt: string
  ipHmac: Uint8Array
  ipHmacKeyVersion: string
  userAgent: string | null
}>
export type AppendApplicationReviewInput = ReadonlyDeep<{
  applicationId: ApplicationId
  reviewerUserId: UserId
  decision: "approved" | "rejected"
  reasonCode: string
  reasonDetail: string | null
  requestId: string
  idempotencyKey: string
}>
export type TransitionUserCommand = ReadonlyDeep<
  CommandContext & {
    userId: UserId
    toState: User["account_state"]
  }
>
export type ReplacePasswordCommand = ReadonlyDeep<
  CommandContext & {
    userId: UserId
    argon2idHash: string
  }
>
export type CreateSessionInput = ReadonlyDeep<{
  userId: UserId
  channel: "native" | "web"
  deviceIdHash: Uint8Array | null
  refreshTokenHash: Uint8Array
  refreshKeyVersion: string
  expiresAt: string
}>
export type CreatedSession = ReadonlyDeep<{
  session: AuthSession
  refreshToken: AuthRefreshToken
}>
export type RefreshTokenWithSession = ReadonlyDeep<{
  session: AuthSession
  refreshToken: AuthRefreshToken
}>
export type RotateRefreshTokenCommand = ReadonlyDeep<
  CommandContext & {
    sessionId: string
    presentedRefreshHash: Uint8Array
    presentedCsrfHash: Uint8Array | null
    rotationId: string
    now: string
  }
>
export type RotatedSession = ReadonlyDeep<
  CreatedSession & {
    isReplay: boolean
    csrfTokenHash: Uint8Array | null
  }
>
export type RotateCsrfCommand = ReadonlyDeep<
  CommandContext & {
    sessionId: string
    currentRefreshHash: Uint8Array
    now: string
  }
>
export type ReplaceWebSessionCommand = ReadonlyDeep<CommandContext & { input: CreateSessionInput }>
export type ReplaceNativeSessionCommand = ReadonlyDeep<CommandContext & { input: CreateSessionInput }>
export type RevokeSessionFamilyCommand = ReadonlyDeep<CommandContext & { sessionId: string }>
export type RevokeWebSessionCommand = RevokeSessionFamilyCommand
export type RevokeNativeSessionCommand = RevokeSessionFamilyCommand
export type RevokeUserSessionsCommand = ReadonlyDeep<CommandContext & { userId: UserId }>
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
export type IncrementRateLimitWindowInput = ReadonlyDeep<{
  bucket: string
  keyHash: Uint8Array
  windowStart: string
  expiresAt: string
}>
export type RetentionTarget = ReadonlyDeep<{
  entityType: RetentionEntityType
  entityId: string
}>
export type PlaceLegalHoldCommand = ReadonlyDeep<
  CommandContext & {
    target: RetentionTarget
    reason: string
    expiresAt: string | null
  }
>
export type PlaceLegalHoldResult = ReadonlyDeep<{
  hold: LegalHold
  isAlreadyPurged: boolean
}>
export type ReleaseLegalHoldCommand = ReadonlyDeep<
  CommandContext & {
    legalHoldId: string
    releasedAt: string
  }
>
export type NewOutboxEvent = ReadonlyDeep<Omit<OutboxEvent, "id" | "created_at" | "updated_at">>
export type ClaimOutboxBatchCommand = ReadonlyDeep<{
  workerId: string
  now: string
  limit: number
}>
export type RecordOutboxResultCommand = ReadonlyDeep<{
  outboxEventId: string
  workerId: string
  result: "delivered" | "retryable_failed" | "dead_lettered" | "cancelled"
  errorCode: string | null
  now: string
}>
export type NewAuditEvent = ReadonlyDeep<Omit<AuditEvent, "id" | "created_at">>
export type CreateEmailDeliveryInput = ReadonlyDeep<
  Omit<EmailDelivery, "id" | "created_at" | "updated_at" | "version">
>
export type TransitionEmailDeliveryCommand = ReadonlyDeep<
  CommandContext & {
    emailDeliveryId: EmailDeliveryId
    toState: EmailDelivery["state"]
    occurredAt: string
    errorCode?: string
  }
>
export type VerifiedSnsInboxInput = ReadonlyDeep<{
  snsMessageId: string
  snsTopicArn: string
  snsType: string
  sesEventType: string | null
  sesMessageId: string | null
  deliveryCorrelationId: DeliveryCorrelationId | null
  payloadCiphertext: Uint8Array
  payloadNonce: Uint8Array
  payloadSha256: Uint8Array
  payloadKeyVersion: string
  expiresAt: string
}>
export type UpsertEmailSuppressionInput = ReadonlyDeep<{
  recipientHmac: Uint8Array
  suppressionHmacKeyVersion: string
  reason: "bounce" | "complaint"
  sourceEventId: string
}>

export interface ApplicationRepository {
  createSubmission(tx: Transaction, input: CreateApplicationInput): Promise<Application>
  lockById(tx: Transaction, applicationId: ApplicationId): Promise<Application | null>
  findQueuePage(tx: Transaction, query: ApplicationQueueQuery): Promise<CursorPage<ApplicationQueueItem>>
  findDetail(
    tx: Transaction,
    input: Readonly<{ applicationId: ApplicationId; deliveryQuery: CursorInput }>,
  ): Promise<ApplicationDetail | null>
  findActiveIdentityCollisions(
    tx: Transaction,
    input: Readonly<{ emailNormalized: string; phoneE164: string }>,
  ): Promise<ActiveIdentityCollision>
  withdraw(tx: Transaction, command: WithdrawApplicationCommand): Promise<Application>
}

export interface ConsentRepository {
  findCurrentDocuments(tx: Transaction, kinds: readonly ConsentKind[]): Promise<readonly ConsentDocument[]>
  recordAcceptances(
    tx: Transaction,
    input: Readonly<RecordConsentAcceptancesInput>,
  ): Promise<readonly ApplicationConsent[]>
  findForApplication(
    tx: Transaction,
    applicationId: ApplicationId,
  ): Promise<readonly ApplicationConsentDetail[]>
}

export interface ApplicationReviewRepository {
  append(tx: Transaction, input: Readonly<AppendApplicationReviewInput>): Promise<ApplicationReview>
  findForApplication(tx: Transaction, applicationId: ApplicationId): Promise<readonly ApplicationReview[]>
}

export interface UserRepository {
  createFromApprovedApplication(tx: Transaction, application: Application): Promise<User>
  lockById(tx: Transaction, userId: UserId): Promise<User | null>
  lockByNormalizedEmailWithCredential(
    tx: Transaction,
    emailNormalized: string,
  ): Promise<UserWithCredential | null>
  transitionAccount(tx: Transaction, command: TransitionUserCommand): Promise<User>
}

export interface CredentialRepository {
  exists(tx: Transaction, userId: UserId): Promise<boolean>
  create(tx: Transaction, userId: UserId, argon2idHash: string): Promise<UserCredential>
  replacePassword(tx: Transaction, command: ReplacePasswordCommand): Promise<UserCredential>
}

export interface AuthSessionRepository {
  create(tx: Transaction, input: CreateSessionInput): Promise<CreatedSession>
  lockActiveNativeByUserAndDeviceHash(
    tx: Transaction,
    input: Readonly<{ userId: UserId; deviceIdHash: Uint8Array }>,
  ): Promise<AuthSession | null>
  lockActiveBySid(tx: Transaction, sid: string): Promise<AuthSession | null>
  lockByRefreshTokenHash(tx: Transaction, hash: Uint8Array): Promise<RefreshTokenWithSession | null>
  replaceWebSession(tx: Transaction, command: ReplaceWebSessionCommand): Promise<CreatedSession>
  replaceNativeSession(tx: Transaction, command: ReplaceNativeSessionCommand): Promise<CreatedSession>
  rotate(tx: Transaction, command: RotateRefreshTokenCommand): Promise<RotatedSession>
  rotateCsrf(tx: Transaction, command: Readonly<RotateCsrfCommand>): Promise<AuthSession>
  revokeFamily(tx: Transaction, command: RevokeSessionFamilyCommand): Promise<AuthSession>
  revokeWebSession(tx: Transaction, command: RevokeWebSessionCommand): Promise<AuthSession>
  revokeNativeSession(tx: Transaction, command: RevokeNativeSessionCommand): Promise<AuthSession>
  revokeAllForUser(tx: Transaction, command: RevokeUserSessionsCommand): Promise<RevokeSessionsResult>
}

export interface RbacRepository {
  hasPermission(tx: Transaction, userId: UserId, permission: PermissionCode): Promise<boolean>
  findActiveRolePage(
    tx: Transaction,
    input: Readonly<{ userId: UserId; page: CursorInput }>,
  ): Promise<CursorPage<Role>>
  findActivePermissionPage(
    tx: Transaction,
    input: Readonly<{ userId: UserId; page: CursorInput }>,
  ): Promise<CursorPage<Permission>>
}

export interface IdempotencyRepository {
  tryAcquireTransactionLock(tx: Transaction, scope: Readonly<IdempotencyScope>): Promise<boolean>
  findCompleted(tx: Transaction, scope: Readonly<IdempotencyScope>): Promise<IdempotencyRecord | null>
  insertCompleted(tx: Transaction, input: Readonly<CompleteIdempotencyInput>): Promise<IdempotencyRecord>
}

export interface RateLimitRepository {
  incrementWindow(tx: Transaction, input: Readonly<IncrementRateLimitWindowInput>): Promise<RateLimitWindow>
}

export interface LegalHoldRepository {
  lockRetentionTarget(
    tx: Transaction,
    target: RetentionTarget,
  ): Promise<Readonly<{ exists: boolean; isAlreadyPurged: boolean }>>
  place(tx: Transaction, command: PlaceLegalHoldCommand): Promise<PlaceLegalHoldResult>
  release(tx: Transaction, command: ReleaseLegalHoldCommand): Promise<LegalHold>
  findActiveForEntities(
    tx: Transaction,
    entities: readonly Readonly<{ entityType: RetentionEntityType; entityId: string }>[],
  ): Promise<readonly LegalHold[]>
}

export interface RetentionRepository {
  findEligibleCleanupPage(tx: Transaction, query: CleanupCandidateQuery): Promise<CursorPage<CleanupCandidate>>
  applyCleanupIfStillEligible(
    tx: Transaction,
    command: Readonly<CleanupCandidate & { expectedPolicyVersion: string }>,
  ): Promise<Readonly<{ isApplied: boolean; isHeld: boolean }>>
}

export interface OutboxRepository {
  enqueue(tx: Transaction, event: NewOutboxEvent): Promise<OutboxEvent>
  claimBatch(tx: Transaction, command: ClaimOutboxBatchCommand): Promise<readonly OutboxEvent[]>
  recordResult(tx: Transaction, command: RecordOutboxResultCommand): Promise<OutboxEvent>
}

export interface AuditRepository {
  append(tx: Transaction, event: NewAuditEvent): Promise<AuditEvent>
}

export interface EmailDeliveryRepository {
  create(tx: Transaction, input: Readonly<CreateEmailDeliveryInput>): Promise<EmailDelivery>
  lockById(tx: Transaction, deliveryId: EmailDeliveryId): Promise<EmailDelivery | null>
  transition(tx: Transaction, command: Readonly<TransitionEmailDeliveryCommand>): Promise<EmailDelivery>
  findPage(tx: Transaction, query: EmailDeliveryQuery): Promise<CursorPage<EmailDelivery>>
  findPageForApplication(
    tx: Transaction,
    input: Readonly<{ applicationId: ApplicationId; page: CursorInput }>,
  ): Promise<CursorPage<EmailDelivery>>
}

export interface EmailProviderEventRepository {
  insertVerified(
    tx: Transaction,
    event: Readonly<VerifiedSnsInboxInput>,
  ): Promise<Readonly<{ eventId: string; isDuplicate: boolean }>>
  lockReceivedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>,
  ): Promise<readonly EmailProviderEvent[]>
  lockUnmatchedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>,
  ): Promise<readonly EmailProviderEvent[]>
  markProcessed(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markIgnored(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markUnmatched(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  reconcileUnmatched(
    tx: Transaction,
    input: Readonly<{ eventId: string; emailDeliveryId: EmailDeliveryId; processedAt: string }>,
  ): Promise<EmailProviderEvent>
}

export interface EmailSuppressionRepository {
  findAnyActive(
    tx: Transaction,
    candidates: readonly Readonly<{ recipientHmac: Uint8Array; suppressionHmacKeyVersion: string }>[],
  ): Promise<EmailSuppression | null>
  upsertFromSafetyEvent(
    tx: Transaction,
    input: Readonly<UpsertEmailSuppressionInput>,
  ): Promise<EmailSuppression>
}
