import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import type { SipPlan } from "./db/repositories.js"
import { createSipInstallmentOrder } from "./domain/client/createSipInstallmentOrder.js"
import { isInstallmentPeriodResolved } from "./domain/client/sipInstallmentPeriod.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { NotificationWriteRepository } from "./repositories/notificationRepository.js"
import type { OrderWriteRepository } from "./repositories/orderRepository.js"
import type { SipPlanRepository } from "./repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "./repositories/userRepository.js"

export interface SipScheduleConfig {
  readonly claimLimit: number
  readonly maxPeriodsPerPlan: number
  readonly gatewayConfigured: boolean
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

const dateOnly = (value: Date | string): string => {
  const iso = typeof value === "string" ? value : value.toISOString()
  return iso.slice(0, 10)
}

const monthOf = (value: Date | string): string => `${dateOnly(value).slice(0, 7)}-01`

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

type PlanStepOutcome =
  | { readonly kind: "created" | "waiting" | "stale" | "completed" }
  | { readonly kind: "advanced"; readonly plan: SipPlan }

const isStillDueAt = (locked: SipPlan | null, expected: SipPlan): locked is SipPlan =>
  locked !== null && locked.state === "active" && locked.next_due_date !== null && expected.next_due_date !== null &&
  dateOnly(locked.next_due_date) === dateOnly(expected.next_due_date)

const isDurationComplete = (plan: SipPlan, duePeriod: string): boolean => {
  const startPeriod = dateOnly(plan.start_date ?? duePeriod).slice(0, 7)
  return plan.duration_months !== null && monthsBetween(startPeriod, duePeriod) + 1 >= plan.duration_months
}

const runPlanStep = async (deps: SipScheduleDeps, expected: SipPlan): Promise<PlanStepOutcome> =>
  deps.unitOfWork.execute(async (tx) => {
    const locked = await deps.sipPlanRepository.lockById(tx, { sipPlanId: expected.id, userId: expected.user_id })
    if (!isStillDueAt(locked, expected) || locked.next_due_date === null) return { kind: "stale" }
    const duePeriod = monthOf(locked.next_due_date)
    const existing = await deps.orderRepository.findInstallmentByPeriod(tx, { sipPlanId: locked.id, duePeriod })
    if (existing === null) {
      await createSipInstallmentOrder(tx, {
        orderRepository: deps.orderRepository,
        userRepository: deps.userRepository,
        auditRepository: deps.auditRepository,
        notificationRepository: deps.notificationRepository,
        clock: deps.clock,
      }, { plan: locked, duePeriod, requestId: randomUUID() })
      return { kind: "created" }
    }
    if (!isInstallmentPeriodResolved(existing.state)) return { kind: "waiting" }
    const now = deps.clock()
    if (isDurationComplete(locked, duePeriod)) {
      const completed = await deps.sipPlanRepository.markCompleted(tx, locked.id, now)
      return completed === null ? { kind: "stale" } : { kind: "completed" }
    }
    const advanced = await deps.sipPlanRepository.advanceNextDueDate(tx, {
      sipPlanId: locked.id,
      expectedNextDueDate: dateOnly(locked.next_due_date),
      nextDueDate: addMonthClamped(duePeriod, locked.debit_day),
      now,
    })
    return advanced === null ? { kind: "stale" } : { kind: "advanced", plan: advanced }
  })

const advanceOnePlan = async (
  deps: SipScheduleDeps,
  plan: SipPlan,
): Promise<{ installmentsCreated: number; advanced: boolean; completed: boolean }> => {
  let advanced = false
  let current: SipPlan = plan

  for (let step = 0; step < deps.config.maxPeriodsPerPlan; step += 1) {
    if (current.state !== "active" || current.next_due_date === null) break
    if (dateOnly(current.next_due_date) > deps.clock().toISOString().slice(0, 10)) break
    const outcome = await runPlanStep(deps, current)
    if (outcome.kind === "created") return { installmentsCreated: 1, advanced, completed: false }
    if (outcome.kind === "completed") return { installmentsCreated: 0, advanced, completed: true }
    if (outcome.kind !== "advanced") break
    current = outcome.plan
    advanced = true
  }

  return { installmentsCreated: 0, advanced, completed: false }
}

const IDLE_SUMMARY: SipScheduleSummary = {
  plansChecked: 0,
  installmentsCreated: 0,
  plansAdvanced: 0,
  plansCompleted: 0,
}

export const runSipSchedulePass = async (deps: SipScheduleDeps): Promise<SipScheduleSummary> => {
  if (!deps.config.gatewayConfigured) return IDLE_SUMMARY
  const now = deps.clock()
  const due = await deps.unitOfWork.execute((tx) =>
    deps.sipPlanRepository.listDue(tx, { asOf: now.toISOString().slice(0, 10), limit: deps.config.claimLimit }),
  )

  let installmentsCreated = 0
  let plansAdvanced = 0
  let plansCompleted = 0

  for (const plan of due) {
    const result = await advanceOnePlan(deps, plan)
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
