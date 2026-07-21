/**
 * Project repository interfaces (spec 03 §7). These are project-defined
 * contracts, not claims about Kysely or any third-party API. Inputs and outputs
 * are readonly; implementations return new objects and never mutate arguments or
 * cached values. Repositories receive a caller-owned transaction handle and
 * never begin, commit, or roll back transactions, and never call providers.
 *
 * This module is the type-only contract. Implementations land with the consuming
 * command/route batches (BE-008+), where they are exercised by behavioral
 * integration tests. Numeric ceilings referenced in comments (MAX_QUERY_LIMIT,
 * MAX_OUTBOX_CLAIM, ...) are defined in `./limits.ts`.
 */
import type { Kysely, Selectable } from "kysely"

import type { Database } from "./types.js"

/** The project alias for a caller-owned Kysely transaction handle. */
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
export type VerificationToken = Row<"verification_tokens">
export type ApplicationReview = Row<"application_reviews">
export type User = Row<"users">
export type UserCredential = Row<"user_credentials">
export type ActivationInvite = Row<"activation_invites">
export type AuthSession = Row<"auth_sessions">
export type AuthRefreshToken = Row<"auth_refresh_tokens">
export type Role = Row<"roles">
export type Permission = Row<"permissions">
export type RolePermission = Row<"role_permissions">
export type UserRole = Row<"user_roles">
export type ApprovalAction = Row<"approval_actions">
export type AuditEvent = Row<"audit_events">
export type IdempotencyRecord = Row<"idempotency_records">
export type RateLimitWindow = Row<"rate_limit_windows">
export type LegalHold = Row<"legal_holds">
export type OutboxEvent = Row<"outbox_events">
export type EmailDelivery = Row<"email_deliveries">
export type EmailProviderEvent = Row<"email_provider_events">
export type EmailSuppression = Row<"email_suppressions">
// Later domain (migrations 014-018; spec 03 §4)
export type InvestorProfile = Row<"investor_profiles">
export type KycCase = Row<"kyc_cases">
export type KycVerificationCode = Row<"kyc_verification_codes">
export type KycDocument = Row<"kyc_documents">
export type KycReview = Row<"kyc_reviews">
export type RiskAssessment = Row<"risk_assessments">
export type Fund = Row<"funds">
export type FundVersion = Row<"fund_versions">
export type FundDisclosureVersion = Row<"fund_disclosure_versions">
export type FundNavPrice = Row<"fund_nav_prices">
export type FundPosition = Row<"fund_positions">
export type FundAumSnapshot = Row<"fund_aum_snapshots">
export type FinancePolicyVersion = Row<"finance_policy_versions">
export type MarketingLead = Row<"marketing_leads">
export type Course = Row<"courses">
export type MembershipPlan = Row<"membership_plans">
export type AppConfigVersion = Row<"app_config_versions">
export type ContentItem = Row<"content_items">
export type Mandate = Row<"mandates">
export type SipPlan = Row<"sip_plans">
export type InvestmentOrder = Row<"investment_orders">
export type InvestmentExecution = Row<"investment_executions">
export type Holding = Row<"holdings">
export type HoldingLot = Row<"holding_lots">
export type HoldingLotMovement = Row<"holding_lot_movements">
export type RedemptionRequest = Row<"redemption_requests">
export type Payment = Row<"payments">
export type PaymentAttempt = Row<"payment_attempts">
export type ProviderEvent = Row<"provider_events">
export type Notification = Row<"notifications">

