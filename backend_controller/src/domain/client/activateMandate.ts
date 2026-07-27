/**
 * activateMandate (spec 03 §5.2). Provider/system command invoked when the user
 * authorizes the debit mandate at the bank/UPI (delivered via the signed mandate
 * webhook). It activates the mandate and, atomically, activates every SIP that
 * was waiting on it (`pending_mandate -> active`), setting the start and first
 * due date so the scheduler can begin generating installments.
 */
import type { Mandate, Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { MandateWriteRepository } from "../../repositories/mandateRepository.js"
import type { SipWriteRepository } from "../../repositories/sipRepository.js"

export interface ActivateMandateDeps {
  readonly mandateRepository: MandateWriteRepository
  readonly sipRepository: SipWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface ActivateMandateResult {
  readonly mandate: Mandate
  readonly activatedSipIds: readonly string[]
}

export const activateMandate = async (
  tx: Transaction,
  deps: ActivateMandateDeps,
  input: Readonly<{ mandateId: string; providerMandateId: string; requestId: string }>,
): Promise<ActivateMandateResult> => {
  const now = deps.clock()
  const existing = await deps.mandateRepository.findById(tx, input.mandateId)
  if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
  const userId = existing.user_id as UserId

  const mandate = await deps.mandateRepository.activate(tx, {
    mandateId: input.mandateId,
    userId,
    providerMandateId: input.providerMandateId,
    validFrom: now,
    now,
  })
  if (mandate === null) throw new AppError("STATE_CONFLICT")

  const today = now.toISOString().slice(0, 10)
  const pending = await deps.sipRepository.findPendingByMandate(tx, input.mandateId)
  const activatedSipIds: string[] = []
  for (const plan of pending) {
    // First installment is due immediately on activation (mock-friendly; a real
    // deployment would schedule the first debit on the next debit day).
    const activated = await deps.sipRepository.activate(tx, {
      sipId: plan.id,
      userId,
      startDate: today,
      nextDueDate: today,
      now,
    })
    if (activated === null) continue
    activatedSipIds.push(activated.id)
    await deps.auditRepository.append(tx, {
      actorType: "system",
      command: "sip.activate",
      entityType: "sip_plan",
      entityId: activated.id,
      fromState: "pending_mandate",
      toState: "active",
      requestId: input.requestId,
      entityVersion: Number(activated.version),
      metadata: { mandateId: input.mandateId },
    })
  }

  await deps.auditRepository.append(tx, {
    actorType: "provider",
    command: "mandate.activate",
    entityType: "mandate",
    entityId: mandate.id,
    fromState: "pending_user_authorization",
    toState: "active",
    requestId: input.requestId,
    entityVersion: Number(mandate.version),
    metadata: { activatedSipCount: activatedSipIds.length },
  })
  return { mandate, activatedSipIds }
}

export type MandateResultStatus = "authorized" | "failed"
export type MandateResultOutcome = "activated" | "failed" | "already_active" | "already_failed"

/**
 * Record a mandate authorization result (the mandate confirmation checkpoint),
 * invoked by the signed mandate webhook. Idempotent: a terminal mandate is a
 * no-op. A failed authorization revokes the mandate; its SIPs stay
 * `pending_mandate` for a retry.
 */
export const recordMandateResult = async (
  tx: Transaction,
  deps: ActivateMandateDeps,
  input: Readonly<{ mandateId: string; status: MandateResultStatus; providerMandateId?: string; requestId: string }>,
): Promise<MandateResultOutcome> => {
  const now = deps.clock()
  const mandate = await deps.mandateRepository.findById(tx, input.mandateId)
  if (mandate === null) throw new AppError("RESOURCE_NOT_FOUND")

  if (input.status === "authorized") {
    if (mandate.state === "active") return "already_active"
    await activateMandate(tx, deps, {
      mandateId: input.mandateId,
      providerMandateId: input.providerMandateId ?? `${mandate.provider}:${mandate.id}`,
      requestId: input.requestId,
    })
    return "activated"
  }

  if (mandate.state === "revoked") return "already_failed"
  const revoked = await deps.mandateRepository.revoke(tx, {
    mandateId: input.mandateId,
    userId: mandate.user_id,
    now,
  })
  if (revoked === null) throw new AppError("STATE_CONFLICT")
  await deps.auditRepository.append(tx, {
    actorType: "provider",
    command: "mandate.fail",
    entityType: "mandate",
    entityId: revoked.id,
    toState: "revoked",
    requestId: input.requestId,
    entityVersion: Number(revoked.version),
    metadata: {},
  })
  return "failed"
}
