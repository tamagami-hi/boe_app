import type { Transaction, User, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { EmailChangeRepository } from "../../repositories/emailChangeRepository.js"
import type { EmailVerificationRepository } from "../../repositories/emailVerificationRepository.js"
import type { IdentityLockRepository } from "../../repositories/identityLockRepository.js"
import type {
  ContactClaims,
  ContactHistoryEntry,
  UserContactRepository,
} from "../../repositories/userContactRepository.js"
import {
  issuePasswordLinkMail,
  type PasswordLinkMailDeps,
  type QueuedPasswordLink,
} from "../auth/passwordLinkMail.js"
import { requirePasswordLinkBase } from "../auth/passwordLinkUrl.js"
import { phoneEnding } from "../shared/phoneNumber.js"
import { RELEASED_EMAIL_DOMAIN, refuseReservedEmail } from "../shared/reservedContacts.js"
import { contactConflictMessage } from "./createClientAccount.js"

export const CONTACTS_CLIENT_ONLY_MESSAGE = "Email and phone can only be changed here for client accounts."
export const CORRECTION_NOT_ACTIVE_MESSAGE =
  "Only an active client account that has not set a password can have its email or phone corrected here."
export const CORRECTION_PASSWORD_SET_MESSAGE =
  "This client has already set a password, so they change their own email or phone from their profile."
export const CORRECTION_UNCHANGED_MESSAGE = "Enter an email address or phone number that differs from the current one."
export const RELEASE_NOT_CLOSED_MESSAGE = "Only a closed account can release its email and phone."
export const RELEASE_ALREADY_DONE_MESSAGE = "This account's email and phone were already released."
export const STALE_ACCOUNT_MESSAGE = "The account changed since you opened it. Reload it and try again."

export const CORRECTION_LIMIT = 3
export const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000
export const CORRECTION_LIMIT_MESSAGE = `This client's email or phone was already corrected ${String(CORRECTION_LIMIT)} times in the last 24 hours. Try again later.`

const RELEASE_PHONE_DRAWS = 3
const HISTORY_LIMIT = 100

export interface ClientContactsDeps extends PasswordLinkMailDeps {
  readonly identityLockRepository: IdentityLockRepository
  readonly userContactRepository: UserContactRepository
  readonly emailVerificationRepository: Pick<EmailVerificationRepository, "consumeActiveCode">
  readonly emailChangeRepository: Pick<EmailChangeRepository, "retireActive">
}

export interface ContactActor {
  readonly actorUserId: string
  readonly requestId: string
}

export interface CorrectedContacts {
  readonly user: User
  readonly emailChanged: boolean
  readonly phoneChanged: boolean
  readonly passwordLink: QueuedPasswordLink | null
}

export interface ReleasedContacts {
  readonly user: User
  readonly releasedAt: Date
}

export interface ContactHistory {
  readonly releasedAt: Date | null
  readonly entries: readonly ContactHistoryEntry[]
}

const conflict = (message: string): AppError => new AppError("STATE_CONFLICT", { message })

const requireClientAccount = async (tx: Transaction, deps: ClientContactsDeps, userId: string): Promise<void> => {
  const grants = await deps.userRepository.findActiveRolesAndPermissions(tx, userId as UserId)
  if (grants.roles.length > 0) throw conflict(CONTACTS_CLIENT_ONLY_MESSAGE)
}

const requireVersion = (user: User, expectedVersion: number): void => {
  if (Number(user.version) !== expectedVersion) throw conflict(STALE_ACCOUNT_MESSAGE)
}

const claimedContactsError = (claims: ContactClaims): AppError | null => {
  const fields = Object.fromEntries(
    (["email", "phone"] as const).flatMap((contact) => {
      const kind = claims[contact]
      return kind === null ? [] : [[contact, [contactConflictMessage(kind, contact)]]]
    }),
  )
  return Object.keys(fields).length === 0 ? null : new AppError("STATE_CONFLICT", { fields })
}

const requireCorrectionAllowance = async (
  tx: Transaction,
  deps: ClientContactsDeps,
  userId: string,
  now: Date,
): Promise<void> => {
  const recent = await deps.userContactRepository.countCorrectionsSince(tx, {
    userId,
    since: new Date(now.getTime() - CORRECTION_WINDOW_MS),
  })
  if (recent.count < CORRECTION_LIMIT || recent.oldest === null) return
  const reopensInMs = recent.oldest.getTime() + CORRECTION_WINDOW_MS - now.getTime()
  throw new AppError("RATE_LIMITED", {
    message: CORRECTION_LIMIT_MESSAGE,
    retryAfterSeconds: Math.max(1, Math.ceil(reopensInMs / 1000)),
  })
}

const requireCorrectable = async (tx: Transaction, deps: ClientContactsDeps, userId: string): Promise<User> => {
  const user = await deps.userRepository.lockById(tx, userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  await requireClientAccount(tx, deps, userId)
  if (user.account_state !== "active") throw conflict(CORRECTION_NOT_ACTIVE_MESSAGE)
  const credential = await deps.credentialRepository.lockByUserId(tx, userId as UserId)
  if (credential?.hasPassword === true) throw conflict(CORRECTION_PASSWORD_SET_MESSAGE)
  return user
}

export const correctClientContacts = async (
  tx: Transaction,
  deps: ClientContactsDeps,
  input: ContactActor &
    Readonly<{ userId: string; emailNormalized?: string; phoneE164?: string; expectedVersion: number }>,
): Promise<CorrectedContacts> => {
  if (input.emailNormalized !== undefined) refuseReservedEmail(input.emailNormalized)
  await deps.identityLockRepository.lockIdentities(tx, {
    ...(input.emailNormalized === undefined ? {} : { emailNormalized: input.emailNormalized }),
    ...(input.phoneE164 === undefined ? {} : { phoneE164: input.phoneE164 }),
  })
  const user = await requireCorrectable(tx, deps, input.userId)
  requireVersion(user, input.expectedVersion)
  const now = deps.clock()
  await requireCorrectionAllowance(tx, deps, input.userId, now)

  const nextEmail = input.emailNormalized ?? user.email_normalized
  const nextPhone = input.phoneE164 ?? user.phone_e164
  const emailChanged = nextEmail !== user.email_normalized
  const phoneChanged = nextPhone !== user.phone_e164
  if (!emailChanged && !phoneChanged) throw new AppError("VALIDATION_FAILED", { message: CORRECTION_UNCHANGED_MESSAGE })
  const linkBase = emailChanged ? requirePasswordLinkBase(deps.config.passwordLinks) : null

  const claimed = claimedContactsError(
    await deps.userContactRepository.findContactClaims(tx, {
      ...(emailChanged ? { emailNormalized: nextEmail } : {}),
      ...(phoneChanged ? { phoneE164: nextPhone } : {}),
      excludeUserId: input.userId,
    }),
  )
  if (claimed !== null) throw claimed

  const updated = await deps.userContactRepository.correctContacts(tx, {
    userId: input.userId,
    emailNormalized: nextEmail,
    phoneE164: nextPhone,
    emailChanged,
    expectedVersion: user.version,
    now,
  })
  if (updated === null) throw conflict(STALE_ACCOUNT_MESSAGE)

  if (emailChanged) {
    await deps.passwordTokenRepository.consumeActive(tx, { userId: input.userId, now })
    await deps.emailVerificationRepository.consumeActiveCode(tx, { userId: input.userId, now })
  }

  const history = await deps.userContactRepository.appendHistory(tx, {
    userId: input.userId,
    changeKind: "admin_correction",
    previousEmail: user.email_normalized,
    previousPhone: user.phone_e164,
    newEmail: nextEmail,
    newPhone: nextPhone,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    reasonCode: null,
    reasonDetail: null,
    now,
  })

  const passwordLink =
    linkBase === null
      ? null
      : await issuePasswordLinkMail(tx, deps, {
          userId: input.userId,
          requestId: input.requestId,
          requester: { kind: "admin", userId: input.actorUserId },
          linkBase,
        })

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "client_contacts.corrected",
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: {
      contactHistoryId: history.id,
      emailChanged,
      phoneChanged,
      previousEmail: deps.crypto.maskEmail(user.email_normalized),
      currentEmail: deps.crypto.maskEmail(nextEmail),
      previousPhoneEnding: phoneEnding(user.phone_e164),
      currentPhoneEnding: phoneEnding(nextPhone),
      passwordTokenId: passwordLink?.tokenId ?? null,
    },
  })

  return { user: updated, emailChanged, phoneChanged, passwordLink }
}

