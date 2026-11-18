import type { UserId } from "../../db/repositories.js"
import type { ClientGrowthMailRepository } from "../../repositories/clientGrowthMailRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface InvestmentGrowthGuardDeps {
  readonly clientGrowthMailRepository: Pick<ClientGrowthMailRepository, "findGrowthEntry">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const uuidOf = (record: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = record[key]
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null
}

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const boundEmailRevision = typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null
  return { batchId: uuidOf(record, "batchId"), fundId: uuidOf(record, "fundId"), boundEmailRevision }
}

export const createInvestmentGrowthGuard =
  (deps: InvestmentGrowthGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const { batchId, fundId, boundEmailRevision } = fieldsOf(event.payload)
    if (batchId === null || fundId === null || boundEmailRevision === null || delivery.user_id === null) {
      return cancel("reference_missing")
    }
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const growth = await deps.clientGrowthMailRepository.findGrowthEntry(tx, { batchId, userId: user.id, fundId })
    if (growth === null) return cancel("growth_missing")
    if (growth.reversed) return cancel("growth_reversed")
    return { kind: "send" }
  }
