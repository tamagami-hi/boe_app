import type { InvestmentOrder, SipPlan, Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { deriveInvestingEligibility } from "./investingEligibility.js"

export interface CreateSipInstallmentOrderDeps {
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly clock: () => Date
}

export interface CreateSipInstallmentOrderInput {
  readonly plan: SipPlan
  readonly duePeriod: string
  readonly requestId: string
}

export type CreateSipInstallmentOrderResult =
  | { readonly outcome: "created"; readonly order: InvestmentOrder }
  | { readonly outcome: "already_exists" }
  | { readonly outcome: "not_eligible" }
  | { readonly outcome: "fund_not_published" }

export const createSipInstallmentOrder = async (
  tx: Transaction,
  deps: CreateSipInstallmentOrderDeps,
  input: CreateSipInstallmentOrderInput,
): Promise<CreateSipInstallmentOrderResult> => {
  const now = deps.clock()
  const { plan } = input

  const user = await deps.userRepository.lockById(tx, plan.user_id as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const compliance = await deps.orderRepository.latestCompliance(tx, plan.user_id)
  const { eligibility } = deriveInvestingEligibility({
    accountState: user.account_state,
    emailVerification:
      compliance.emailVerificationState === null
        ? null
        : { state: compliance.emailVerificationState },
  })
  if (eligibility !== "eligible") return { outcome: "not_eligible" }

  const terms = await deps.orderRepository.findFundOrderTerms(tx, plan.fund_id)
  if (terms === null || terms.fundState !== "published" || terms.fundVersionId === null) {
    return { outcome: "fund_not_published" }
  }

  const order = await deps.orderRepository.createSipInstallment(tx, {
    userId: plan.user_id,
    fundId: plan.fund_id,
    fundVersionId: terms.fundVersionId,
    sipPlanId: plan.id,
    amountPaise: plan.amount_paise,
    currency: terms.currency,
    duePeriod: input.duePeriod,
    now,
  })
  if (order === null) return { outcome: "already_exists" }

  await deps.auditRepository.append(tx, {
    actorType: "system",
    actorUserId: null,
    command: "sip.installment_order.create",
    entityType: "investment_order",
    entityId: order.id,
    toState: "submitted",
    requestId: input.requestId,
    entityVersion: Number(order.version),
    metadata: { type: "sip_installment", sipPlanId: plan.id, fundId: plan.fund_id, duePeriod: input.duePeriod },
  })
  await deps.notificationRepository.create(tx, {
    userId: plan.user_id,
    kind: "sip_installment_due",
    title: "SIP installment due",
    body: plan.collection_mode === "phonepe_autopay"
      ? "Your monthly SIP installment is scheduled for automatic collection."
      : "Your monthly SIP installment is due. Open the app to pay it.",
    payload: { sipPlanId: plan.id, orderId: order.id },
  })

  return { outcome: "created", order }
}
