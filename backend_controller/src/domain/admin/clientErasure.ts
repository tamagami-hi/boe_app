import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { AuthSessionWriteRepository } from "../../repositories/authSessionRepository.js"
import type { ClientErasureDeleteRepository } from "../../repositories/clientErasureDeleteRepository.js"
import { ERASURE_COMMAND, type ErasureSubject } from "../../repositories/clientErasureInspectRepository.js"
import type { ClientErasureWriteRepository } from "../../repositories/clientErasureWriteRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { EmailChangeRepository } from "../../repositories/emailChangeRepository.js"
import type { EmailVerificationRepository } from "../../repositories/emailVerificationRepository.js"
import { CLIENT_SCRUB_TARGETS, RECEIPT_SCRUB_TARGET, scrubTarget, type ScrubOwner } from "../../repositories/erasureScrubTargets.js"
import type { IdentityLockRepository } from "../../repositories/identityLockRepository.js"
import type { PasswordTokenRepository } from "../../repositories/passwordTokenRepository.js"
import type { UserContactRepository } from "../../repositories/userContactRepository.js"
import { RELEASED_EMAIL_DOMAIN } from "../shared/reservedContacts.js"
import {
  blockedError,
  blockersOf,
  planFor,
  planOfPrior,
  type ClientErasureCheckDeps,
  type ErasurePath,
  type ErasurePlan,
} from "./clientErasureCheck.js"
import { erasedEmailFor, isPlaceholderEmail, isPlaceholderPhone } from "./erasureContacts.js"
import { blockerCountsOf, reachOf, type ClientReach } from "./erasureReach.js"

export const PATH_CHANGED_MESSAGE =
  "What erasure would do for this client changed since you checked. Check again before confirming."
export const STALE_CONTACTS_MESSAGE = "The client's email or phone changed while erasing. Check again and retry."

const RELEASE_PHONE_DRAWS = 3

