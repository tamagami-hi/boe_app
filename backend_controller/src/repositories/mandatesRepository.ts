import { sql } from "kysely"

import type { MandateCancelCommand, MandateCollectionAttempt, MandateSetupAttempt, PaymentMandate, SipPlan, Transaction } from "../db/repositories.js"
import type { MandateState, SipState } from "../db/types.js"
import {
  deriveSipStateForMandate,
  transitionMandateState,
  transitionNotifyState,
  transitionSetupState,
} from "../domain/payments/mandateStates.js"

export interface CreateMandateInput {
  readonly sipPlanId: string
  readonly userId: string
  readonly fundId: string
  readonly merchantSubscriptionId: string
  readonly maxAmountPaise: string
}

export interface CreateSetupAttemptInput {
  readonly mandateId: string
  readonly sipPlanId: string
  readonly userId: string
  readonly attemptNumber: number
  readonly merchantOrderId: string
  readonly setupExpiresAt: Date
  readonly canonicalPayment?: Readonly<{
    fundId: string
    amountPaise: string
    duePeriod: string
    orderId: string
    paymentId: string
    paymentAttemptId: string
  }>
}

export interface ClaimDispatchInput {
  readonly attemptId: string
  readonly userId: string
  readonly expectedVersion: string
  readonly now: Date
}

export interface PersistSetupDispatchInput {
  readonly merchantOrderId: string
  readonly expectedVersion: string
  readonly providerOrderId: string
  readonly tokenCiphertext: Buffer
  readonly tokenNonce: Buffer
  readonly tokenKeyVersion: string
  readonly tokenExpiresAt: Date
  readonly now: Date
}

export interface ApplyProviderSetupStateInput {
  readonly merchantOrderId: string
  readonly providerOrderId: string | null
  readonly expectedVersion: string
  readonly fromState: "dispatching" | "provider_pending"
  readonly toState: "authorized" | "failed" | "expired"
  readonly failureCode?: string
  readonly now: Date
}

export interface ApplyProviderMandateStateInput {
  readonly merchantSubscriptionId: string
  readonly providerSubscriptionId: string | null
  readonly expectedVersion: string
  readonly expectedSipVersion: string
  readonly fromState: MandateState
  readonly toState: MandateState
  readonly failureCode?: string
  readonly now: Date
}

export interface CreateCollectionAttemptInput {
  readonly mandateId: string
  readonly sipPlanId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly duePeriod: string
  readonly scheduledDebitAt: Date
  readonly notifyAt: Date
  readonly orderId: string
  readonly paymentId: string
  readonly paymentAttemptId: string
}

interface ProviderNotifyOutcomeInput {
  readonly paymentAttemptId: string
  readonly expectedVersion: string
  readonly toState: "notified" | "failed"
  readonly failureCode?: string
  readonly now: Date
}

