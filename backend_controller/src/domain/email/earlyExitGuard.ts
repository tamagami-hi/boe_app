import type { UserId } from "../../db/repositories.js"
import type { SipEarlyExitRepository } from "../../repositories/earlyExitRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface SipEarlyExitGuardDeps {
  readonly sipEarlyExitRepository: Pick<SipEarlyExitRepository, "findForUser">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const earlyExitId = typeof record.earlyExitId === "string" && UUID_PATTERN.test(record.earlyExitId) ? record.earlyExitId : null
  const boundEmailRevision = typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null
  return { earlyExitId, boundEmailRevision }
}

export const createSipEarlyExitGuard =
  (deps: SipEarlyExitGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const fields = fieldsOf(event.payload)
    if (fields.earlyExitId === null || fields.boundEmailRevision === null || delivery.user_id === null) {
      return cancel("reference_missing")
    }
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== fields.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const earlyExit = await deps.sipEarlyExitRepository.findForUser(tx, { userId: user.id, earlyExitId: fields.earlyExitId })
    if (earlyExit === null) return cancel("early_exit_missing")
    return { kind: "send" }
  }