export type CursorInput = ReadonlyDeep<{
  after?: string
  /** validated integer 1..MAX_QUERY_LIMIT */
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
  | "investor_profile"
  | "kyc_case"
  | "risk_assessment"
  | "marketing_lead"
  | "investment_order"
  | "payment"
  | "mandate"
export type CleanupRecordType =
  | RetentionEntityType
  | "verification_token"
  | "activation_invite"
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
  /** validated integer 1..MAX_QUERY_LIMIT */
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
export type VerifyEmailCommand = ReadonlyDeep<
  CommandContext & {
    applicationId: ApplicationId
    tokenId: string
    verifiedAt: string
  }
>
export type StartReviewCommand = ReadonlyDeep<CommandContext & { applicationId: ApplicationId }>
export type DecideApplicationCommand = ReadonlyDeep<
  CommandContext & {
    applicationId: ApplicationId
    decision: "approved" | "rejected"
  }
>
export type WithdrawApplicationCommand = ReadonlyDeep<
  CommandContext & {
    applicationId: ApplicationId
    applicantRequestEvidence: string
  }
>
export type ApplicationDecisionResult = ReadonlyDeep<{
  application: Application
  review: ApplicationReview
  user: User | null
  activationInvite: ActivationInvite | null
  emailDelivery: EmailDelivery
}>
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
export type CreateVerificationTokenInput = ReadonlyDeep<{
  applicationId: ApplicationId | null
  userId: UserId | null
  purpose: VerificationToken["purpose"]
  tokenHash: Uint8Array
  tokenKeyVersion: string
  expiresAt: string
}>
export type ConsumeTokenCommand = ReadonlyDeep<
  CommandContext & {
    tokenId: string
    consumedAt: string
  }
>
export type VerificationSubject = ReadonlyDeep<{
  applicationId?: ApplicationId
  userId?: UserId
  purpose: VerificationToken["purpose"]
  reason: string
}>
export type TransitionUserCommand = ReadonlyDeep<
  CommandContext & {
    userId: UserId
    toState: User["account_state"]
  }
>
export type CreateActivationInviteInput = ReadonlyDeep<{
  userId: UserId
  applicationId: ApplicationId
  tokenHash: Uint8Array
  tokenKeyVersion: string
  expiresAt: string
  createdByUserId: UserId | null
}>
export type RevokeInviteCommand = ReadonlyDeep<CommandContext & { inviteId: string }>
export type AcceptInviteCommand = ReadonlyDeep<
  CommandContext & {
    inviteId: string
    acceptedAt: string
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
  /** validated integer 1..MAX_OUTBOX_CLAIM */
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
  markEmailVerified(tx: Transaction, command: VerifyEmailCommand): Promise<Application>
  startReview(tx: Transaction, command: StartReviewCommand): Promise<Application>
  withdraw(tx: Transaction, command: WithdrawApplicationCommand): Promise<Application>
  recordDecision(tx: Transaction, command: DecideApplicationCommand): Promise<ApplicationDecisionResult>
}

export interface ConsentRepository {
  findCurrentDocuments(tx: Transaction, kinds: readonly ConsentKind[]): Promise<readonly ConsentDocument[]>
  recordAcceptances(
    tx: Transaction,
    input: Readonly<RecordConsentAcceptancesInput>,
  ): Promise<readonly ApplicationConsent[]>
  /** joins each immutable referenced document; hard maximum MAX_APPLICATION_CONSENTS */
  findForApplication(
    tx: Transaction,
    applicationId: ApplicationId,
  ): Promise<readonly ApplicationConsentDetail[]>
}

export interface ApplicationReviewRepository {
  append(tx: Transaction, input: Readonly<AppendApplicationReviewInput>): Promise<ApplicationReview>
  /** hard maximum MAX_APPLICATION_REVIEWS */
  findForApplication(tx: Transaction, applicationId: ApplicationId): Promise<readonly ApplicationReview[]>
}

export interface VerificationTokenRepository {
  create(tx: Transaction, input: CreateVerificationTokenInput): Promise<VerificationToken>
  lockByHash(tx: Transaction, tokenHash: Uint8Array): Promise<VerificationToken | null>
  consume(tx: Transaction, command: ConsumeTokenCommand): Promise<VerificationToken>
  revokeOutstanding(tx: Transaction, subject: VerificationSubject): Promise<readonly VerificationToken[]>
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

export interface ActivationInviteRepository {
  lockCurrent(tx: Transaction, userId: UserId): Promise<ActivationInvite | null>
  lockByTokenHash(tx: Transaction, tokenHash: Uint8Array): Promise<ActivationInvite | null>
  revokeCurrent(tx: Transaction, command: RevokeInviteCommand): Promise<ActivationInvite>
  create(tx: Transaction, input: CreateActivationInviteInput): Promise<ActivationInvite>
  accept(tx: Transaction, command: AcceptInviteCommand): Promise<ActivationInvite>
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
  /** hard maximum MAX_QUERY_LIMIT */
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
  /** limit capped at MAX_EMAIL_DELIVERIES_PER_APPLICATION */
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
  /** limit 1..MAX_PROVIDER_EVENT_CLAIM */
  lockReceivedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>,
  ): Promise<readonly EmailProviderEvent[]>
  /** limit 1..MAX_PROVIDER_EVENT_CLAIM */
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
