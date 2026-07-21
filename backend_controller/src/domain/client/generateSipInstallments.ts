/**
 * SIP installment scheduler (spec 03 §5.2 createOrder system-SIP, completeSip).
 * One pass: for each active SIP due on/before today, create a `sip_installment`
 * order and begin its payment, then advance the next due date (or complete the
 * plan when its duration is reached). Each installment payment then flows through
 * the same payment settlement + paid/failed confirmation checkpoint as one-time
 * orders. Owner eligibility and fund publication are re-checked per installment.
 */
import type { UnitOfWork } from "../../db/database.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { PaymentWriteRepository } from "../../repositories/paymentRepository.js"
import type { SipWriteRepository } from "../../repositories/sipRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { beginPayment } from "./beginPayment.js"
import { deriveInvestingEligibility } from "./investingEligibility.js"

/** Add whole months to a YYYY-MM-DD date, clamping the day to the debit day (<=28). */
export const addMonthsKeepingDay = (isoDate: string, months: number, debitDay: number): string => {
  const [year, month] = isoDate.split("-").map((part) => Number(part))
  const base = (year ?? 1970) * 12 + ((month ?? 1) - 1) + months
  const nextYear = Math.floor(base / 12)
  const nextMonth = (base % 12) + 1
  const day = String(debitDay).padStart(2, "0")
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${day}`
}

export interface GenerateSipInstallmentsConfig {
  readonly limit: number
  readonly paymentProvider: string
  readonly attemptTtlMs: number | null
}

export interface GenerateSipInstallmentsDeps {
  readonly unitOfWork: UnitOfWork
  readonly sipRepository: SipWriteRepository
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly paymentRepository: PaymentWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: GenerateSipInstallmentsConfig
}

export interface GenerateSipInstallmentsSummary {
  readonly due: number
  readonly generated: number
  readonly skipped: number
  readonly completed: number
}

const isEligible = async (
  tx: Transaction,
  deps: GenerateSipInstallmentsDeps,
  userId: string,
  now: Date,
): Promise<boolean> => {
  const user = await deps.userRepository.lockById(tx, userId as UserId)
  if (user === null) return false
  const compliance = await deps.orderRepository.latestCompliance(tx, userId)
  const { eligibility } = deriveInvestingEligibility({
    accountState: user.account_state,
    kyc:
      compliance.kycState === null
        ? null
        : {
            state: compliance.kycState,
            expiresAt: compliance.kycExpiresAt === null ? null : new Date(compliance.kycExpiresAt).toISOString(),
          },
    riskState: compliance.riskState,
    now,
  })
  return eligibility === "eligible"
}

export const generateSipInstallments = async (
  deps: GenerateSipInstallmentsDeps,
): Promise<GenerateSipInstallmentsSummary> => {
  const now = deps.clock()
  const asOfDate = now.toISOString().slice(0, 10)
  const beginDeps = {
    orderRepository: deps.orderRepository,
    paymentRepository: deps.paymentRepository,
    outboxRepository: deps.outboxRepository,
    auditRepository: deps.auditRepository,
    clock: deps.clock,
    config: { paymentProvider: deps.config.paymentProvider, attemptTtlMs: deps.config.attemptTtlMs },
  }

  return deps.unitOfWork.execute(async (tx) => {
    const due = await deps.sipRepository.findActiveDue(tx, { asOfDate, limit: deps.config.limit })
    const summary = { due: due.length, generated: 0, skipped: 0, completed: 0 }

    for (const sip of due) {
      const terms = await deps.orderRepository.findFundOrderTerms(tx, sip.fundId)
      if (terms === null || terms.fundState !== "published" || !(await isEligible(tx, deps, sip.userId, now))) {
        // Leave the due date in place; ops can pause. It retries next pass.
        summary.skipped += 1
        continue
      }

      const order = await deps.orderRepository.createSipInstallment(tx, {
        userId: sip.userId,
        fundId: sip.fundId,
        sipPlanId: sip.id,
        amountPaise: sip.amountPaise,
        currency: terms.currency,
        now,
      })
      await deps.auditRepository.append(tx, {
        actorType: "system",
        command: "order.create",
        entityType: "investment_order",
        entityId: order.id,
        toState: "submitted",
        requestId: order.id,
        entityVersion: Number(order.version),
        metadata: { type: "sip_installment", sipPlanId: sip.id },
      })
      await beginPayment(tx, beginDeps, { userId: sip.userId, orderId: order.id, requestId: order.id })

      const installmentCount = await deps.orderRepository.countBySipPlan(tx, sip.id)
      if (sip.durationMonths !== null && installmentCount >= sip.durationMonths) {
        await deps.sipRepository.complete(tx, { sipId: sip.id, userId: sip.userId, now })
        summary.completed += 1
      } else {
        await deps.sipRepository.advanceNextDueDate(tx, {
          sipId: sip.id,
          userId: sip.userId,
          nextDueDate: addMonthsKeepingDay(sip.nextDueDate, 1, sip.debitDay),
          now,
        })
      }
      summary.generated += 1
    }

    return summary
  })
}