const releasedEmailFor = (userId: string): string => `released+${userId.replaceAll("-", "")}@${RELEASED_EMAIL_DOMAIN}`

const drawReleasePhone = async (tx: Transaction, deps: ClientContactsDeps): Promise<string> => {
  for (let draw = 0; draw < RELEASE_PHONE_DRAWS; draw += 1) {
    const candidate = await deps.userContactRepository.nextReleasePhone(tx)
    if (!(await deps.userContactRepository.isPhoneHeld(tx, candidate))) return candidate
  }
  throw new AppError("INTERNAL_ERROR")
}

const requireReleasable = async (
  tx: Transaction,
  deps: ClientContactsDeps,
  input: Readonly<{ userId: string; expectedVersion: number }>,
): Promise<User> => {
  const seen = await deps.userRepository.findById(tx, input.userId as UserId)
  if (seen === null) throw new AppError("RESOURCE_NOT_FOUND")
  await deps.identityLockRepository.lockIdentities(tx, {
    emailNormalized: seen.email_normalized,
    phoneE164: seen.phone_e164,
  })
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.email_normalized !== seen.email_normalized || user.phone_e164 !== seen.phone_e164) {
    throw conflict(STALE_ACCOUNT_MESSAGE)
  }
  await requireClientAccount(tx, deps, input.userId)
  if (user.account_state !== "closed") throw conflict(RELEASE_NOT_CLOSED_MESSAGE)
  if ((await deps.userContactRepository.findRelease(tx, input.userId)) !== null) {
    throw conflict(RELEASE_ALREADY_DONE_MESSAGE)
  }
  requireVersion(user, input.expectedVersion)
  return user
}

