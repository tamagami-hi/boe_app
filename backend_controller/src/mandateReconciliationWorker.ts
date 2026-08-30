import type { UnitOfWork } from "./db/database.js"
import { reconcileMandateFact, reconcileSetupFact } from "./domain/payments/reconcileMandateFacts.js"
import { GatewayNotFoundError, GatewayRejectedError } from "./providers/paymentGateway.js"
import type { RecurringPaymentGateway } from "./providers/recurringPaymentGateway.js"
import type { MandatesRepository } from "./repositories/mandatesRepository.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "./repositories/investmentSettlementRepository.js"
import type { MandateSetupAttempt } from "./db/repositories.js"
import { logGatewayFailure, type GatewayFailureLogger } from "./providers/gatewayFailure.js"

export interface MandateReconciliationSummary {
  readonly setupsChecked: number
  readonly setupsResolved: number
  readonly mandatesChecked: number
  readonly mandatesResolved: number
  readonly cancelCommandsDispatched: number
}

export interface MandateReconciliationDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly recurringPaymentGateway: RecurringPaymentGateway
  readonly mandatesRepository: MandatesRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly logger?: GatewayFailureLogger | null
  readonly config: Readonly<{ claimLimit: number; notFoundGraceMs: number; cancelDispatchGraceMs?: number; cancelDispatchInFlightTimeoutMs?: number }>
}

const reconcileNotFound = async (
  deps: MandateReconciliationDeps,
  merchantOrderId: string,
): Promise<boolean> => deps.unitOfWork.execute(async (tx) => {
  const current = await deps.mandatesRepository.findSetupAttemptByMerchantOrder(tx, merchantOrderId)
  if (current === null || !["dispatching", "provider_pending"].includes(current.state)) return false
  const now = deps.clock()
  const first = current.not_found_first_observed_at === null
    ? await deps.mandatesRepository.recordSetupNotFound(tx, {
        merchantOrderId,
        expectedVersion: current.version,
        now,
      })
    : current
  if (first === null || first.not_found_first_observed_at === null) return false
  if (new Date(first.setup_expires_at).getTime() > now.getTime()) return false
  const cutoff = new Date(now.getTime() - deps.config.notFoundGraceMs)
  if (new Date(first.not_found_first_observed_at).getTime() > cutoff.getTime()) return false
  const expired = await deps.mandatesRepository.expireSetupAfterNotFoundGrace(tx, {
    merchantOrderId,
    expectedVersion: first.version,
    notFoundObservedBefore: cutoff,
    now,
  })
  if (expired === null) return false
  await expireCanonicalPayment(deps, tx, expired, now, "PROVIDER_NOT_FOUND")
  return true
})

const expireCanonicalPayment = async (
  deps: MandateReconciliationDeps,
  tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0],
  setup: MandateSetupAttempt,
  now: Date,
  failureCode: string,
): Promise<void> => {
  if (setup.payment_attempt_id !== null) {
    await deps.paymentsRepository.markAttemptExpired(tx, {
      attemptId: setup.payment_attempt_id,
      providerState: failureCode,
      now,
    })
  }
  if (setup.payment_id !== null) await deps.paymentsRepository.markPaymentExpired(tx, setup.payment_id, now)
  if (setup.order_id !== null) {
    await deps.paymentsRepository.markOrderPaymentFailed(tx, {
      orderId: setup.order_id,
      failureCode,
      now,
    })
  }
}