export interface MandatesRepository {
  createMandate: (tx: Transaction, input: CreateMandateInput) => Promise<PaymentMandate>
  findMandateForOwner: (tx: Transaction, input: Readonly<{ mandateId: string; userId: string }>) => Promise<PaymentMandate | null>
  findMandateForAdmin: (tx: Transaction, mandateId: string) => Promise<PaymentMandate | null>
  findMandateByMerchantSubscription: (tx: Transaction, merchantSubscriptionId: string) => Promise<PaymentMandate | null>
  findCurrentMandateForOwner: (tx: Transaction, input: Readonly<{ sipPlanId: string; userId: string }>) => Promise<PaymentMandate | null>
  findLatestMandateForOwner: (tx: Transaction, input: Readonly<{ sipPlanId: string; userId: string }>) => Promise<PaymentMandate | null>
  findCancelCommandForOwner: (tx: Transaction, input: Readonly<{ sipPlanId: string; userId: string }>) => Promise<MandateCancelCommand | null>
  applyProviderMandateState: (tx: Transaction, input: ApplyProviderMandateStateInput) => Promise<Readonly<{ mandate: PaymentMandate; sip: SipPlan }> | null>
  activateAfterSuccessfulSetupPayment: (tx: Transaction, input: Readonly<{
    merchantSubscriptionId: string
    providerSubscriptionId: string
    now: Date
  }>) => Promise<Readonly<{ mandate: PaymentMandate; sip: SipPlan }> | null>
  requestSetupAbandonment: (tx: Transaction, input: Readonly<{
    mandateId: string
    expectedVersion: string
    now: Date
  }>) => Promise<PaymentMandate | null>
  bindProviderSubscriptionForAbandonment: (tx: Transaction, input: Readonly<{
    merchantSubscriptionId: string
    providerSubscriptionId: string
    now: Date
  }>) => Promise<PaymentMandate | null>
  createCancelCommand: (tx: Transaction, input: Readonly<{
    mandateId: string
    sipPlanId: string
    userId: string
    merchantSubscriptionId: string
    previousMandateState: "setup_pending" | "active" | "paused"
  }>) => Promise<MandateCancelCommand>
  requestTermCompletion: (tx: Transaction, input: Readonly<{ sipPlanId: string; now: Date }>) => Promise<boolean>
  listCancelDispatchCandidates: (tx: Transaction, limit: number) => Promise<readonly MandateCancelCommand[]>
  claimCancelDispatch: (tx: Transaction, input: Readonly<{
    commandId: string
    expectedVersion: string
    now: Date
  }>) => Promise<MandateCancelCommand | null>
  markCancelAccepted: (tx: Transaction, input: Readonly<{
    commandId: string
    expectedVersion: string
    now: Date
  }>) => Promise<MandateCancelCommand | null>
  markCancelSatisfied: (tx: Transaction, input: Readonly<{
    commandId: string
    expectedVersion: string
    now: Date
  }>) => Promise<MandateCancelCommand | null>
  recordCancelStatusObservation: (tx: Transaction, input: Readonly<{
    commandId: string
    expectedVersion: string
    providerState: "ACTIVE" | "PAUSED"
    escalationCutoff: Date
    now: Date
  }>) => Promise<MandateCancelCommand | null>
  rejectCancelAndRestore: (tx: Transaction, input: Readonly<{
    commandId: string
    expectedVersion: string
    failureCode: string
    now: Date
  }>) => Promise<MandateCancelCommand | null>
  createSetupAttempt: (tx: Transaction, input: CreateSetupAttemptInput) => Promise<MandateSetupAttempt>
  findSetupAttemptForOwner: (tx: Transaction, input: Readonly<{ attemptId: string; userId: string }>) => Promise<MandateSetupAttempt | null>
  findSetupAttemptForAdmin: (tx: Transaction, attemptId: string) => Promise<MandateSetupAttempt | null>
  findSetupAttemptByMerchantOrder: (tx: Transaction, merchantOrderId: string) => Promise<MandateSetupAttempt | null>
  findLatestSetupForOwner: (tx: Transaction, input: Readonly<{ sipPlanId: string; userId: string }>) => Promise<MandateSetupAttempt | null>
  listSetupReconciliationCandidates: (tx: Transaction, limit: number) => Promise<readonly MandateSetupAttempt[]>
  listMandateReconciliationCandidates: (tx: Transaction, limit: number) => Promise<readonly PaymentMandate[]>
  claimCanonicalSetupDispatch: (tx: Transaction, input: ClaimDispatchInput) => Promise<MandateSetupAttempt | null>
  expireUndispatchedSetup: (tx: Transaction, input: Readonly<{ merchantOrderId: string; expectedVersion: string; now: Date }>) => Promise<MandateSetupAttempt | null>
  abandonUndispatchedSetup: (tx: Transaction, input: Readonly<{ merchantOrderId: string; expectedVersion: string; now: Date }>) => Promise<MandateSetupAttempt | null>
  persistSetupDispatch: (tx: Transaction, input: PersistSetupDispatchInput) => Promise<MandateSetupAttempt | null>
  applyProviderSetupState: (tx: Transaction, input: ApplyProviderSetupStateInput) => Promise<MandateSetupAttempt | null>
  recordSetupNotFound: (tx: Transaction, input: Readonly<{ merchantOrderId: string; expectedVersion: string; now: Date }>) => Promise<MandateSetupAttempt | null>
  expireSetupAfterNotFoundGrace: (tx: Transaction, input: Readonly<{ merchantOrderId: string; expectedVersion: string; notFoundObservedBefore: Date; now: Date }>) => Promise<MandateSetupAttempt | null>
  createCollectionAttempt: (tx: Transaction, input: CreateCollectionAttemptInput) => Promise<MandateCollectionAttempt>
  findCollectionAttemptForOwner: (tx: Transaction, input: Readonly<{ attemptId: string; userId: string }>) => Promise<MandateCollectionAttempt | null>
  findCollectionAttemptForAdmin: (tx: Transaction, attemptId: string) => Promise<MandateCollectionAttempt | null>
  markCollectionAttemptReconciled: (tx: Transaction, input: Readonly<{ attemptId: string; now: Date }>) => Promise<MandateCollectionAttempt | null>
  findCollectionAttemptByMerchantOrder: (tx: Transaction, merchantOrderId: string) => Promise<MandateCollectionAttempt | null>
  listCollectionReconciliationCandidates: (tx: Transaction, limit: number) => Promise<readonly MandateCollectionAttempt[]>
  claimCollectionNotification: (tx: Transaction, input: ClaimDispatchInput & Readonly<{ fromState: "created" | "failed" }>) => Promise<MandateCollectionAttempt | null>
  applyProviderNotificationOutcome: (tx: Transaction, input: ProviderNotifyOutcomeInput) => Promise<MandateCollectionAttempt | null>
  failCollectionBeforeNotify: (tx: Transaction, input: Readonly<{
    attemptId: string
    expectedVersion: string
    failureCode: string
    now: Date
  }>) => Promise<MandateCollectionAttempt | null>
}

const CURRENT_MANDATE_STATES: readonly MandateState[] = ["setup_pending", "active", "pause_pending", "paused", "cancel_pending", "revoke_pending"]

