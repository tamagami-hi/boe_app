/**
 * SIP client commands (spec 03 §5.2). A SIP is a recurring purchase schedule.
 * Lifecycle: `createSip` (draft) -> `requestSipMandate` (pending_mandate, creates
 * the debit mandate) -> mandate authorized -> active (see activateMandate) ->
 * the scheduler generates installment orders. `pauseSip` / `resumeSip` /
 * `cancelSip` are owner controls. Eligibility is re-derived under lock at create
 * time (spec 03 §2.3), like one-time orders.
 */
import type { Mandate, SipPlan, Transaction, UserId } from "../../db/repositories.js"
import type { UserAccountState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { MandateWriteRepository } from "../../repositories/mandateRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { SipWriteRepository } from "../../repositories/sipRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { deriveInvestingEligibility, type EligibilityInputs } from "./investingEligibility.js"

const assertEligible = (accountState: UserAccountState, kyc: EligibilityInputs["kyc"], now: Date): void => {
  const { eligibility } = deriveInvestingEligibility({ accountState, kyc, now })
  if (eligibility === "eligible") return
  if (eligibility === "suspended" || eligibility === "blocked") throw new AppError("ACCOUNT_NOT_ACTIVE")
  throw new AppError("STATE_CONFLICT")
}

export interface CreateSipDeps {
  readonly sipRepository: SipWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface CreateSipInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly durationMonths: number | null
  readonly requestId: string
}

export const createSip = async (tx: Transaction, deps: CreateSipDeps, input: CreateSipInput): Promise<SipPlan> => {
  const now = deps.clock()
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const compliance = await deps.orderRepository.latestCompliance(tx, input.userId)
  assertEligible(
    user.account_state,
    compliance.kycState === null
      ? null
      : {
          state: compliance.kycState,
          expiresAt: compliance.kycExpiresAt === null ? null : new Date(compliance.kycExpiresAt).toISOString(),
        },
    now,
  )

  const terms = await deps.orderRepository.findFundOrderTerms(tx, input.fundId)
  if (terms === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (terms.fundState !== "published" || terms.minimumSipPaise === null) throw new AppError("STATE_CONFLICT")
  if (BigInt(input.amountPaise) < BigInt(terms.minimumSipPaise)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { amountPaise: [`amount is below the SIP minimum of ${terms.minimumSipPaise} paise`] },
    })
  }

  const sip = await deps.sipRepository.create(tx, {
    userId: input.userId,
    fundId: input.fundId,
    amountPaise: input.amountPaise,
    debitDay: input.debitDay,
    durationMonths: input.durationMonths,
  })
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "sip.create",
    entityType: "sip_plan",
    entityId: sip.id,
    toState: "draft",
    requestId: input.requestId,
    entityVersion: Number(sip.version),
    metadata: { fundId: input.fundId },
  })
  return sip
}

export interface RequestSipMandateDeps {
  readonly sipRepository: SipWriteRepository
  readonly mandateRepository: MandateWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: { readonly paymentProvider: string; readonly mandateFrequency: string }
}

export interface RequestSipMandateResult {
  readonly sip: SipPlan
  readonly mandate: Mandate
}

