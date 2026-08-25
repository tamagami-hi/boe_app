import { describe, expect, test, vi } from "vitest"

import { runMandateReconciliationPass, type MandateReconciliationDeps } from "./mandateReconciliationWorker.js"
import { GatewayRejectedError, GatewayUnavailableError } from "./providers/phonepe/paymentGateway.js"

const command = {
  id: "command-1",
  mandate_id: "mandate-1",
  merchant_subscription_id: "subscription-1",
  state: "queued",
  version: "0",
}

const buildDeps = (overrides: Readonly<Record<string, unknown>> = {}) => {
  const mandatesRepository = {
    listSetupReconciliationCandidates: vi.fn().mockResolvedValue([]),
    listMandateReconciliationCandidates: vi.fn().mockResolvedValue([]),
    listCancelDispatchCandidates: vi.fn().mockResolvedValue([command]),
    findMandateForAdmin: vi.fn().mockResolvedValue({ id: "mandate-1", state: "cancel_pending" }),
    claimCancelDispatch: vi.fn().mockResolvedValue({ ...command, state: "dispatching", version: "1" }),
    markCancelAccepted: vi.fn().mockResolvedValue({ ...command, state: "accepted" }),
    markCancelSatisfied: vi.fn().mockResolvedValue(null),
    rejectCancelAndRestore: vi.fn().mockResolvedValue({ ...command, state: "rejected" }),
    bindProviderSubscriptionForAbandonment: vi.fn().mockResolvedValue(null),
    activateAfterSuccessfulSetupPayment: vi.fn().mockResolvedValue(null),
    recordCancelStatusObservation: vi.fn().mockResolvedValue({ ...command, state: "reconciliation_required" }),
  }
  const recurringPaymentGateway = {
    cancelMandate: vi.fn().mockResolvedValue(undefined),
    getMandateStatus: vi.fn().mockResolvedValue({
      state: "ACTIVE",
      merchantSubscriptionId: "subscription-1",
      providerSubscriptionId: "provider-subscription-1",
    }),
  }
  return {
    deps: {
      unitOfWork: { execute: (work: (tx: never) => unknown) => work({} as never) },
      clock: () => new Date("2026-08-24T12:00:00.000Z"),
      recurringPaymentGateway,
      mandatesRepository,
      paymentsRepository: {},
      logger: null,
      config: { claimLimit: 10, notFoundGraceMs: 60_000, cancelDispatchGraceMs: 60_000 },
      ...overrides,
    } as unknown as MandateReconciliationDeps,
    mandatesRepository,
    recurringPaymentGateway,
  }
}

describe("mandate cancellation reconciliation", () => {
  test("dispatches one queued cancellation and persists provider acceptance", async () => {
    const fixture = buildDeps()
    await expect(runMandateReconciliationPass(fixture.deps)).resolves.toMatchObject({ cancelCommandsDispatched: 1 })
    expect(fixture.recurringPaymentGateway.cancelMandate).toHaveBeenCalledOnce()
    expect(fixture.mandatesRepository.markCancelAccepted).toHaveBeenCalledOnce()
  })

  test("restores state only after an authoritative cancellation rejection", async () => {
    const fixture = buildDeps()
    fixture.recurringPaymentGateway.cancelMandate.mockRejectedValue(new GatewayRejectedError("rejected"))
    await runMandateReconciliationPass(fixture.deps)
    expect(fixture.mandatesRepository.rejectCancelAndRestore).toHaveBeenCalledOnce()
  })

  test("never repeats an ambiguous cancellation and records authoritative active status", async () => {
    const mandatesRepository = {
      ...buildDeps().mandatesRepository,
      listCancelDispatchCandidates: vi.fn().mockResolvedValue([{ ...command, state: "dispatching" }]),
      findMandateForAdmin: vi.fn().mockResolvedValue({ id: "mandate-1", state: "cancel_pending" }),
    }
    const fixture = buildDeps({ mandatesRepository })
    fixture.recurringPaymentGateway.cancelMandate.mockRejectedValue(new GatewayUnavailableError("timeout"))
    await runMandateReconciliationPass(fixture.deps)
    expect(fixture.recurringPaymentGateway.cancelMandate).not.toHaveBeenCalled()
    expect(mandatesRepository.recordCancelStatusObservation).toHaveBeenCalledOnce()
  })
})
