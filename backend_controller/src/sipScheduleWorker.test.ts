import { describe, expect, test, vi } from "vitest"

import { runSipSchedulePass, type SipScheduleDeps } from "./sipScheduleWorker.js"

const basePlan = {
  id: "plan-1",
  user_id: "user-1",
  fund_id: "fund-1",
  amount_paise: "500000",
  debit_day: 15,
  duration_months: null,
  state: "active" as const,
  start_date: "2026-08-15",
  next_due_date: "2026-08-15",
  paused_at: null,
  cancelled_at: null,
  completed_at: null,
  created_at: new Date("2026-08-01"),
  updated_at: new Date("2026-08-01"),
  version: "1",
}

const buildDeps = (overrides: Partial<Record<string, unknown>> = {}): SipScheduleDeps => {
  const orders = new Map<string, { state: string }>()
  const plans = new Map<string, typeof basePlan>([["plan-1", { ...basePlan }]])

  return {
    unitOfWork: { execute: (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    clock: () => new Date("2026-08-20T00:00:00Z"),
    sipPlanRepository: {
      listDue: async () => [...plans.values()].filter((plan) => plan.state === "active"),
      advanceNextDueDate: async (_tx: unknown, input: { sipPlanId: string; nextDueDate: string }) => {
        const plan = plans.get(input.sipPlanId)
        if (plan === undefined) return null
        plan.next_due_date = input.nextDueDate
        return { ...plan }
      },
      markCompleted: async (_tx: unknown, sipPlanId: string) => {
        const plan = plans.get(sipPlanId)
        if (plan === undefined) return null
        plan.state = "completed" as never
        plan.next_due_date = null as never
        return { ...plan }
      },
      create: vi.fn(),
      listByUser: vi.fn(),
      lockById: vi.fn(),
      lockByIdUnscoped: vi.fn(),
      markPaused: vi.fn(),
      markResumed: vi.fn(),
      markCancelled: vi.fn(),
    },
    orderRepository: {
      findInstallmentByPeriod: async (_tx: unknown, input: { sipPlanId: string; duePeriod: string }) =>
        orders.get(`${input.sipPlanId}:${input.duePeriod}`) ?? null,
      createSipInstallment: async (_tx: unknown, input: { sipPlanId: string; duePeriod: string }) => {
        const key = `${input.sipPlanId}:${input.duePeriod}`
        if (orders.has(key)) return null
        const order = { id: `order-${key}`, version: "1", state: "submitted" as const }
        orders.set(key, order)
        return order
      },
      findFundOrderTerms: async () => ({
        fundState: "published" as const,
        currency: "INR",
        fundVersionId: "version-1",
        minimumPurchasePaise: "100000",
        minimumSipPaise: "50000",
      }),
      latestCompliance: async () => ({ emailVerificationState: "verified" as const, emailVerificationExpiresAt: null }),
      createPurchase: vi.fn(),
      findOpenInstallment: vi.fn(),
      lockById: vi.fn(),
    },
    userRepository: {
      lockById: async () => ({ account_state: "active" as const }),
    },
    auditRepository: { append: vi.fn() },
    notificationRepository: { create: vi.fn() },
    config: { claimLimit: 50, maxPeriodsPerPlan: 24 },
    ...overrides,
    __orders: orders,
    __plans: plans,
  } as unknown as SipScheduleDeps & { __orders: Map<string, unknown>; __plans: Map<string, typeof basePlan> }
}

describe("runSipSchedulePass", () => {
  test("creates exactly one installment order for a due plan", async () => {
    const deps = buildDeps()
    const summary = await runSipSchedulePass(deps)
    expect(summary.installmentsCreated).toBe(1)
    expect(summary.plansChecked).toBe(1)
  })

  test("never creates a second order for the same plan and month, even across repeated passes", async () => {
    const deps = buildDeps()
    await runSipSchedulePass(deps)
    await runSipSchedulePass(deps)
    await runSipSchedulePass(deps)
    const orders = (deps as unknown as { __orders: Map<string, unknown> }).__orders
    expect(orders.size).toBe(1)
  })

  test("does not advance to next month while this month's order is still open", async () => {
    const deps = buildDeps()
    await runSipSchedulePass(deps)
    const plan = (deps as unknown as { __plans: Map<string, typeof basePlan> }).__plans.get("plan-1")!
    expect(plan.next_due_date).toBe("2026-08-15")
  })

  test("advances to next month once the current period's order is accepted", async () => {
    const deps = buildDeps()
    await runSipSchedulePass(deps)
    const orders = (deps as unknown as { __orders: Map<string, { state: string }> }).__orders
    for (const order of orders.values()) order.state = "accepted"

    const summary = await runSipSchedulePass(deps)
    const plan = (deps as unknown as { __plans: Map<string, typeof basePlan> }).__plans.get("plan-1")!
    expect(plan.next_due_date).toBe("2026-09-15")
    expect(summary.installmentsCreated).toBe(0)
  })

  test("a failed installment order is not retried with a new order for the same month", async () => {
    const deps = buildDeps()
    await runSipSchedulePass(deps)
    const orders = (deps as unknown as { __orders: Map<string, { state: string }> }).__orders
    for (const order of orders.values()) order.state = "payment_failed"

    await runSipSchedulePass(deps)
    const plan = (deps as unknown as { __plans: Map<string, typeof basePlan> }).__plans.get("plan-1")!
    expect(plan.next_due_date).toBe("2026-08-15")
    expect(orders.size).toBe(1)
  })
})
