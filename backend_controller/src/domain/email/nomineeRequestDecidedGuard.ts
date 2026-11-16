import type { UserId } from "../../db/repositories.js"
import type { NomineeRequestRepository } from "../../repositories/nomineeRequestRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface NomineeRequestDecidedGuardDeps {
  readonly nomineeRequestRepository: Pick<NomineeRequestRepository, "find">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const id = record.nomineeRequestId
  const decision = record.decision
  return {
    nomineeRequestId: typeof id === "string" && UUID_PATTERN.test(id) ? id : null,
    decision: decision === "accepted" || decision === "declined" ? decision : null,
    boundEmailRevision: typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null,
  }
}

export const createNomineeRequestDecidedGuard =
  (deps: NomineeRequestDecidedGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const fields = fieldsOf(event.payload)
    if (fields.nomineeRequestId === null || fields.decision === null || fields.boundEmailRevision === null) {
      return cancel("reference_missing")
    }
    if (delivery.user_id === null) return cancel("reference_missing")
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== fields.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const request = await deps.nomineeRequestRepository.find(tx, fields.nomineeRequestId)
    if (request?.userId !== user.id) return cancel("request_missing")
    if (request.state !== fields.decision) return cancel("decision_changed")
    return { kind: "send" }
  }
