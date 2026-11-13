import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type {
  ErasureBlockerCode,
  ErasureBlockerCounts,
  ErasureSubject,
  PriorErasure,
} from "../../repositories/clientErasureInspectRepository.js"
import { ERASED_NAME } from "./erasureContacts.js"
import { blockerCountsOf, reachOf, type ErasureReachDeps } from "./erasureReach.js"

export type ErasurePath = "deleted" | "kept_as_record"
export type ErasureKeptBecause = "email_verified" | "money_records"

export interface ErasureBlocker {
  readonly code: ErasureBlockerCode
  readonly count: number
  readonly message: string
}

export interface ErasurePlan {
  readonly path: ErasurePath
  readonly keptBecause: ErasureKeptBecause | null
}

export type ErasureCheck =
  | Readonly<{
      state: "already_erased"
      userId: string
      fullName: string | null
      plan: ErasurePlan
      erasedAt: Date
    }>
  | Readonly<{
      state: "erasable" | "blocked"
      userId: string
      fullName: string
      emailVerified: boolean
      plan: ErasurePlan
      blockers: readonly ErasureBlocker[]
    }>

export type ClientErasureCheckDeps = ErasureReachDeps

const counted = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

const BLOCKER_MESSAGES: Readonly<Record<ErasureBlockerCode, (count: number) => string>> = {
  staff_account: () => "This is a staff account. Staff and admin accounts are never erased here.",
  legal_hold: (count) =>
    `${counted(count, "legal hold is", "legal holds are")} placed on this client's account, applications, emails, money records or audit entries.`,
  holds_money: (count) =>
    `The client still has an invested amount or a current value in ${counted(count, "fund", "funds")}. Both must be zero in every fund.`,
  open_orders: (count) => `${counted(count, "order is", "orders are")} still open.`,
  open_payments: (count) => `${counted(count, "payment is", "payments are")} not final yet.`,
  open_refunds: (count) => `${counted(count, "refund is", "refunds are")} still pending.`,
  open_withdrawals: (count) => `${counted(count, "withdrawal payout is", "withdrawal payouts are")} still pending.`,
  failed_withdrawals: (count) =>
    `${counted(count, "withdrawal payout", "withdrawal payouts")} failed, so the client is still owed that money. Settle it first.`,
  unsettled_maturities: (count) => `${counted(count, "maturity is", "maturities are")} marked but not settled.`,
  active_sip_schedules: (count) => `${counted(count, "SIP schedule is", "SIP schedules are")} still active. Close it first.`,
  scheduled_maturities: (count) =>
    `${counted(count, "maturity date is", "maturity dates are")} still scheduled. Resolve or cancel it first.`,
  open_maturity_offers: (count) =>
    `${counted(count, "maturity choice sent to the client is", "maturity choices sent to the client are")} still open.`,
  active_sip_plans: (count) => `${counted(count, "SIP plan or AutoPay setup is", "SIP plans or AutoPay setups are")} not finished.`,
  mail_in_flight: () => "An email to this client is being sent right now. Try again in a minute.",
}

const BLOCKER_ORDER: readonly ErasureBlockerCode[] = Object.keys(BLOCKER_MESSAGES) as ErasureBlockerCode[]

export const blockersOf = (counts: ErasureBlockerCounts): readonly ErasureBlocker[] =>
  BLOCKER_ORDER.filter((code) => counts[code] > 0).map((code) => ({
    code,
    count: counts[code],
    message: BLOCKER_MESSAGES[code](counts[code]),
  }))

export const planFor = (subject: ErasureSubject, hasMoneyRecords: boolean): ErasurePlan => {
  if (subject.emailVerified) return { path: "kept_as_record", keptBecause: "email_verified" }
  if (hasMoneyRecords) return { path: "kept_as_record", keptBecause: "money_records" }
  return { path: "deleted", keptBecause: null }
}

const isPath = (value: unknown): value is ErasurePath => value === "deleted" || value === "kept_as_record"

const isKeptBecause = (value: unknown): value is ErasureKeptBecause =>
  value === "email_verified" || value === "money_records"

export const planOfPrior = (prior: PriorErasure): ErasurePlan => {
  const metadata = (typeof prior.metadata === "object" && prior.metadata !== null ? prior.metadata : {}) as Record<
    string,
    unknown
  >
  const path = isPath(metadata.path) ? metadata.path : "kept_as_record"
  return { path, keptBecause: isKeptBecause(metadata.keptBecause) ? metadata.keptBecause : null }
}

export const blockedError = (blockers: readonly ErasureBlocker[]): AppError =>
  new AppError("STATE_CONFLICT", {
    message: `This client cannot be erased yet. ${blockers.map((blocker) => blocker.message).join(" ")}`,
    fields: Object.fromEntries(blockers.map((blocker) => [blocker.code, [blocker.message]])),
  })

export const checkClientErasure = async (
  tx: Transaction,
  deps: ClientErasureCheckDeps,
  userId: string,
): Promise<ErasureCheck> => {
  const repository = deps.erasureInspectRepository
  const prior = await repository.findPriorErasure(tx, userId)
  const subject = await repository.findSubject(tx, userId, false)
  if (prior !== null) {
    return {
      state: "already_erased",
      userId,
      fullName: subject === null ? null : ERASED_NAME,
      plan: planOfPrior(prior),
      erasedAt: prior.erasedAt,
    }
  }
  if (subject === null) throw new AppError("RESOURCE_NOT_FOUND")
  const reach = await reachOf(tx, deps, subject)
  const blockers = blockersOf(await blockerCountsOf(tx, deps, subject, reach))
  return {
    state: blockers.length === 0 ? "erasable" : "blocked",
    userId,
    fullName: subject.piiTombstonedAt === null ? subject.fullName : ERASED_NAME,
    emailVerified: subject.emailVerified,
    plan: planFor(subject, await repository.hasMoneyRecords(tx, userId)),
    blockers,
  }
}
