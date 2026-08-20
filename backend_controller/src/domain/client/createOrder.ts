/**
 * createOrder command (spec 03 §5.2, §6; §2.3 eligibility). An eligible client
 * places a one-time purchase order for a published fund. The command runs inside
 * a caller-owned transaction (the route wraps it in the idempotency protocol):
 * it locks the user, re-derives investing eligibility from the live account
 * state + latest KYC + latest risk (never a cached value), verifies the fund is
 * published and the amount meets the published minimum, then inserts the order
 * in `submitted` and appends an audit event atomically.
 *
 * The created `lump_sum` order pins the fund's current published version at
 * creation time (`fund_version_id` is NOT NULL).
 */
import type { InvestmentOrder, Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { deriveInvestingEligibility } from "./investingEligibility.js"

export interface CreateOrderDeps {
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface CreateOrderInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly requestId: string
}

/** Map a non-eligible derivation to its wire error (spec 05 §5.1 error table). */
const assertEligible = (
  eligibility: ReturnType<typeof deriveInvestingEligibility>["eligibility"],
): void => {
  if (eligibility === "eligible") return
  // A non-active account (suspended/closed/invited) is ACCOUNT_NOT_ACTIVE;
  // unmet KYC/risk is an unsatisfied prerequisite -> STATE_CONFLICT.
  if (eligibility === "suspended" || eligibility === "blocked") {
    throw new AppError("ACCOUNT_NOT_ACTIVE")
  }
  throw new AppError("STATE_CONFLICT")
}

export const createOrder = async (
  tx: Transaction,
  deps: CreateOrderDeps,
  input: CreateOrderInput,
): Promise<InvestmentOrder> => {
  const now = deps.clock()

  // 1. Lock the user and re-derive eligibility under that lock.
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const compliance = await deps.orderRepository.latestCompliance(tx, input.userId)
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
  assertEligible(eligibility)

  // 2. The fund must be published and expose a minimum purchase amount.
  const terms = await deps.orderRepository.findFundOrderTerms(tx, input.fundId)
  if (terms === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (
    terms.fundState !== "published" ||
    terms.fundVersionId === null ||
    terms.minimumPurchasePaise === null
  ) {
    throw new AppError("STATE_CONFLICT")
  }

  // 3. Amount must meet the published minimum (exact integer paise).
  if (BigInt(input.amountPaise) < BigInt(terms.minimumPurchasePaise)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { amountPaise: [`amount is below the minimum of ${terms.minimumPurchasePaise} paise`] },
    })
  }

  // 4. Create the order and record the audit event atomically.
  const order = await deps.orderRepository.createPurchase(tx, {
    userId: input.userId,
    fundId: input.fundId,
    fundVersionId: terms.fundVersionId,
    amountPaise: input.amountPaise,
    currency: terms.currency,
    now,
  })
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "order.create",
    entityType: "investment_order",
    entityId: order.id,
    toState: "submitted",
    requestId: input.requestId,
    entityVersion: Number(order.version),
    metadata: { type: "lump_sum", fundId: input.fundId },
  })
  return order
}