/** draft -> pending_mandate: create the debit mandate (authorization requested) and link it. */
export const requestSipMandate = async (
  tx: Transaction,
  deps: RequestSipMandateDeps,
  input: Readonly<{ userId: string; sipId: string; requestId: string }>,
): Promise<RequestSipMandateResult> => {
  const now = deps.clock()
  const locked = await deps.sipRepository.lockById(tx, { sipId: input.sipId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (locked.state !== "draft") throw new AppError("STATE_CONFLICT")

  const mandate = await deps.mandateRepository.createPendingAuthorization(tx, {
    userId: input.userId,
    provider: deps.config.paymentProvider,
    maxAmountPaise: locked.amount_paise,
    frequency: deps.config.mandateFrequency,
    debitDay: locked.debit_day,
  })

  const sip = await deps.sipRepository.linkMandate(tx, {
    sipId: input.sipId,
    userId: input.userId,
    mandateId: mandate.id,
    now,
  })
  if (sip === null) throw new AppError("STATE_CONFLICT")

  await deps.outboxRepository.enqueue(tx, {
    topic: "mandate",
    eventType: "mandate.authorization_requested",
    eventVersion: 1,
    aggregateType: "mandate",
    aggregateId: mandate.id,
    requestId: input.requestId,
    deduplicationKey: `mandate_authorization:${mandate.id}`,
    payload: { mandateId: mandate.id, sipId: sip.id, provider: deps.config.paymentProvider },
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "sip.request_mandate",
    entityType: "sip_plan",
    entityId: sip.id,
    fromState: "draft",
    toState: "pending_mandate",
    requestId: input.requestId,
    entityVersion: Number(sip.version),
    metadata: { mandateId: mandate.id },
  })
  return { sip, mandate }
}

export interface SipControlDeps {
  readonly sipRepository: SipWriteRepository
  readonly mandateRepository: MandateWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export const pauseSip = async (
  tx: Transaction,
  deps: SipControlDeps,
  input: Readonly<{ userId: string; sipId: string; requestId: string }>,
): Promise<SipPlan> => {
  const sip = await deps.sipRepository.pause(tx, { sipId: input.sipId, userId: input.userId, now: deps.clock() })
  if (sip === null) throw await sipControlConflict(deps, tx, input)
  await appendSipAudit(deps, tx, input, sip, "sip.pause", "active", "paused")
  return sip
}

export const resumeSip = async (
  tx: Transaction,
  deps: SipControlDeps,
  input: Readonly<{ userId: string; sipId: string; requestId: string }>,
): Promise<SipPlan> => {
  const sip = await deps.sipRepository.resume(tx, { sipId: input.sipId, userId: input.userId, now: deps.clock() })
  if (sip === null) throw await sipControlConflict(deps, tx, input)
  await appendSipAudit(deps, tx, input, sip, "sip.resume", "paused", "active")
  return sip
}

/**
 * Cancel a SIP. Revokes the linked mandate only when no other live plan still
 * references it (spec 03 §5.2 cancelSip).
 */
export const cancelSip = async (
  tx: Transaction,
  deps: SipControlDeps,
  input: Readonly<{ userId: string; sipId: string; requestId: string }>,
): Promise<SipPlan> => {
  const now = deps.clock()
  const locked = await deps.sipRepository.lockById(tx, { sipId: input.sipId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")

  const sip = await deps.sipRepository.cancel(tx, { sipId: input.sipId, userId: input.userId, now })
  if (sip === null) throw new AppError("STATE_CONFLICT")

  if (locked.mandate_id !== null) {
    const remaining = await deps.sipRepository.countLiveByMandate(tx, {
      mandateId: locked.mandate_id,
      excludeSipId: locked.id,
    })
    if (remaining === 0) {
      await deps.mandateRepository.revoke(tx, { mandateId: locked.mandate_id, userId: input.userId, now })
    }
  }

  await appendSipAudit(deps, tx, input, sip, "sip.cancel", null, "cancelled")
  return sip
}

const sipControlConflict = async (
  deps: SipControlDeps,
  tx: Transaction,
  input: Readonly<{ userId: string; sipId: string }>,
): Promise<AppError> => {
  const existing = await deps.sipRepository.lockById(tx, { sipId: input.sipId, userId: input.userId })
  return existing === null ? new AppError("RESOURCE_NOT_FOUND") : new AppError("STATE_CONFLICT")
}

const appendSipAudit = async (
  deps: SipControlDeps,
  tx: Transaction,
  input: Readonly<{ userId: string; requestId: string }>,
  sip: SipPlan,
  command: string,
  fromState: string | null,
  toState: string,
): Promise<void> => {
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command,
    entityType: "sip_plan",
    entityId: sip.id,
    fromState,
    toState,
    requestId: input.requestId,
    entityVersion: Number(sip.version),
    metadata: {},
  })
}
