import type { UnitOfWork } from "../../db/database.js"
import type { MandateSetupStatus, MandateStatus } from "../../providers/recurringPaymentGateway.js"
import type { MandatesRepository } from "../../repositories/mandatesRepository.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"

import { applyCanonicalPaymentOutcome } from "./applyCanonicalPaymentOutcome.js"

export interface MandateFactDeps {
  readonly unitOfWork: UnitOfWork
  readonly mandatesRepository: MandatesRepository
  readonly paymentsRepository: PaymentsRepository
}

export const reconcileSetupFact = async (
  deps: MandateFactDeps,
  input: Readonly<{
    merchantOrderId: string
    merchantSubscriptionId: string | null
    status: MandateSetupStatus
    now: Date
  }>,
): Promise<void> => {
  await deps.unitOfWork.execute(async (tx) => {
    const setup = await deps.mandatesRepository.findSetupAttemptByMerchantOrder(tx, input.merchantOrderId)
    if (setup === null || setup.amount_paise === null || setup.payment_attempt_id === null) return
    const mandate = await deps.mandatesRepository.findMandateForAdmin(tx, setup.mandate_id)
    if (
      mandate === null || mandate.merchant_subscription_id !== input.status.merchantSubscriptionId ||
      input.merchantSubscriptionId !== null && input.merchantSubscriptionId !== mandate.merchant_subscription_id ||
      setup.provider_order_id !== null && input.status.providerOrderId !== setup.provider_order_id
    ) throw new Error("Mandate setup provider correlation mismatch")
    const completed = input.status.paymentDetails.filter((detail) =>
      detail.state === "COMPLETED" && detail.amountPaise === setup.amount_paise)
    if (input.status.state === "COMPLETED" && completed.length > 0) {
      await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
        merchantOrderId: setup.merchant_order_id,
        providerMerchantOrderId: setup.merchant_order_id,
        outcome: "succeeded",
        providerState: input.status.state,
        providerOrderId: input.status.providerOrderId,
        amountPaise: setup.amount_paise,
        currency: "INR",
        details: completed.map((detail) => ({
          transactionId: detail.transactionId,
          reference: null,
          instrumentType: detail.instrumentType,
          state: detail.state,
          amountPaise: detail.amountPaise,
        })),
      }, input.now)
      if (setup.state === "provider_pending" || setup.state === "dispatching") {
        await deps.mandatesRepository.applyProviderSetupState(tx, {
          merchantOrderId: setup.merchant_order_id,
          providerOrderId: input.status.providerOrderId,
          expectedVersion: setup.version,
          fromState: setup.state,
          toState: "authorized",
          now: input.now,
        })
      }
      return
    }
    if (input.status.state !== "FAILED" || !["provider_pending", "dispatching"].includes(setup.state)) return
    await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
      merchantOrderId: setup.merchant_order_id,
      providerMerchantOrderId: setup.merchant_order_id,
      outcome: "failed",
      providerState: input.status.state,
      providerOrderId: input.status.providerOrderId,
      amountPaise: null,
      currency: "INR",
      details: [],
    }, input.now)
    await deps.mandatesRepository.applyProviderSetupState(tx, {
      merchantOrderId: setup.merchant_order_id,
      providerOrderId: input.status.providerOrderId,
      expectedVersion: setup.version,
      fromState: setup.state as "provider_pending" | "dispatching",
      toState: "failed",
      failureCode: "PROVIDER_DECLINED",
      now: input.now,
    })
  })
}

export const reconcileMandateFact = async (
  deps: MandateFactDeps,
  status: MandateStatus,
  now: Date,
): Promise<void> => {
  if (status.state === "ACTIVE" && status.providerSubscriptionId !== null) {
    await deps.unitOfWork.execute(async (tx) => {
      const abandoned = await deps.mandatesRepository.bindProviderSubscriptionForAbandonment(tx, {
        merchantSubscriptionId: status.merchantSubscriptionId,
        providerSubscriptionId: status.providerSubscriptionId as string,
        now,
      })
      if (abandoned !== null) return
      await deps.mandatesRepository.activateAfterSuccessfulSetupPayment(tx, {
        merchantSubscriptionId: status.merchantSubscriptionId,
        providerSubscriptionId: status.providerSubscriptionId as string,
        now,
      })
    })
    return
  }
  const target = status.state === "CANCELLED" ? "cancelled"
    : status.state === "REVOKED" ? "revoked"
      : status.state === "EXPIRED" ? "expired"
        : status.state === "FAILED" ? "failed"
          : status.state === "PAUSED" ? "paused"
            : null
  if (target === null) return
  await deps.unitOfWork.execute(async (tx) => {
    const mandate = await deps.mandatesRepository.findMandateByMerchantSubscription(tx, status.merchantSubscriptionId)
    if (mandate === null || mandate.state === target) return
    const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", mandate.sip_plan_id).executeTakeFirst()
    if (sip === undefined) return
    const liveStates = ["setup_pending", "active", "pause_pending", "paused", "cancel_pending", "revoke_pending"]
    const allowed = target === "paused" && ["active", "pause_pending"].includes(mandate.state) ||
      ["cancelled", "revoked", "expired", "failed"].includes(target) && liveStates.includes(mandate.state)
    if (!allowed) return
    await deps.mandatesRepository.applyProviderMandateState(tx, {
      merchantSubscriptionId: mandate.merchant_subscription_id,
      providerSubscriptionId: status.providerSubscriptionId,
      expectedVersion: mandate.version,
      expectedSipVersion: sip.version,
      fromState: mandate.state,
      toState: target,
      ...(target === "failed" ? { failureCode: "PROVIDER_DECLINED" } : {}),
      now,
    })
  })
}
