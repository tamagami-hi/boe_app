import type { Transaction, UserId } from "../../db/repositories.js"
import type { PasswordTokenPurpose } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { PasswordLinkDeliveryStatus } from "../../repositories/passwordTokenRepository.js"
import { issuePasswordLinkMail, type PasswordLinkMailDeps, type QueuedPasswordLink } from "../auth/passwordLinkMail.js"

export const CLIENT_ONLY_MESSAGE = "Password links from this screen are only for client accounts."
export const INACTIVE_CLIENT_MESSAGE = "Only an active client account can be sent a password link."

export type PasswordLinkState = "active" | "expired" | "closed"

export interface ClientPasswordAccess {
  readonly userId: string
  readonly hasPassword: boolean
  readonly nextLinkAllowedAt: Date | null
  readonly latestLink: {
    readonly purpose: PasswordTokenPurpose
    readonly state: PasswordLinkState
    readonly createdAt: Date
    readonly expiresAt: Date
    readonly delivery: PasswordLinkDeliveryStatus | null
  } | null
}

const requireClient = async (tx: Transaction, deps: PasswordLinkMailDeps, userId: string): Promise<void> => {
  const grants = await deps.userRepository.findActiveRolesAndPermissions(tx, userId as UserId)
  if (grants.roles.length > 0) throw new AppError("STATE_CONFLICT", { message: CLIENT_ONLY_MESSAGE })
}

export const sendClientPasswordLink = async (
  tx: Transaction,
  deps: PasswordLinkMailDeps,
  input: Readonly<{ userId: string; actorUserId: string; requestId: string; linkBase: string }>,
): Promise<QueuedPasswordLink> => {
  await requireClient(tx, deps, input.userId)
  try {
    return await issuePasswordLinkMail(tx, deps, {
      userId: input.userId,
      requestId: input.requestId,
      requester: { kind: "admin", userId: input.actorUserId },
      linkBase: input.linkBase,
    })
  } catch (error) {
    if (error instanceof AppError && error.code === "ACCOUNT_NOT_ACTIVE") {
      throw new AppError("STATE_CONFLICT", { message: INACTIVE_CLIENT_MESSAGE })
    }
    throw error
  }
}

const linkState = (expiresAt: Date, consumedAt: Date | null, now: Date): PasswordLinkState => {
  if (consumedAt !== null) return "closed"
  return expiresAt.getTime() <= now.getTime() ? "expired" : "active"
}

export const readClientPasswordAccess = async (
  tx: Transaction,
  deps: Pick<PasswordLinkMailDeps, "userRepository" | "passwordTokenRepository" | "config">,
  input: Readonly<{ userId: string; now: Date }>,
): Promise<ClientPasswordAccess> => {
  const user = await deps.userRepository.findById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const passwordHash = await deps.userRepository.findPasswordHash(tx, input.userId as UserId)
  const latest = await deps.passwordTokenRepository.findLatestLink(tx, input.userId)
  const cooldownEnds =
    latest === null ? null : new Date(latest.createdAt.getTime() + deps.config.requestCooldownMs)
  return {
    userId: input.userId,
    hasPassword: passwordHash !== null,
    nextLinkAllowedAt: cooldownEnds !== null && cooldownEnds.getTime() > input.now.getTime() ? cooldownEnds : null,
    latestLink:
      latest === null
        ? null
        : {
            purpose: latest.purpose,
            state: linkState(latest.expiresAt, latest.consumedAt, input.now),
            createdAt: latest.createdAt,
            expiresAt: latest.expiresAt,
            delivery: latest.delivery,
          },
  }
}
