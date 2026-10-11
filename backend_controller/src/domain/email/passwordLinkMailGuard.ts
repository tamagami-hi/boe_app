import { assessPasswordTokenBinding } from "../auth/passwordTokenBinding.js"
import type { PasswordTokenRepository } from "../../repositories/passwordTokenRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface PasswordLinkMailGuardDeps {
  readonly passwordTokenRepository: Pick<PasswordTokenRepository, "findValidityContext">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const referencedTokenId = (payload: unknown): string | null => {
  if (typeof payload !== "object" || payload === null) return null
  const reference = (payload as Readonly<Record<string, unknown>>).passwordTokenId
  return typeof reference === "string" && UUID_PATTERN.test(reference) ? reference : null
}

export const createPasswordLinkMailGuard =
  (deps: PasswordLinkMailGuardDeps): SendGuard =>
  async (tx, { event, delivery, now }) => {
    const tokenId = referencedTokenId(event.payload)
    if (tokenId === null) return cancel("reference_missing")

    const context = await deps.passwordTokenRepository.findValidityContext(tx, tokenId)
    if (context === null) return cancel("token_missing")
    if (context.token.userId !== delivery.user_id) return cancel("user_mismatch")
    if (context.token.consumedAt !== null) return cancel("consumed")
    if (context.token.expiresAt.getTime() <= now.getTime()) return cancel("expired")

    const rejection = assessPasswordTokenBinding(context)
    return rejection === null ? { kind: "send" } : cancel(rejection)
  }