export interface ClientErasureDeps extends ClientErasureCheckDeps {
  readonly erasureWriteRepository: ClientErasureWriteRepository
  readonly erasureDeleteRepository: ClientErasureDeleteRepository
  readonly userContactRepository: Pick<UserContactRepository, "nextReleasePhone" | "isPhoneHeld">
  readonly identityLockRepository: IdentityLockRepository
  readonly clientGrowthRepository: Pick<ClientGrowthRepository, "lockPosition">
  readonly authSessionRepository: Pick<AuthSessionWriteRepository, "revokeAllForUser">
  readonly passwordTokenRepository: Pick<PasswordTokenRepository, "consumeActive">
  readonly emailVerificationRepository: Pick<EmailVerificationRepository, "consumeActiveCode">
  readonly emailChangeRepository: Pick<EmailChangeRepository, "retireActive">
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface EraseClientInput {
  readonly userId: string
  readonly expectedPath: ErasurePath
  readonly actorUserId: string
  readonly requestId: string
}

export interface ErasureOutcome extends ErasurePlan {
  readonly userId: string
  readonly outcome: "erased" | "already_erased"
  readonly erasedAt: Date
}

interface LockedSubject {
  readonly seen: ErasureSubject
  readonly locked: ErasureSubject | null
}

interface ErasedAccount {
  readonly entityVersion: number
  readonly toState: string
}

const releasedEmailFor = (userId: string): string => `released+${userId.replaceAll("-", "")}@${RELEASED_EMAIL_DOMAIN}`

const alreadyErased = async (
  tx: Transaction,
  deps: ClientErasureDeps,
  userId: string,
): Promise<ErasureOutcome | null> => {
  const prior = await deps.erasureInspectRepository.findPriorErasure(tx, userId)
  return prior === null ? null : { userId, outcome: "already_erased", erasedAt: prior.erasedAt, ...planOfPrior(prior) }
}

const lockSubject = async (tx: Transaction, deps: ClientErasureDeps, userId: string): Promise<LockedSubject | null> => {
  const repository = deps.erasureInspectRepository
  const seen = await repository.findSubject(tx, userId, false)
  if (seen === null) return null
  await deps.identityLockRepository.lockIdentities(tx, { emailNormalized: seen.emailNormalized, phoneE164: seen.phoneE164 })
  for (const fundId of await repository.listLedgerFunds(tx, userId)) {
    await deps.clientGrowthRepository.lockPosition(tx, userId, fundId)
  }
  return { seen, locked: await repository.findSubject(tx, userId, true) }
}

const sameContacts = (left: ErasureSubject, right: ErasureSubject): boolean =>
  left.emailNormalized === right.emailNormalized && left.phoneE164 === right.phoneE164

const ownerOf = (subject: ErasureSubject, reach: ClientReach, applicationIds: readonly string[]): ScrubOwner => ({
  userId: subject.id,
  applicationIds,
  owned: reach.owned,
})

const drawReleasePhone = async (tx: Transaction, deps: ClientErasureDeps, current: string): Promise<string> => {
  if (isPlaceholderPhone(current)) return current
  for (let draw = 0; draw < RELEASE_PHONE_DRAWS; draw += 1) {
    const candidate = await deps.userContactRepository.nextReleasePhone(tx)
    if (!(await deps.userContactRepository.isPhoneHeld(tx, candidate))) return candidate
  }
  throw new AppError("INTERNAL_ERROR")
}

const revokeAccess = async (tx: Transaction, deps: ClientErasureDeps, userId: string, now: Date): Promise<void> => {
  const erasedEmail = erasedEmailFor(userId)
  await deps.authSessionRepository.revokeAllForUser(tx, { userId: userId as UserId, reason: "account_erased", now })
  await deps.erasureWriteRepository.clearPassword(tx, userId, now)
  await deps.passwordTokenRepository.consumeActive(tx, { userId, now })
  await deps.emailVerificationRepository.consumeActiveCode(tx, { userId, now })
  await deps.emailChangeRepository.retireActive(tx, { userId, now })
  await deps.erasureWriteRepository.overwriteEmailChangeTargets(tx, userId, deps.crypto.encryptRecipient(erasedEmail))
}

const keepAsRecord = async (
  tx: Transaction,
  deps: ClientErasureDeps,
  subject: ErasureSubject,
  reach: ClientReach,
  now: Date,
): Promise<ErasedAccount> => {
  const write = deps.erasureWriteRepository
  const erasedEmail = erasedEmailFor(subject.id)
  const updated = await write.tombstoneUser(tx, {
    userId: subject.id,
    emailNormalized: isPlaceholderEmail(subject.emailNormalized) ? subject.emailNormalized : releasedEmailFor(subject.id),
    phoneE164: await drawReleasePhone(tx, deps, subject.phoneE164),
    now,
  })
  if (updated === null) throw new AppError("STATE_CONFLICT", { message: STALE_CONTACTS_MESSAGE })
  await revokeAccess(tx, deps, subject.id, now)
  await write.eraseMail(tx, {
    userId: subject.id,
    applicationIds: reach.applicationIds,
    recipientHmac: deps.crypto.hmacRecipient(erasedEmail).hash,
    recipientMasked: deps.crypto.maskEmail(erasedEmail),
    now,
  })
  const rewrite = { userId: subject.id, erasedEmail, scrubber: reach.scrubber }
  await write.rewriteContactHistory(tx, rewrite)
  await write.overwriteLoginEmails(tx, rewrite)
  await write.tombstoneApplications(tx, { applicationIds: reach.applicationIds, erasedEmail, now })
  await write.clearConsentUserAgents(tx, reach.applicationIds)
  await write.eraseProviderEventPayloads(tx, subject.id, now)
  const owner = ownerOf(subject, reach, reach.applicationIds)
  for (const target of [...CLIENT_SCRUB_TARGETS, RECEIPT_SCRUB_TARGET]) {
    await scrubTarget(tx, target, owner, reach.scrubber)
  }
  return { entityVersion: Number(updated.version), toState: updated.account_state }
}

const deleteCompletely = async (
  tx: Transaction,
  deps: ClientErasureDeps,
  subject: ErasureSubject,
  reach: ClientReach,
  now: Date,
): Promise<ErasedAccount> => {
  await deps.erasureDeleteRepository.deleteClient(tx, {
    userId: subject.id,
    linkedApplicationId: subject.applicationId,
    applicationIds: reach.applicationIds,
    emails: reach.scrubber.emails,
    owned: reach.owned,
  })
  await deps.erasureWriteRepository.tombstoneApplications(tx, {
    applicationIds: reach.matchedApplicationIds,
    erasedEmail: erasedEmailFor(subject.id),
    now,
  })
  const matched = ownerOf(subject, reach, reach.matchedApplicationIds)
  for (const target of CLIENT_SCRUB_TARGETS.filter((candidate) => candidate.table === "application_reviews")) {
    await scrubTarget(tx, target, matched, reach.scrubber)
  }
  await scrubTarget(tx, RECEIPT_SCRUB_TARGET, matched, reach.scrubber)
  return { entityVersion: subject.version + 1, toState: "deleted" }
}

const requirePlan = async (
  tx: Transaction,
  deps: ClientErasureDeps,
  subject: ErasureSubject,
  reach: ClientReach,
  expectedPath: ErasurePath,
): Promise<ErasurePlan> => {
  const blockers = blockersOf(await blockerCountsOf(tx, deps, subject, reach))
  if (blockers.length > 0) throw blockedError(blockers)
  const inFlight = await deps.erasureWriteRepository.lockMail(tx, { userId: subject.id, applicationIds: reach.applicationIds })
  if (inFlight > 0) throw blockedError(blockersOf({ ...emptyCounts(), mail_in_flight: inFlight }))
  const plan = planFor(subject, await deps.erasureInspectRepository.hasMoneyRecords(tx, subject.id))
  if (plan.path !== expectedPath) {
    throw new AppError("STATE_CONFLICT", { message: PATH_CHANGED_MESSAGE, fields: { expectedPath: [PATH_CHANGED_MESSAGE] } })
  }
  return plan
}

const emptyCounts = () => ({
  staff_account: 0,
  legal_hold: 0,
  holds_money: 0,
  open_orders: 0,
  open_payments: 0,
  open_refunds: 0,
  open_withdrawals: 0,
  failed_withdrawals: 0,
  unsettled_maturities: 0,
  active_sip_schedules: 0,
  scheduled_maturities: 0,
  open_maturity_offers: 0,
  active_sip_plans: 0,
  mail_in_flight: 0,
})

export const eraseClient = async (
  tx: Transaction,
  deps: ClientErasureDeps,
  input: EraseClientInput,
): Promise<ErasureOutcome> => {
  const earlier = await alreadyErased(tx, deps, input.userId)
  if (earlier !== null) return earlier
  const lock = await lockSubject(tx, deps, input.userId)
  const raced = await alreadyErased(tx, deps, input.userId)
  if (raced !== null) return raced
  const subject = lock?.locked ?? null
  if (lock === null || subject === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (!sameContacts(lock.seen, subject)) throw new AppError("STATE_CONFLICT", { message: STALE_CONTACTS_MESSAGE })

  const reach = await reachOf(tx, deps, subject)
  const plan = await requirePlan(tx, deps, subject, reach, input.expectedPath)
  const now = deps.clock()
  await deps.erasureWriteRepository.markErasing(tx, subject.id)
  const erased =
    plan.path === "deleted"
      ? await deleteCompletely(tx, deps, subject, reach, now)
      : await keepAsRecord(tx, deps, subject, reach, now)

  const audit = await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: ERASURE_COMMAND,
    entityType: "user",
    entityId: subject.id,
    fromState: subject.accountState,
    toState: erased.toState,
    requestId: input.requestId,
    entityVersion: erased.entityVersion,
    metadata: { path: plan.path, keptBecause: plan.keptBecause },
  })
  return { userId: subject.id, outcome: "erased", erasedAt: new Date(audit.occurred_at), ...plan }
}
