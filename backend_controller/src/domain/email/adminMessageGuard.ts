import type { UserId } from "../../db/repositories.js"
import type { AdminEmailMessageRepository } from "../../repositories/adminEmailMessageRepository.js"
import type { EmailTemplateRepository } from "../../repositories/emailTemplateRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { SendGuard, SendVerdict } from "./dispatchDueDeliveries.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export interface AdminMessageGuardDeps {
  readonly adminEmailMessageRepository: Pick<AdminEmailMessageRepository, "findById">
  readonly emailTemplateRepository: Pick<EmailTemplateRepository, "findById">
  readonly userRepository: Pick<UserWriteRepository, "findById">
}

const cancel = (reason: string): SendVerdict => ({ kind: "cancel", reason })

const referencedMessageId = (payload: unknown): string | null => {
  if (typeof payload !== "object" || payload === null) return null
  const reference = (payload as Readonly<Record<string, unknown>>).adminMessageId
  return typeof reference === "string" && UUID_PATTERN.test(reference) ? reference : null
}

export const createAdminMessageGuard =
  (deps: AdminMessageGuardDeps): SendGuard =>
  async (tx, { event, delivery }) => {
    const messageId = referencedMessageId(event.payload)
    if (messageId === null) return cancel("reference_missing")
    const message = await deps.adminEmailMessageRepository.findById(tx, messageId)
    if (message === null) return cancel("message_missing")
    if (message.deliveryId !== delivery.id || message.recipientUserId !== delivery.user_id) return cancel("delivery_mismatch")
    const user = await deps.userRepository.findById(tx, message.recipientUserId as UserId)
    if (user === null) return cancel("recipient_missing")
    if (String(user.email_revision) !== message.boundEmailRevision) return cancel("contact_changed")
    if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return cancel("recipient_inactive")
    const template = await deps.emailTemplateRepository.findById(tx, message.templateId)
    if (template === null || template.archivedAt !== null) return cancel("template_archived")
    if (template.currentRevision !== message.templateRevision) return cancel("template_revised")
    return { kind: "send" }
  }