const formatDateColumn = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`

const requireFailureCode = (state: MandateState | "authorized" | "expired", failureCode?: string): void => {
  if (state === "failed" && failureCode === undefined) {
    throw new Error("A provider failure code is required for a failed mandate state")
  }
}

const mandateValues = (input: ApplyProviderMandateStateInput) => ({
  state: transitionMandateState(input.fromState, input.toState),
  provider_subscription_id: input.providerSubscriptionId === null ? undefined : sql<string>`coalesce(provider_subscription_id, ${input.providerSubscriptionId})`,
  authorized_at: input.toState === "active" ? sql<Date>`coalesce(authorized_at, ${input.now})` : undefined,
  pause_requested_at: input.toState === "pause_pending" ? input.now : undefined,
  paused_at: input.toState === "paused" ? input.now : undefined,
  cancellation_requested_at: input.toState === "cancel_pending" ? input.now : undefined,
  revocation_requested_at: input.toState === "revoke_pending" ? input.now : undefined,
  cancelled_at: input.toState === "cancelled" ? input.now : undefined,
  revoked_at: input.toState === "revoked" ? input.now : undefined,
  expires_at: input.toState === "expired" ? input.now : undefined,
  failed_at: input.toState === "failed" ? input.now : undefined,
  failure_code: input.toState === "failed" ? input.failureCode : undefined,
  last_status_checked_at: input.now,
  updated_at: input.now,
  version: sql<string>`version + 1`,
})

const sipValues = (targetState: SipState, now: Date) => ({
  state: targetState,
  paused_at: targetState === "paused" ? now : undefined,
  cancelled_at: targetState === "cancelled" ? now : undefined,
  completed_at: targetState === "completed" ? now : undefined,
  updated_at: now,
  version: sql<string>`version + 1`,
})

const nextMonthlyDebitDate = (startDate: Date | string, debitDay: number): string => {
  const date = typeof startDate === "string" ? startDate.slice(0, 10) : startDate.toISOString().slice(0, 10)
  const [yearText, monthText] = date.split("-")
  const firstOfNextMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 1))
  const year = firstOfNextMonth.getUTCFullYear()
  const month = firstOfNextMonth.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(debitDay, lastDay))).toISOString().slice(0, 10)
}

const collectionIsValid = async (tx: Transaction, input: CreateCollectionAttemptInput): Promise<boolean> => {
  const result = await sql<{ valid: boolean }>`
    select exists (
      select 1 from sip_plans sip
      join payment_mandates mandate on mandate.id = ${input.mandateId}
      join investment_orders investment_order on investment_order.id = ${input.orderId}
      join payments payment on payment.id = ${input.paymentId}
      join payment_attempts payment_attempt on payment_attempt.id = ${input.paymentAttemptId}
      where sip.id = ${input.sipPlanId} and sip.user_id = ${input.userId} and sip.fund_id = ${input.fundId}
        and sip.collection_mode = 'phonepe_autopay' and sip.state = 'active'
        and mandate.sip_plan_id = sip.id and mandate.user_id = sip.user_id and mandate.fund_id = sip.fund_id
        and mandate.state = 'active' and mandate.provider_subscription_id is not null and mandate.amount_type = 'fixed'
        and investment_order.sip_plan_id = sip.id and investment_order.user_id = sip.user_id
        and investment_order.fund_id = sip.fund_id and investment_order.due_period = ${input.duePeriod}::date
        and investment_order.type = 'sip_installment' and investment_order.state = 'payment_pending'
        and payment.order_id = investment_order.id and payment.user_id = sip.user_id and payment.state = 'created'
        and payment_attempt.payment_id = payment.id and payment_attempt.user_id = sip.user_id
        and payment_attempt.state = 'created' and payment_attempt.checkout_channel = 'phonepe_autopay'
        and payment_attempt.provider_dispatch_started_at is null and payment_attempt.provider_order_id is null
        and sip.amount_paise = ${input.amountPaise}::bigint and mandate.max_amount_paise = ${input.amountPaise}::bigint
        and investment_order.amount_paise = ${input.amountPaise}::bigint and payment.amount_paise = ${input.amountPaise}::bigint
    ) as valid
  `.execute(tx)
  return result.rows[0]?.valid === true
}

const lockCollectionNotificationChain = async (
  tx: Transaction,
  input: ClaimDispatchInput & Readonly<{ fromState: "created" | "failed" }>,
): Promise<MandateCollectionAttempt | null> => {
  const candidate = await tx.selectFrom("mandate_collection_attempts").selectAll()
    .where("id", "=", input.attemptId).where("user_id", "=", input.userId).executeTakeFirst()
  if (candidate === undefined) return null
  await tx.selectFrom("sip_plans").select("id").where("id", "=", candidate.sip_plan_id).forUpdate().executeTakeFirstOrThrow()
  await tx.selectFrom("payment_mandates").select("id").where("id", "=", candidate.mandate_id).forUpdate().executeTakeFirstOrThrow()
  await tx.selectFrom("investment_orders").select("id").where("id", "=", candidate.order_id).forUpdate().executeTakeFirstOrThrow()
  await tx.selectFrom("payments").select("id").where("id", "=", candidate.payment_id).forUpdate().executeTakeFirstOrThrow()
  await tx.selectFrom("payment_attempts").select("id").where("id", "=", candidate.payment_attempt_id).forUpdate().executeTakeFirstOrThrow()
  const locked = await tx.selectFrom("mandate_collection_attempts").selectAll()
    .where("id", "=", candidate.id).where("version", "=", input.expectedVersion)
    .where("notify_state", "=", input.fromState).forUpdate().executeTakeFirst()
  if (locked === undefined) return null
  const isValid = await collectionIsValid(tx, {
    mandateId: locked.mandate_id,
    sipPlanId: locked.sip_plan_id,
    userId: locked.user_id,
    fundId: locked.fund_id,
    amountPaise: locked.amount_paise,
    duePeriod: formatDateColumn(locked.due_period),
    scheduledDebitAt: locked.scheduled_debit_at,
    notifyAt: locked.notify_at,
    orderId: locked.order_id,
    paymentId: locked.payment_id,
    paymentAttemptId: locked.payment_attempt_id,
  })
  return isValid ? locked : null
}

const lockSetupDispatchChain = async (
  tx: Transaction,
  input: ClaimDispatchInput,
): Promise<MandateSetupAttempt | null> => {
  const candidate = await tx.selectFrom("mandate_setup_attempts").selectAll()
    .where("id", "=", input.attemptId).where("user_id", "=", input.userId).executeTakeFirst()
  if (candidate === undefined) return null
  const sip = await tx.selectFrom("sip_plans").selectAll()
    .where("id", "=", candidate.sip_plan_id).where("user_id", "=", candidate.user_id)
    .forUpdate().executeTakeFirst()
  if (sip === undefined) return null
  const mandate = await tx.selectFrom("payment_mandates").selectAll()
    .where("id", "=", candidate.mandate_id).where("sip_plan_id", "=", candidate.sip_plan_id)
    .where("user_id", "=", candidate.user_id).forUpdate().executeTakeFirst()
  if (mandate === undefined) return null
  const setup = await tx.selectFrom("mandate_setup_attempts").selectAll()
    .where("id", "=", candidate.id).where("mandate_id", "=", candidate.mandate_id)
    .where("sip_plan_id", "=", candidate.sip_plan_id).where("user_id", "=", candidate.user_id)
    .where("version", "=", input.expectedVersion).where("state", "=", "created")
    .where("provider_dispatch_started_at", "is", null).where("setup_expires_at", ">", input.now)
    .forUpdate().executeTakeFirst()
  if (
    setup === undefined || sip.collection_mode !== "phonepe_autopay" ||
    sip.state !== "pending_mandate" || mandate.state !== "setup_pending" || mandate.abandonment_requested_at !== null
  ) return null
  return setup
}

export const createMandatesRepository = (): MandatesRepository => ({
  createMandate: async (tx, input) => tx.insertInto("payment_mandates").values({
    sip_plan_id: input.sipPlanId,
    user_id: input.userId,
    fund_id: input.fundId,
    provider: "phonepe",
    merchant_subscription_id: input.merchantSubscriptionId,
    amount_type: "fixed",
    max_amount_paise: input.maxAmountPaise,
    frequency: "monthly",
  }).returningAll().executeTakeFirstOrThrow(),

  findMandateForOwner: async (tx, input) => (await tx.selectFrom("payment_mandates").selectAll().where("id", "=", input.mandateId).where("user_id", "=", input.userId).executeTakeFirst()) ?? null,
  findMandateForAdmin: async (tx, mandateId) => (await tx.selectFrom("payment_mandates").selectAll().where("id", "=", mandateId).executeTakeFirst()) ?? null,
  findMandateByMerchantSubscription: async (tx, merchantSubscriptionId) => (await tx.selectFrom("payment_mandates").selectAll()
    .where("merchant_subscription_id", "=", merchantSubscriptionId).executeTakeFirst()) ?? null,
  findCurrentMandateForOwner: async (tx, input) => (await tx.selectFrom("payment_mandates").selectAll().where("sip_plan_id", "=", input.sipPlanId).where("user_id", "=", input.userId).where("state", "in", CURRENT_MANDATE_STATES).executeTakeFirst()) ?? null,
  findLatestMandateForOwner: async (tx, input) => (await tx.selectFrom("payment_mandates").selectAll()
    .where("sip_plan_id", "=", input.sipPlanId).where("user_id", "=", input.userId)
    .orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst()) ?? null,
  findCancelCommandForOwner: async (tx, input) => (await tx.selectFrom("mandate_cancel_commands").selectAll()
    .where("sip_plan_id", "=", input.sipPlanId).where("user_id", "=", input.userId)
    .orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst()) ?? null,

  applyProviderMandateState: async (tx, input) => {
    requireFailureCode(input.toState, input.failureCode)
    const identity = await tx.selectFrom("payment_mandates")
      .select(["id", "sip_plan_id", "user_id"])
      .where("merchant_subscription_id", "=", input.merchantSubscriptionId)
      .executeTakeFirst()
    if (identity === undefined) return null
    const currentSip = await tx.selectFrom("sip_plans").selectAll()
      .where("id", "=", identity.sip_plan_id).where("user_id", "=", identity.user_id)
      .where("collection_mode", "=", "phonepe_autopay").forUpdate().executeTakeFirst()
    if (currentSip === undefined || currentSip.version !== input.expectedSipVersion) return null
    const currentMandate = await tx.selectFrom("payment_mandates").selectAll()
      .where("id", "=", identity.id).forUpdate().executeTakeFirst()
    if (
      currentMandate === undefined || currentMandate.version !== input.expectedVersion ||
      currentMandate.state !== input.fromState ||
      (
        input.providerSubscriptionId === null
          ? currentMandate.provider_subscription_id !== null
          : currentMandate.provider_subscription_id !== null &&
            currentMandate.provider_subscription_id !== input.providerSubscriptionId
      )
    ) return null
    transitionMandateState(input.fromState, input.toState)
    const derivedSipState = deriveSipStateForMandate(
      currentSip.state,
      input.toState,
      currentMandate.authorized_at !== null || input.toState === "active",
    )
    const targetSipState = input.toState === "cancelled" && currentMandate.completion_requested_at !== null
      ? "completed"
      : derivedSipState
    const mandate = await tx.updateTable("payment_mandates").set(mandateValues(input))
      .where("id", "=", currentMandate.id).where("version", "=", input.expectedVersion)
      .returningAll().executeTakeFirstOrThrow()
    const scheduleValues = input.toState === "active"
      ? { next_due_date: currentSip.duration_months === 1 || currentSip.start_date === null ? null : nextMonthlyDebitDate(currentSip.start_date, currentSip.debit_day) }
      : {}
    const sip = await tx.updateTable("sip_plans").set({ ...sipValues(targetSipState, input.now), ...scheduleValues })
      .where("id", "=", currentSip.id).where("version", "=", input.expectedSipVersion)
      .returningAll().executeTakeFirstOrThrow()
    return { mandate, sip }
  },

  activateAfterSuccessfulSetupPayment: async (tx, input) => {
    const mandate = await tx.selectFrom("payment_mandates").selectAll()
      .where("merchant_subscription_id", "=", input.merchantSubscriptionId).executeTakeFirst()
    if (mandate === undefined) return null
    const setup = await tx.selectFrom("mandate_setup_attempts").selectAll()
      .where("mandate_id", "=", mandate.id).where("state", "=", "authorized")
      .orderBy("attempt_number", "desc").executeTakeFirst()
    if (setup?.payment_id === null || setup?.payment_id === undefined) return null
    const payment = await tx.selectFrom("payments").select(["id", "state"])
      .where("id", "=", setup.payment_id).executeTakeFirst()
    if (payment?.state !== "succeeded") return null
    if (mandate.state === "active") {
      const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", mandate.sip_plan_id).executeTakeFirst()
      return sip === undefined ? null : { mandate, sip }
    }
    if (mandate.state !== "setup_pending" || mandate.abandonment_requested_at !== null) return null
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", mandate.sip_plan_id).executeTakeFirst()
    if (sip === undefined) return null
    return createMandatesRepository().applyProviderMandateState(tx, {
      merchantSubscriptionId: input.merchantSubscriptionId,
      providerSubscriptionId: input.providerSubscriptionId,
      expectedVersion: mandate.version,
      expectedSipVersion: sip.version,
      fromState: "setup_pending",
      toState: "active",
      now: input.now,
    })
  },

  requestSetupAbandonment: async (tx, input) => (await tx.updateTable("payment_mandates").set({
    abandonment_requested_at: input.now,
    cancellation_requested_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.mandateId).where("version", "=", input.expectedVersion)
    .where("state", "=", "setup_pending").where("abandonment_requested_at", "is", null)
    .returningAll().executeTakeFirst()) ?? null,

  bindProviderSubscriptionForAbandonment: async (tx, input) => (await tx.updateTable("payment_mandates").set({
    provider_subscription_id: sql<string>`coalesce(provider_subscription_id, ${input.providerSubscriptionId})`,
    last_status_checked_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("merchant_subscription_id", "=", input.merchantSubscriptionId)
    .where("state", "=", "setup_pending").where("abandonment_requested_at", "is not", null)
    .where((expression) => expression.or([
      expression("provider_subscription_id", "is", null),
      expression("provider_subscription_id", "=", input.providerSubscriptionId),
    ])).returningAll().executeTakeFirst()) ?? null,

  createCancelCommand: async (tx, input) => tx.insertInto("mandate_cancel_commands").values({
    mandate_id: input.mandateId,
    sip_plan_id: input.sipPlanId,
    user_id: input.userId,
    merchant_subscription_id: input.merchantSubscriptionId,
    previous_mandate_state: input.previousMandateState,
  }).returningAll().executeTakeFirstOrThrow(),

  requestTermCompletion: async (tx, input) => {
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", input.sipPlanId)
      .where("state", "=", "active").where("collection_mode", "=", "phonepe_autopay").forUpdate().executeTakeFirst()
    if (sip === undefined || sip.duration_months === null) return false
    const mandate = await tx.selectFrom("payment_mandates").selectAll().where("sip_plan_id", "=", sip.id)
      .where("state", "=", "active").forUpdate().executeTakeFirst()
    if (mandate === undefined || mandate.provider_subscription_id === null) return false
    const count = await tx.selectFrom("investment_orders").select(({ fn }) => fn.countAll<string>().as("count"))
      .where("sip_plan_id", "=", sip.id).where("type", "=", "sip_installment").where("state", "=", "accepted").executeTakeFirstOrThrow()
    if (Number(count.count) < sip.duration_months) return false
    const updatedMandate = await tx.updateTable("payment_mandates").set({
      state: transitionMandateState("active", "cancel_pending"),
      cancellation_requested_at: input.now,
      completion_requested_at: input.now,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", mandate.id).where("version", "=", mandate.version).where("state", "=", "active")
      .returningAll().executeTakeFirst()
    if (updatedMandate === undefined) return false
    const updatedSip = await tx.updateTable("sip_plans").set({
      state: "cancel_pending",
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", sip.id).where("version", "=", sip.version).where("state", "=", "active")
      .returningAll().executeTakeFirst()
    if (updatedSip === undefined) throw new Error("SIP term completion transition failed")
    await tx.insertInto("mandate_cancel_commands").values({
      mandate_id: mandate.id,
      sip_plan_id: sip.id,
      user_id: sip.user_id,
      merchant_subscription_id: mandate.merchant_subscription_id,
      previous_mandate_state: "active",
    }).executeTakeFirstOrThrow()
    return true
  },

  listCancelDispatchCandidates: async (tx, limit) => tx.selectFrom("mandate_cancel_commands").selectAll()
    .where("state", "in", ["queued", "dispatching", "reconciliation_required"]).orderBy("updated_at").orderBy("id").limit(limit).execute(),

  claimCancelDispatch: async (tx, input) => {
    const identity = await tx.selectFrom("mandate_cancel_commands").select(["mandate_id", "sip_plan_id"])
      .where("id", "=", input.commandId).executeTakeFirst()
    if (identity === undefined) return null
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", identity.sip_plan_id).forUpdate().executeTakeFirst()
    const mandate = await tx.selectFrom("payment_mandates").selectAll().where("id", "=", identity.mandate_id).forUpdate().executeTakeFirst()
    const command = await tx.selectFrom("mandate_cancel_commands").selectAll().where("id", "=", input.commandId)
      .where("version", "=", input.expectedVersion).where("state", "=", "queued").forUpdate().executeTakeFirst()
    if (sip === undefined || mandate === undefined || command === undefined || mandate.provider_subscription_id === null) return null
    const valid = command.previous_mandate_state === "setup_pending"
      ? mandate.state === "setup_pending" && mandate.abandonment_requested_at !== null
      : mandate.state === "cancel_pending" && sip.state === "cancel_pending"
    if (!valid) return null
    return (await tx.updateTable("mandate_cancel_commands").set({
      state: "dispatching",
      dispatch_started_at: input.now,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", command.id).where("version", "=", command.version).where("state", "=", "queued")
      .returningAll().executeTakeFirst()) ?? null
  },

  markCancelAccepted: async (tx, input) => (await tx.updateTable("mandate_cancel_commands").set({
    state: "accepted",
    accepted_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.commandId).where("version", "=", input.expectedVersion)
    .where("state", "=", "dispatching").returningAll().executeTakeFirst()) ?? null,

  markCancelSatisfied: async (tx, input) => (await tx.updateTable("mandate_cancel_commands").set({
    state: "accepted",
    dispatch_started_at: sql<Date>`coalesce(dispatch_started_at, ${input.now})`,
    accepted_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.commandId).where("version", "=", input.expectedVersion)
    .where("state", "in", ["queued", "dispatching", "reconciliation_required"]).returningAll().executeTakeFirst()) ?? null,

  recordCancelStatusObservation: async (tx, input) => {
    const command = await tx.selectFrom("mandate_cancel_commands").selectAll()
      .where("id", "=", input.commandId).where("version", "=", input.expectedVersion)
      .where("state", "=", "dispatching").forUpdate().executeTakeFirst()
    if (command === undefined) return null
    const observationCount = command.status_check_count + 1
    const shouldEscalate = observationCount >= 2 && new Date(command.dispatch_started_at as Date) <= input.escalationCutoff
    return (await tx.updateTable("mandate_cancel_commands").set({
      state: shouldEscalate ? "reconciliation_required" : "dispatching",
      status_check_count: observationCount,
      last_status_checked_at: input.now,
      reconciliation_required_at: shouldEscalate ? input.now : null,
      failure_code: shouldEscalate ? `PROVIDER_STILL_${input.providerState}` : null,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", command.id).where("version", "=", command.version).where("state", "=", "dispatching")
      .returningAll().executeTakeFirst()) ?? null
  },

  rejectCancelAndRestore: async (tx, input) => {
    const identity = await tx.selectFrom("mandate_cancel_commands").select(["mandate_id", "sip_plan_id"])
      .where("id", "=", input.commandId).executeTakeFirst()
    if (identity === undefined) return null
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", identity.sip_plan_id).forUpdate().executeTakeFirst()
    const mandate = await tx.selectFrom("payment_mandates").selectAll().where("id", "=", identity.mandate_id).forUpdate().executeTakeFirst()
    const command = await tx.selectFrom("mandate_cancel_commands").selectAll().where("id", "=", input.commandId)
      .where("version", "=", input.expectedVersion).where("state", "=", "dispatching").forUpdate().executeTakeFirst()
    if (sip === undefined || mandate === undefined || command === undefined) return null
    if (command.previous_mandate_state === "setup_pending") {
      await tx.updateTable("payment_mandates").set({
        abandonment_requested_at: null,
        cancellation_requested_at: null,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      }).where("id", "=", mandate.id).where("state", "=", "setup_pending").execute()
    } else {
      const restored = await createMandatesRepository().applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        providerSubscriptionId: mandate.provider_subscription_id,
        expectedVersion: mandate.version,
        expectedSipVersion: sip.version,
        fromState: "cancel_pending",
        toState: command.previous_mandate_state,
        now: input.now,
      })
      if (restored !== null && mandate.completion_requested_at !== null) {
        await tx.updateTable("payment_mandates").set({
          completion_requested_at: null,
          updated_at: input.now,
          version: sql<string>`version + 1`,
        }).where("id", "=", mandate.id).where("version", "=", restored.mandate.version).execute()
      }
    }
    return (await tx.updateTable("mandate_cancel_commands").set({
      state: "rejected",
      rejected_at: input.now,
      failure_code: input.failureCode,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", command.id).where("version", "=", command.version).where("state", "=", "dispatching")
      .returningAll().executeTakeFirst()) ?? null
  },

  createSetupAttempt: async (tx, input) => tx.insertInto("mandate_setup_attempts").values({
    mandate_id: input.mandateId,
    sip_plan_id: input.sipPlanId,
    user_id: input.userId,
    attempt_number: input.attemptNumber,
    provider: "phonepe",
    merchant_order_id: input.merchantOrderId,
    setup_expires_at: input.setupExpiresAt,
    fund_id: input.canonicalPayment?.fundId,
    amount_paise: input.canonicalPayment?.amountPaise,
    due_period: input.canonicalPayment?.duePeriod,
    order_id: input.canonicalPayment?.orderId,
    payment_id: input.canonicalPayment?.paymentId,
    payment_attempt_id: input.canonicalPayment?.paymentAttemptId,
    checkout_channel: input.canonicalPayment === undefined ? undefined : "phonepe_mandate_setup",
  }).returningAll().executeTakeFirstOrThrow(),

  findSetupAttemptForOwner: async (tx, input) => (await tx.selectFrom("mandate_setup_attempts").selectAll().where("id", "=", input.attemptId).where("user_id", "=", input.userId).executeTakeFirst()) ?? null,
  findSetupAttemptForAdmin: async (tx, attemptId) => (await tx.selectFrom("mandate_setup_attempts").selectAll().where("id", "=", attemptId).executeTakeFirst()) ?? null,
  findSetupAttemptByMerchantOrder: async (tx, merchantOrderId) => (await tx.selectFrom("mandate_setup_attempts").selectAll()
    .where("merchant_order_id", "=", merchantOrderId).executeTakeFirst()) ?? null,
  findLatestSetupForOwner: async (tx, input) => (await tx.selectFrom("mandate_setup_attempts").selectAll()
    .where("sip_plan_id", "=", input.sipPlanId).where("user_id", "=", input.userId)
    .orderBy("attempt_number", "desc").executeTakeFirst()) ?? null,
  listSetupReconciliationCandidates: async (tx, limit) => tx.selectFrom("mandate_setup_attempts").selectAll()
    .where("state", "in", ["created", "dispatching", "provider_pending"])
    .orderBy("updated_at").orderBy("id").limit(limit).execute(),
  listMandateReconciliationCandidates: async (tx, limit) => tx.selectFrom("payment_mandates").selectAll()
    .where("state", "in", ["setup_pending", "active", "pause_pending", "paused", "cancel_pending", "revoke_pending"])
    .orderBy("updated_at").orderBy("id").limit(limit).execute(),

  claimCanonicalSetupDispatch: async (tx, input) => {
    const setup = await lockSetupDispatchChain(tx, input)
    if (
      setup === null || setup.fund_id === null || setup.amount_paise === null || setup.due_period === null ||
      setup.order_id === null || setup.payment_id === null || setup.payment_attempt_id === null ||
      setup.checkout_channel !== "phonepe_mandate_setup"
    ) return null
    return (await tx.updateTable("mandate_setup_attempts").set({
      state: transitionSetupState("created", "dispatching"),
      provider_dispatch_started_at: input.now,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", setup.id).where("version", "=", setup.version)
      .where("state", "=", "created").where("provider_dispatch_started_at", "is", null)
      .where("setup_expires_at", ">", input.now).returningAll().executeTakeFirst()) ?? null
  },

  expireUndispatchedSetup: async (tx, input) => (await tx.updateTable("mandate_setup_attempts").set({
    state: transitionSetupState("created", "expired"),
    last_status_checked_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
    .where("state", "=", "created").where("provider_dispatch_started_at", "is", null)
    .where("setup_expires_at", "<=", input.now).returningAll().executeTakeFirst()) ?? null,

  abandonUndispatchedSetup: async (tx, input) => (await tx.updateTable("mandate_setup_attempts").set({
    state: transitionSetupState("created", "expired"),
    failure_code: null,
    last_status_checked_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
    .where("state", "=", "created").where("provider_dispatch_started_at", "is", null)
    .returningAll().executeTakeFirst()) ?? null,

  persistSetupDispatch: async (tx, input) => {
    transitionSetupState("dispatching", "provider_pending")
    if (input.tokenExpiresAt.getTime() <= input.now.getTime()) throw new Error("Mandate setup token must expire in the future")
    return (await tx.updateTable("mandate_setup_attempts").set({
      state: "provider_pending",
      provider_order_id: input.providerOrderId,
      sdk_order_token_ciphertext: input.tokenCiphertext,
      sdk_order_token_nonce: input.tokenNonce,
      sdk_order_token_key_version: input.tokenKeyVersion,
      sdk_order_token_expires_at: input.tokenExpiresAt,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
      .where("state", "=", "dispatching").where("setup_expires_at", ">", input.now)
      .where("setup_expires_at", ">=", input.tokenExpiresAt).returningAll().executeTakeFirst()) ?? null
  },

  applyProviderSetupState: async (tx, input) => {
    requireFailureCode(input.toState, input.failureCode)
    let query = tx.updateTable("mandate_setup_attempts").set({
      state: transitionSetupState(input.fromState, input.toState),
      provider_order_id: input.providerOrderId === null ? undefined : sql<string>`coalesce(provider_order_id, ${input.providerOrderId})`,
      failure_code: input.toState === "failed" ? input.failureCode : undefined,
      last_status_checked_at: input.now,
      provider_dispatch_started_at: input.toState === "expired" ? null : undefined,
      sdk_order_token_ciphertext: null,
      sdk_order_token_nonce: null,
      sdk_order_token_key_version: null,
      sdk_order_token_expires_at: null,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
      .where("state", "=", input.fromState)
    query = input.providerOrderId === null
      ? query.where("provider_order_id", "is", null)
      : query.where((expression) => expression.or([
          expression("provider_order_id", "is", null),
          expression("provider_order_id", "=", input.providerOrderId as string),
        ]))
    return (await query.returningAll().executeTakeFirst()) ?? null
  },

  recordSetupNotFound: async (tx, input) => (await tx.updateTable("mandate_setup_attempts").set({
    not_found_first_observed_at: sql<Date>`coalesce(not_found_first_observed_at, ${input.now})`,
    last_status_checked_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
    .where("state", "in", ["dispatching", "provider_pending"]).returningAll().executeTakeFirst()) ?? null,

  expireSetupAfterNotFoundGrace: async (tx, input) => (await tx.updateTable("mandate_setup_attempts").set({
    state: transitionSetupState("dispatching", "expired"),
    provider_dispatch_started_at: null,
    sdk_order_token_ciphertext: null,
    sdk_order_token_nonce: null,
    sdk_order_token_key_version: null,
    sdk_order_token_expires_at: null,
    last_status_checked_at: input.now,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("merchant_order_id", "=", input.merchantOrderId).where("version", "=", input.expectedVersion)
    .where("state", "in", ["dispatching", "provider_pending"]).where("setup_expires_at", "<=", input.now)
    .where("not_found_first_observed_at", "<=", input.notFoundObservedBefore).returningAll().executeTakeFirst()) ?? null,

  createCollectionAttempt: async (tx, input) => {
    if (!(await collectionIsValid(tx, input))) throw new Error("Mandate collection provenance or pre-dispatch state is invalid")
    return tx.insertInto("mandate_collection_attempts").values({
      mandate_id: input.mandateId,
      sip_plan_id: input.sipPlanId,
      user_id: input.userId,
      fund_id: input.fundId,
      amount_paise: input.amountPaise,
      due_period: input.duePeriod,
      scheduled_debit_at: input.scheduledDebitAt,
      notify_at: input.notifyAt,
      order_id: input.orderId,
      payment_id: input.paymentId,
      payment_attempt_id: input.paymentAttemptId,
      retry_strategy: "standard",
    }).returningAll().executeTakeFirstOrThrow()
  },

  findCollectionAttemptForOwner: async (tx, input) => (await tx.selectFrom("mandate_collection_attempts").selectAll().where("id", "=", input.attemptId).where("user_id", "=", input.userId).executeTakeFirst()) ?? null,
  findCollectionAttemptForAdmin: async (tx, attemptId) => (await tx.selectFrom("mandate_collection_attempts").selectAll().where("id", "=", attemptId).executeTakeFirst()) ?? null,
  markCollectionAttemptReconciled: async (tx, input) => (await tx.updateTable("mandate_collection_attempts").set({
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.attemptId).returningAll().executeTakeFirst()) ?? null,
  findCollectionAttemptByMerchantOrder: async (tx, merchantOrderId) => (await tx.selectFrom("mandate_collection_attempts").innerJoin("payment_attempts", "payment_attempts.id", "mandate_collection_attempts.payment_attempt_id")
    .selectAll("mandate_collection_attempts").where("payment_attempts.merchant_order_id", "=", merchantOrderId).executeTakeFirst()) ?? null,
  listCollectionReconciliationCandidates: async (tx, limit) => tx.selectFrom("mandate_collection_attempts")
    .innerJoin("payment_attempts", "payment_attempts.id", "mandate_collection_attempts.payment_attempt_id")
    .selectAll("mandate_collection_attempts").where("mandate_collection_attempts.notify_state", "in", ["dispatching", "notified"])
    .where("payment_attempts.state", "in", ["created", "provider_pending"])
    .orderBy("mandate_collection_attempts.updated_at").orderBy("mandate_collection_attempts.id").limit(limit).execute(),

  claimCollectionNotification: async (tx, input) => {
    const locked = await lockCollectionNotificationChain(tx, input)
    if (locked === null) return null
    return (await tx.updateTable("mandate_collection_attempts").set({
      notify_state: transitionNotifyState(input.fromState, "dispatching"),
      notify_dispatch_started_at: input.now,
      notify_failure_code: null,
      updated_at: input.now,
      version: sql<string>`version + 1`,
    }).where("id", "=", locked.id).where("version", "=", locked.version)
      .where("notify_state", "=", input.fromState).returningAll().executeTakeFirst()) ?? null
  },

  applyProviderNotificationOutcome: async (tx, input) => (await tx.updateTable("mandate_collection_attempts").set({
    notify_state: transitionNotifyState("dispatching", input.toState),
    notified_at: input.toState === "notified" ? input.now : undefined,
    notify_failure_code: input.toState === "failed" ? input.failureCode : null,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("payment_attempt_id", "=", input.paymentAttemptId)
    .where("version", "=", input.expectedVersion).where("notify_state", "=", "dispatching")
    .returningAll().executeTakeFirst()) ?? null,

  failCollectionBeforeNotify: async (tx, input) => (await tx.updateTable("mandate_collection_attempts").set({
    notify_state: transitionNotifyState("created", "failed"),
    notify_dispatch_started_at: input.now,
    notify_failure_code: input.failureCode,
    updated_at: input.now,
    version: sql<string>`version + 1`,
  }).where("id", "=", input.attemptId).where("version", "=", input.expectedVersion)
    .where("notify_state", "=", "created").returningAll().executeTakeFirst()) ?? null,
})
