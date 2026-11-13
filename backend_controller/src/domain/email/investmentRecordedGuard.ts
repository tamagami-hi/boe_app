import type { UserId } from "../../db/repositories.js"
import type { ClientReceiptRepository } from "../../repositories/clientReceiptRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface InvestmentRecordedGuardDeps {
  readonly clientReceiptRepository: Pick<ClientReceiptRepository, "findByUser">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const entryId = typeof record.entryId === "string" && UUID_PATTERN.test(record.entryId) ? record.entryId : null
  const boundEmailRevision = typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null
  return { entryId, boundEmailRevision }
}

export const createInvestmentRecordedGuard =
  (deps: InvestmentRecordedGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const fields = fieldsOf(event.payload)
    if (fields.entryId === null || fields.boundEmailRevision === null || delivery.user_id === null) {
      return cancel("reference_missing")
    }
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== fields.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const recording = await deps.clientReceiptRepository.findByUser(tx, { userId: user.id, entryId: fields.entryId })
    if (recording === null) return cancel("recording_missing")
    if (recording.reversedAt !== null) return cancel("recording_reversed")
    return { kind: "send" }
  }
