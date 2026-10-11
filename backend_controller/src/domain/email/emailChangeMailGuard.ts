import type { EmailChangeRepository } from "../../repositories/emailChangeRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface EmailChangeMailGuardDeps {
  readonly emailChangeRepository: Pick<EmailChangeRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const referencedRequestId = (payload: unknown): string | null => {
  if (typeof payload !== "object" || payload === null) return null
  const reference = (payload as Readonly<Record<string, unknown>>).emailChangeRequestId
  return typeof reference === "string" && UUID_PATTERN.test(reference) ? reference : null
}

export const createEmailChangeMailGuard =
  (deps: EmailChangeMailGuardDeps): SendGuard =>
  async (tx, { event, delivery, now }) => {
    const requestId = referencedRequestId(event.payload)
    if (requestId === null) return cancel("reference_missing")
    const request = await deps.emailChangeRepository.findById(tx, requestId)
    if (request === null) return cancel("request_missing")
    if (request.userId !== delivery.user_id) return cancel("user_mismatch")
    if (request.consumedAt !== null) return cancel("consumed")
    if (request.expiresAt.getTime() <= now.getTime()) return cancel("expired")
    return { kind: "send" }
  }
