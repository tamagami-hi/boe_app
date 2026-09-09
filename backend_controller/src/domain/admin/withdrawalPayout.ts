import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { MaturitySettlementDeps } from "./maturitySettlement.js"

export interface UpdateWithdrawalPayoutInput {
  readonly userId: string
  readonly payoutId: string
  readonly expectedVersion: number
  readonly state: "paid" | "failed"
  readonly transferReference: string | null
  readonly failureCode: string | null
  readonly actorUserId: string
  readonly requestId: string
}

const assertPayoutUpdate = (input: UpdateWithdrawalPayoutInput): void => {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new AppError("VALIDATION_FAILED")
  }
  const isPaid = input.state === "paid" && input.failureCode === null &&
    input.transferReference !== null && input.transferReference.trim().length > 0 &&
    input.transferReference.length <= 256
  const isFailed = input.state === "failed" && input.transferReference === null &&
    input.failureCode !== null && /^[A-Za-z0-9_.:-]{1,128}$/u.test(input.failureCode)
  if (!isPaid && !isFailed) throw new AppError("VALIDATION_FAILED")
}

export const updateWithdrawalPayout = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: UpdateWithdrawalPayoutInput,
): Promise<void> => {
  assertPayoutUpdate(input)
  const update = { ...input, now: deps.clock() }
  const changed = input.state === "paid"
    ? await deps.maturityRepository.markPayoutPaid(tx, { ...update, transferReference: input.transferReference!.trim() })
    : await deps.maturityRepository.markPayoutFailed(tx, { ...update, failureCode: input.failureCode! })
  if (!changed) {
    throw new AppError("STATE_CONFLICT", { message: "The payout is no longer pending or its version changed. Reload before continuing." })
  }
  await deps.auditRepository.append(tx, {
    actorType: "admin", actorUserId: input.actorUserId, command: `withdrawal_payout.${input.state}`,
    entityType: "withdrawal_operation", entityId: input.payoutId,
    fromState: "pending", toState: input.state, requestId: input.requestId,
    entityVersion: input.expectedVersion + 1,
    metadata: { userId: input.userId, transferReference: input.transferReference, failureCode: input.failureCode },
  })
  await deps.notificationRepository.create(tx, {
    userId: input.userId, kind: "client_value_updated",
    title: input.state === "paid" ? "Withdrawal payout recorded as paid" : "Withdrawal payout needs attention",
    body: input.state === "paid"
      ? "Your withdrawal payout has been recorded as paid. Contact support if you have not received it."
      : "Your withdrawal payout could not be completed. Contact support for assistance.",
    payload: { payoutId: input.payoutId },
  })
}
