import type { UserId } from "../../db/repositories.js"
import type { ClientMaturityOfferRepository } from "../../repositories/clientMaturityOfferRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface MaturityOptionsGuardDeps {
  readonly maturityOfferRepository: Pick<ClientMaturityOfferRepository, "findForUser">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const offerId = typeof record.offerId === "string" && UUID_PATTERN.test(record.offerId) ? record.offerId : null
  const boundEmailRevision = typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null
  return { offerId, boundEmailRevision }
}

export const createMaturityOptionsGuard =
  (deps: MaturityOptionsGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const fields = fieldsOf(event.payload)
    if (fields.offerId === null || fields.boundEmailRevision === null || delivery.user_id === null) {
      return cancel("reference_missing")
    }
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== fields.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const offer = await deps.maturityOfferRepository.findForUser(tx, { userId: user.id, offerId: fields.offerId })
    if (offer === null) return cancel("offer_missing")
    if (offer.state !== "open") return cancel("offer_closed")
    return { kind: "send" }
  }
