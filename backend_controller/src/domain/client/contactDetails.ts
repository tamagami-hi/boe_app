import { verifyDummyPassword, verifyPassword } from "../../auth/passwordHasher.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import type { EmailVerificationState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { CredentialWriteRepository } from "../../repositories/credentialRepository.js"
import type { EmailVerificationRepository } from "../../repositories/emailVerificationRepository.js"
import type { IdentityLockRepository } from "../../repositories/identityLockRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { enqueueEmail, type EnqueueEmailDeps } from "../email/enqueueEmail.js"
import { phoneEnding } from "../shared/phoneNumber.js"

const NOTICE_TEMPLATE_VERSION = "v1"

export interface ContactDetailsDeps extends EnqueueEmailDeps {
  readonly userRepository: UserWriteRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly emailVerificationRepository: Pick<EmailVerificationRepository, "findLatestByUser">
  readonly applicationRepository: Pick<ApplicationWriteRepository, "findContactOwner">
  readonly identityLockRepository: IdentityLockRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: { readonly sesConfigurationSet: string }
}

export interface ClientProfile {
  readonly userId: string
  readonly fullName: string
  readonly email: string
  readonly emailVerification: EmailVerificationState | "not_started"
  readonly phone: string
  readonly phoneVerified: false
  readonly version: string
}

export type ChangePhoneOutcome =
  | { readonly kind: "changed"; readonly profile: ClientProfile }
  | { readonly kind: "unchanged"; readonly profile: ClientProfile }
  | { readonly kind: "incorrect_password" }
  | { readonly kind: "phone_taken" }

const toProfile = (
  user: Readonly<{ id: string; full_name: string; email_normalized: string; phone_e164: string; version: string }>,
  verification: EmailVerificationState | null,
): ClientProfile => ({
  userId: user.id,
  fullName: user.full_name,
  email: user.email_normalized,
  emailVerification: verification ?? "not_started",
  phone: user.phone_e164,
  phoneVerified: false,
  version: user.version,
})

export const readClientProfile = async (
  tx: Transaction,
  deps: Pick<ContactDetailsDeps, "userRepository" | "emailVerificationRepository">,
  userId: string,
): Promise<ClientProfile> => {
  const user = await deps.userRepository.findById(tx, userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const verification = await deps.emailVerificationRepository.findLatestByUser(tx, userId)
  return toProfile(user, verification?.state ?? null)
}

const passwordMatches = async (
  tx: Transaction,
  deps: ContactDetailsDeps,
  userId: UserId,
  candidate: string,
): Promise<boolean> => {
  await deps.credentialRepository.lockByUserId(tx, userId)
  const storedHash = await deps.userRepository.findPasswordHash(tx, userId)
  if (storedHash === null) {
    await verifyDummyPassword(candidate)
    return false
  }
  return verifyPassword(storedHash, candidate)
}

export const changeClientPhone = async (
  tx: Transaction,
  deps: ContactDetailsDeps,
  input: Readonly<{ userId: string; phoneE164: string; currentPassword: string; requestId: string }>,
): Promise<ChangePhoneOutcome> => {
  const userId = input.userId as UserId
  await deps.identityLockRepository.lockIdentities(tx, { phoneE164: input.phoneE164 })
  const user = await deps.userRepository.lockById(tx, userId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.account_state !== "active") throw new AppError("ACCOUNT_NOT_ACTIVE")

  if (!(await passwordMatches(tx, deps, userId, input.currentPassword))) return { kind: "incorrect_password" }

  const verification = (await deps.emailVerificationRepository.findLatestByUser(tx, input.userId))?.state ?? null
  if (user.phone_e164 === input.phoneE164) return { kind: "unchanged", profile: toProfile(user, verification) }

  const owner = await deps.applicationRepository.findContactOwner(tx, {
    phoneE164: input.phoneE164,
    excludeUserId: input.userId,
  })
  if (owner !== null) return { kind: "phone_taken" }

  const now = deps.clock()
  const updated = await deps.userRepository.updatePhone(tx, {
    userId,
    phoneE164: input.phoneE164,
    expectedVersion: user.version,
    now,
  })
  if (updated === null) throw new AppError("STATE_CONFLICT")

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "user.phone_changed",
    entityType: "user",
    entityId: input.userId,
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: { previousEnding: phoneEnding(user.phone_e164), newEnding: phoneEnding(input.phoneE164) },
  })

  await enqueueEmail(tx, deps, {
    recipient: user.email_normalized,
    template: { templateKey: "contact_phone_changed", userId: input.userId },
    templateVersion: NOTICE_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "user.phone_changed",
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: input.userId,
    requestId: input.requestId,
    deduplicationKey: `contact_phone_changed:${input.userId}:${updated.version}`,
    payload: { template: "contact_phone_changed", phoneEnding: phoneEnding(input.phoneE164) },
  })

  return { kind: "changed", profile: toProfile(updated, verification) }
}
