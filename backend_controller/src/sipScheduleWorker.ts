import type { UnitOfWork } from "./db/database.js"
import type { SipPlan } from "./db/repositories.js"
import type { OrderState } from "./db/types.js"
import { createSipInstallmentOrder } from "./domain/client/createSipInstallmentOrder.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { NotificationWriteRepository } from "./repositories/notificationRepository.js"
import type { OrderWriteRepository } from "./repositories/orderRepository.js"
import type { SipPlanRepository } from "./repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "./repositories/userRepository.js"

export interface SipScheduleConfig {
  readonly claimLimit: number
  readonly maxPeriodsPerPlan: number
}

export interface SipScheduleDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly sipPlanRepository: SipPlanRepository
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly config: SipScheduleConfig
}

export interface SipScheduleSummary {
  readonly plansChecked: number
  readonly installmentsCreated: number
  readonly plansAdvanced: number
  readonly plansCompleted: number
}

const OPEN_ORDER_STATES: readonly OrderState[] = ["submitted", "payment_pending", "review_pending"]

const dateOnly = (value: Date | string): string => {
  const iso = typeof value === "string" ? value : value.toISOString()
  return iso.slice(0, 10)
}

const addMonthClamped = (period: string, debitDay: number): string => {
  const parts = period.split("-")
  const year = Number(parts[0])
  const monthIndex = Number(parts[1]) - 1
  const nextMonthIndex = monthIndex + 1
  const daysInNextMonth = new Date(Date.UTC(year, nextMonthIndex + 1, 0)).getUTCDate()
  const day = Math.min(debitDay, daysInNextMonth)
  const next = new Date(Date.UTC(year, nextMonthIndex, day))
  return next.toISOString().slice(0, 10)
}

const monthsBetween = (startPeriod: string, period: string): number => {
  const startParts = startPeriod.split("-")
  const parts = period.split("-")
  const startYear = Number(startParts[0])
  const startMonth = Number(startParts[1])
  const year = Number(parts[0])
  const month = Number(parts[1])
  return (year - startYear) * 12 + (month - startMonth)
}

const advanceOnePlan = async (
  deps: SipScheduleDeps,
  plan: SipPlan,
  requestId: string,
): Promise<{ installmentsCreated: number; advanced: boolean; completed: boolean }> => {
  let installmentsCreated = 0
  let advanced = false
  let completed = false
  let current: SipPlan = plan

  for (let step = 0; step < deps.config.maxPeriodsPerPlan; step += 1) {
    if (current.state !== "active" || current.next_due_date === null) break
    const now = deps.clock()
    if (dateOnly(current.next_due_date) > now.toISOString().slice(0, 10)) break

    const duePeriod = dateOnly(current.next_due_date)
    const outcome = await deps.unitOfWork.execute(async (tx) => {
      const existing = await deps.orderRepository.findInstallmentByPeriod(tx, {
        sipPlanId: current.id,
        duePeriod,
      })

      if (existing === null) {
        const result = await createSipInstallmentOrder(
          tx,
          {
            orderRepository: deps.orderRepository,
            userRepository: deps.userRepository,
            auditRepository: deps.auditRepository,
            notificationRepository: deps.notificationRepository,
            clock: deps.clock,
          },
          { plan: current, duePeriod, requestId },
        )
        return { kind: "created" as const, resolved: result.outcome === "created" }
      }

      if (OPEN_ORDER_STATES.includes(existing.state)) {
        return { kind: "waiting" as const, resolved: false }
      }
      if (existing.state !== "accepted") {
        return { kind: "waiting" as const, resolved: false }
      }
      return { kind: "accepted" as const, resolved: true }
    })

    if (outcome.kind === "created") {
      installmentsCreated += 1
      break
    }
    if (outcome.kind === "waiting") break

    const startPeriod = dateOnly(current.start_date ?? duePeriod).slice(0, 7)
    const elapsedMonths = monthsBetween(startPeriod, duePeriod) + 1
    const durationComplete =
      current.duration_months !== null && elapsedMonths >= current.duration_months

    const advanceNow = deps.clock()
    const nextDueDate = addMonthClamped(duePeriod, current.debit_day)
    const updated = durationComplete
      ? await deps.unitOfWork.execute((tx) => deps.sipPlanRepository.markCompleted(tx, current.id, advanceNow))
      : await deps.unitOfWork.execute((tx) =>
          deps.sipPlanRepository.advanceNextDueDate(tx, {
            sipPlanId: current.id,
            nextDueDate,
            now: advanceNow,
          }),
        )
    if (updated === null) break
    current = updated
    if (durationComplete) {
      completed = true
      break
    }
    advanced = true
  }

  return { installmentsCreated, advanced, completed }
}

export const runSipSchedulePass = async (deps: SipScheduleDeps): Promise<SipScheduleSummary> => {
  const now = deps.clock()
  const due = await deps.unitOfWork.execute((tx) =>
    deps.sipPlanRepository.listDue(tx, { asOf: now.toISOString().slice(0, 10), limit: deps.config.claimLimit }),
  )

  let installmentsCreated = 0
  let plansAdvanced = 0
  let plansCompleted = 0

  for (const plan of due) {
    const requestId = `sip-schedule-${plan.id}-${now.getTime()}`
    const result = await advanceOnePlan(deps, plan, requestId)
    installmentsCreated += result.installmentsCreated
    if (result.advanced) plansAdvanced += 1
    if (result.completed) plansCompleted += 1
  }

  return {
    plansChecked: due.length,
    installmentsCreated,
    plansAdvanced,
    plansCompleted,
  }
}
