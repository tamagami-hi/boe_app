import type { UserId } from "../../db/repositories.js"
import type { AppUpdateAnnouncementRepository } from "../../repositories/appUpdateAnnouncementRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface AppUpdateNoticeGuardDeps {
  readonly appUpdateAnnouncementRepository: Pick<AppUpdateAnnouncementRepository, "findById">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const fieldsOf = (payload: unknown) => {
  const record = typeof payload === "object" && payload !== null ? (payload as Readonly<Record<string, unknown>>) : {}
  const announcementId = typeof record.announcementId === "string" && UUID_PATTERN.test(record.announcementId) ? record.announcementId : null
  const boundEmailRevision = typeof record.boundEmailRevision === "string" ? record.boundEmailRevision : null
  return { test: record.test === true, announcementId, boundEmailRevision }
}

export const createAppUpdateNoticeGuard =
  (deps: AppUpdateNoticeGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const fields = fieldsOf(event.payload)
    if (fields.boundEmailRevision === null || delivery.user_id === null) return cancel("reference_missing")
    if (!fields.test) {
      if (fields.announcementId === null) return cancel("reference_missing")
      if ((await deps.appUpdateAnnouncementRepository.findById(tx, fields.announcementId)) === null) return cancel("announcement_missing")
    }
    const user = await deps.userRepository.findById(tx, delivery.user_id as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== fields.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    return { kind: "send" }
  }