export const releaseClosedAccountContacts = async (
  tx: Transaction,
  deps: ClientContactsDeps,
  input: ContactActor &
    Readonly<{ userId: string; expectedVersion: number; reasonCode: string | null; reasonDetail: string | null }>,
): Promise<ReleasedContacts> => {
  const user = await requireReleasable(tx, deps, input)
  const now = deps.clock()
  const releasedEmail = releasedEmailFor(input.userId)
  const releasedPhone = await drawReleasePhone(tx, deps)

  const updated = await deps.userContactRepository.releaseContacts(tx, {
    userId: input.userId,
    emailNormalized: releasedEmail,
    phoneE164: releasedPhone,
    expectedVersion: user.version,
    now,
  })
  if (updated === null) throw conflict(STALE_ACCOUNT_MESSAGE)
  await deps.passwordTokenRepository.consumeActive(tx, { userId: input.userId, now })
  await deps.emailVerificationRepository.consumeActiveCode(tx, { userId: input.userId, now })
  await deps.emailChangeRepository.retireActive(tx, { userId: input.userId, now })

  const history = await deps.userContactRepository.appendHistory(tx, {
    userId: input.userId,
    changeKind: "closed_release",
    previousEmail: user.email_normalized,
    previousPhone: user.phone_e164,
    newEmail: releasedEmail,
    newPhone: releasedPhone,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    now,
  })

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "user.contacts_released",
    entityType: "user",
    entityId: input.userId,
    fromState: user.account_state,
    toState: updated.account_state,
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: {
      contactHistoryId: history.id,
      previousEmail: deps.crypto.maskEmail(user.email_normalized),
      previousPhoneEnding: phoneEnding(user.phone_e164),
      ...(input.reasonCode === null ? {} : { reasonCode: input.reasonCode }),
      ...(input.reasonDetail === null ? {} : { reason: input.reasonDetail }),
    },
  })

  return { user: updated, releasedAt: history.createdAt }
}

export const readContactHistory = async (
  tx: Transaction,
  deps: Pick<ClientContactsDeps, "userRepository" | "userContactRepository">,
  userId: string,
): Promise<ContactHistory> => {
  const user = await deps.userRepository.findById(tx, userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const entries = await deps.userContactRepository.listHistory(tx, { userId, limit: HISTORY_LIMIT })
  const release = await deps.userContactRepository.findRelease(tx, userId)
  return { releasedAt: release?.createdAt ?? null, entries }
}
