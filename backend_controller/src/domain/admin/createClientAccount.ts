import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailVerificationRepository } from "../../repositories/emailVerificationRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import {
  issuePasswordToken,
  type IssuedPasswordToken,
  type PasswordCredentialDeps,
} from "../auth/passwordCredential.js"

export interface CreateClientAccountDeps extends PasswordCredentialDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly emailVerificationRepository: EmailVerificationRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
}

export interface CreateClientAccountInput {
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly fullName: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface CreatedClientAccount {
  readonly userId: string
  readonly invite: IssuedPasswordToken
}

export const createClientAccount = async (
  tx: Transaction,
  deps: CreateClientAccountDeps,
  input: CreateClientAccountInput,
): Promise<CreatedClientAccount> => {
  const conflict = await deps.applicationRepository.findActiveConflict(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
  })
  if (conflict !== null) {
    throw new AppError("STATE_CONFLICT", {
      fields: {
        email: [
          conflict.kind === "user"
            ? "an account already uses this email address or phone number"
            : "a signup application is already in flight for this email address or phone number",
        ],
      },
    })
  }

  const now = deps.clock()
  const user = await deps.userRepository.createAdminCreatedActive(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
    fullName: input.fullName,
    activatedAt: now,
  })

  const started = await deps.emailVerificationRepository.start(tx, { userId: user.id, now })
  if (started === null) throw new AppError("STATE_CONFLICT")

  const invite = await issuePasswordToken(tx, deps, {
    userId: user.id,
    purpose: "set",
    requestId: input.requestId,
  })

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "client_account.created",
    entityType: "user",
    entityId: user.id,
    toState: "active",
    requestId: input.requestId,
    entityVersion: Number(user.version),
    metadata: {
      credentialSource: "invite",
      emailVerification: "pending",
      applicationId: null,
    },
  })

  return { userId: user.id, invite }
}