export const runMandateReconciliationPass = async (
  deps: MandateReconciliationDeps,
): Promise<MandateReconciliationSummary> => {
  const setups = await deps.unitOfWork.execute((tx) =>
    deps.mandatesRepository.listSetupReconciliationCandidates(tx, deps.config.claimLimit))
  let setupsResolved = 0
  for (const setup of setups) {
    if (setup.state === "created") {
      if (new Date(setup.setup_expires_at).getTime() <= deps.clock().getTime()) {
        const expired = await deps.unitOfWork.execute(async (tx) => {
          const now = deps.clock()
          const result = await deps.mandatesRepository.expireUndispatchedSetup(tx, {
            merchantOrderId: setup.merchant_order_id,
            expectedVersion: setup.version,
            now,
          })
          if (result !== null) await expireCanonicalPayment(deps, tx, result, now, "SETUP_EXPIRED")
          return result
        })
        if (expired !== null) setupsResolved += 1
      }
      continue
    }
    try {
      const status = await deps.recurringPaymentGateway.getSetupOrderStatus(setup.merchant_order_id)
      await reconcileSetupFact(deps, {
        merchantOrderId: setup.merchant_order_id,
        merchantSubscriptionId: null,
        status,
        now: deps.clock(),
      })
      if (status.state !== "PENDING") setupsResolved += 1
    } catch (error) {
      if (error instanceof GatewayNotFoundError && await reconcileNotFound(deps, setup.merchant_order_id)) {
        setupsResolved += 1
      } else if (!(error instanceof GatewayNotFoundError)) {
        logGatewayFailure(deps.logger ?? null, error, {
          requestId: "mandate-reconciliation-worker",
          operation: "get_mandate_setup_status",
        })
      }
    }
  }

  const mandates = await deps.unitOfWork.execute((tx) =>
    deps.mandatesRepository.listMandateReconciliationCandidates(tx, deps.config.claimLimit))
  let mandatesResolved = 0
  for (const mandate of mandates) {
    try {
      const status = await deps.recurringPaymentGateway.getMandateStatus(mandate.merchant_subscription_id)
      const before = mandate.state
      await reconcileMandateFact(deps, status, deps.clock())
      const after = await deps.unitOfWork.execute((tx) =>
        deps.mandatesRepository.findMandateByMerchantSubscription(tx, mandate.merchant_subscription_id))
      if (after !== null && after.state !== before) mandatesResolved += 1
    } catch (error) {
      logGatewayFailure(deps.logger ?? null, error, {
        requestId: "mandate-reconciliation-worker",
        operation: "get_mandate_status",
      })
      continue
    }
  }
  const cancelCommands = await deps.unitOfWork.execute((tx) =>
    deps.mandatesRepository.listCancelDispatchCandidates(tx, deps.config.claimLimit))
  let cancelCommandsDispatched = 0
  for (const command of cancelCommands) {
    const mandate = await deps.unitOfWork.execute((tx) =>
      deps.mandatesRepository.findMandateForAdmin(tx, command.mandate_id))
    if (mandate !== null && ["cancelled", "revoked", "expired", "failed"].includes(mandate.state)) {
      const satisfied = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.markCancelSatisfied(tx, {
        commandId: command.id,
        expectedVersion: command.version,
        now: deps.clock(),
      }))
      if (satisfied !== null) cancelCommandsDispatched += 1
      continue
    }
    if (command.state === "dispatching" || command.state === "reconciliation_required") {
      if (command.state === "dispatching") {
        const inFlightTimeoutMs = deps.config.cancelDispatchInFlightTimeoutMs ?? 10_000
        const dispatchStartedAt = new Date(command.dispatch_started_at as Date).getTime()
        if (dispatchStartedAt > deps.clock().getTime() - inFlightTimeoutMs) {
          continue
        }
      }
      try {
        const status = await deps.recurringPaymentGateway.getMandateStatus(command.merchant_subscription_id)
        await reconcileMandateFact(deps, status, deps.clock())
        const current = await deps.unitOfWork.execute((tx) =>
          deps.mandatesRepository.findMandateForAdmin(tx, command.mandate_id))
        if (current !== null && ["cancelled", "revoked", "expired", "failed"].includes(current.state)) {
          const satisfied = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.markCancelSatisfied(tx, {
            commandId: command.id,
            expectedVersion: command.version,
            now: deps.clock(),
          }))
          if (satisfied !== null) cancelCommandsDispatched += 1
        } else if (command.state === "dispatching" && ["ACTIVE", "PAUSED"].includes(status.state)) {
          const now = deps.clock()
          const graceMs = deps.config.cancelDispatchGraceMs ?? deps.config.notFoundGraceMs
          await deps.unitOfWork.execute((tx) => deps.mandatesRepository.recordCancelStatusObservation(tx, {
            commandId: command.id,
            expectedVersion: command.version,
            providerState: status.state as "ACTIVE" | "PAUSED",
            escalationCutoff: new Date(now.getTime() - graceMs),
            now,
          }))
        }
      } catch (error) {
        logGatewayFailure(deps.logger ?? null, error, {
          requestId: "mandate-reconciliation-worker",
          operation: "reconcile_cancel_mandate",
        })
      }
      continue
    }
    const claimed = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.claimCancelDispatch(tx, {
      commandId: command.id,
      expectedVersion: command.version,
      now: deps.clock(),
    }))
    if (claimed === null) continue
    try {
      await deps.recurringPaymentGateway.cancelMandate(claimed.merchant_subscription_id)
      const accepted = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.markCancelAccepted(tx, {
        commandId: claimed.id,
        expectedVersion: claimed.version,
        now: deps.clock(),
      }))
      if (accepted !== null) cancelCommandsDispatched += 1
    } catch (error) {
      if (error instanceof GatewayRejectedError) {
        await deps.unitOfWork.execute((tx) => deps.mandatesRepository.rejectCancelAndRestore(tx, {
          commandId: claimed.id,
          expectedVersion: claimed.version,
          failureCode: "PROVIDER_REJECTED",
          now: deps.clock(),
        }))
      } else {
        logGatewayFailure(deps.logger ?? null, error, {
          requestId: "mandate-reconciliation-worker",
          operation: "cancel_mandate",
        })
      }
    }
  }
  return {
    setupsChecked: setups.length,
    setupsResolved,
    mandatesChecked: mandates.length,
    mandatesResolved,
    cancelCommandsDispatched,
  }
}
