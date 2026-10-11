import { randomUUID } from "node:crypto"

import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction, User, UserId } from "../../db/repositories.js"
import { adminMessageEmail } from "../../email/emailTemplates.js"
import type { RenderedEmail } from "../../email/emailLayout.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminEmailMessageRepository } from "../../repositories/adminEmailMessageRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { EmailSuppressionWriteRepository } from "../../repositories/emailSuppressionRepository.js"
import type { EmailTemplate, EmailTemplateRepository } from "../../repositories/emailTemplateRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { enqueueEmail } from "../email/enqueueEmail.js"
import { fillPlaceholders, placeholderValuesFor } from "./emailTemplateContent.js"

export const SAMPLE_RECIPIENT_NAME = "Asha Verma"
const ADMIN_MESSAGE_TEMPLATE_VERSION = "v1"

export type RecipientBlock = "not_client" | "inactive" | "suppressed"

const BLOCK_MESSAGES: Readonly<Record<RecipientBlock, string>> = {
  not_client: "Messages from this screen go only to client accounts.",
  inactive: "Only an active client account can be sent a message.",
  suppressed: "Mail to this address is blocked after a bounce or complaint, so nothing was sent.",
}

export interface AdminEmailMessageDeps {
  readonly emailTemplateRepository: Pick<EmailTemplateRepository, "findById">
  readonly adminEmailMessageRepository: AdminEmailMessageRepository
  readonly userRepository: Pick<UserWriteRepository, "findById" | "lockById" | "findActiveRolesAndPermissions">
  readonly emailSuppressionRepository: Pick<EmailSuppressionWriteRepository, "findActive">
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: {
    readonly sesConfigurationSet: string
    readonly sendCooldownMs: number
    readonly supportAddress: string | null
  }
}

export interface PreviewRecipient {
  readonly userId: string
  readonly fullName: string
  readonly maskedEmail: string
  readonly emailRevision: string
  readonly block: RecipientBlock | null
  readonly nextSendAllowedAt: Date | null
}

export interface AdminEmailPreview {
  readonly template: EmailTemplate
  readonly email: RenderedEmail
  readonly sample: boolean
  readonly recipient: PreviewRecipient | null
}

export interface QueuedAdminEmail {
  readonly messageId: string
  readonly deliveryId: string
  readonly recipientMasked: string
  readonly test: boolean
  readonly queuedAt: Date
}

export type SendTarget =
  | Readonly<{ kind: "client"; userId: string; expectedEmailRevision: string }>
  | Readonly<{ kind: "test" }>

const loadTemplate = async (tx: Transaction, deps: AdminEmailMessageDeps, templateId: string): Promise<EmailTemplate> => {
  const template = await deps.emailTemplateRepository.findById(tx, templateId)
  if (template === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (template.archivedAt !== null) {
    throw new AppError("STATE_CONFLICT", { message: "This template is archived. Restore it before sending." })
  }
  return template
}

const recipientBlock = async (tx: Transaction, deps: AdminEmailMessageDeps, user: User): Promise<RecipientBlock | null> => {
  const grants = await deps.userRepository.findActiveRolesAndPermissions(tx, user.id as UserId)
  if (grants.roles.length > 0) return "not_client"
  if (user.account_state !== "active" || user.pii_tombstoned_at !== null) return "inactive"
  return (await isSuppressed(tx, deps, user)) ? "suppressed" : null
}

const isSuppressed = async (tx: Transaction, deps: AdminEmailMessageDeps, user: User): Promise<boolean> =>
  (await deps.emailSuppressionRepository.findActive(tx, {
    recipientHmac: deps.crypto.hmacRecipient(user.email_normalized).hash,
    suppressionHmacKeyVersion: deps.crypto.suppressionHmacKeyVersion,
  })) !== null

const cooldownEnd = async (
  tx: Transaction,
  deps: AdminEmailMessageDeps,
  input: Readonly<{ recipientUserId: string; isTest: boolean; now: Date }>,
): Promise<Date | null> => {
  const latest = await deps.adminEmailMessageRepository.latestCreatedAt(tx, input)
  if (latest === null) return null
  const end = new Date(latest.getTime() + deps.config.sendCooldownMs)
  return end.getTime() > input.now.getTime() ? end : null
}

const renderFor = (deps: AdminEmailMessageDeps, template: EmailTemplate, fullName: string, test: boolean) => {
  const values = placeholderValuesFor(fullName)
  const subject = fillPlaceholders(template.current.subject, values)
  const body = fillPlaceholders(template.current.body, values)
  return { subject, body, email: adminMessageEmail({ subject, body, test }, { supportAddress: deps.config.supportAddress }) }
}

export const previewAdminEmail = async (
  tx: Transaction,
  deps: AdminEmailMessageDeps,
  input: Readonly<{ templateId: string; userId: string | null }>,
): Promise<AdminEmailPreview> => {
  const template = await loadTemplate(tx, deps, input.templateId)
  if (input.userId === null) {
    return { template, email: renderFor(deps, template, SAMPLE_RECIPIENT_NAME, false).email, sample: true, recipient: null }
  }
  const user = await deps.userRepository.findById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const now = deps.clock()
  return {
    template,
    email: renderFor(deps, template, user.full_name, false).email,
    sample: false,
    recipient: {
      userId: user.id,
      fullName: user.full_name,
      maskedEmail: deps.crypto.maskEmail(user.email_normalized),
      emailRevision: String(user.email_revision),
      block: await recipientBlock(tx, deps, user),
      nextSendAllowedAt: await cooldownEnd(tx, deps, { recipientUserId: user.id, isTest: false, now }),
    },
  }
}

const lockRecipient = async (
  tx: Transaction,
  deps: AdminEmailMessageDeps,
  target: SendTarget,
  actorUserId: string,
): Promise<User> => {
  const user = await deps.userRepository.lockById(tx, (target.kind === "client" ? target.userId : actorUserId) as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (target.kind === "test") {
    if (await isSuppressed(tx, deps, user)) throw new AppError("STATE_CONFLICT", { message: BLOCK_MESSAGES.suppressed })
    return user
  }
  const block = await recipientBlock(tx, deps, user)
  if (block !== null) throw new AppError("STATE_CONFLICT", { message: BLOCK_MESSAGES[block] })
  if (String(user.email_revision) !== target.expectedEmailRevision) {
    throw new AppError("STATE_CONFLICT", {
      message: "This client's email address changed after you previewed it. Review the new preview before sending.",
    })
  }
  return user
}

export const sendAdminEmail = async (
  tx: Transaction,
  deps: AdminEmailMessageDeps,
  input: Readonly<{ templateId: string; revision: number; target: SendTarget; actorUserId: string; requestId: string }>,
): Promise<QueuedAdminEmail> => {
  const template = await loadTemplate(tx, deps, input.templateId)
  if (template.currentRevision !== input.revision) {
    throw new AppError("STATE_CONFLICT", {
      message: "This template changed after you previewed it. Review the new preview before sending.",
    })
  }
  const user = await lockRecipient(tx, deps, input.target, input.actorUserId)
  const test = input.target.kind === "test"
  const now = deps.clock()
  const waitUntil = await cooldownEnd(tx, deps, { recipientUserId: user.id, isTest: test, now })
  if (waitUntil !== null) {
    throw new AppError("RATE_LIMITED", { retryAfterSeconds: Math.ceil((waitUntil.getTime() - now.getTime()) / 1000) })
  }

  const messageId = randomUUID()
  const content = renderFor(deps, template, test ? SAMPLE_RECIPIENT_NAME : user.full_name, test)
  const queued = await enqueueEmail(tx, deps, {
    recipient: user.email_normalized,
    template: { templateKey: "admin_message", userId: user.id },
    templateVersion: ADMIN_MESSAGE_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: test ? "admin.email_test_sent" : "admin.email_message_sent",
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: user.id,
    requestId: input.requestId,
    deduplicationKey: `admin_message:${messageId}`,
    payload: { template: "admin_message", adminMessageId: messageId, test },
    sealedPayload: { subject: content.subject, body: content.body },
  })
  await deps.adminEmailMessageRepository.create(tx, {
    id: messageId,
    templateId: template.id,
    templateRevision: template.currentRevision,
    recipientUserId: user.id,
    actorUserId: input.actorUserId,
    isTest: test,
    boundEmailRevision: String(user.email_revision),
    deliveryId: queued.delivery.id,
    now,
  })

  const recipientMasked = deps.crypto.maskEmail(user.email_normalized)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: test ? "email_message.test_sent" : "email_message.sent",
    entityType: "user",
    entityId: user.id,
    requestId: input.requestId,
    entityVersion: Number(user.version),
    metadata: {
      templateId: template.id,
      slug: template.slug,
      revision: template.currentRevision,
      messageId,
      deliveryId: queued.delivery.id,
      recipient: recipientMasked,
    },
  })
  return { messageId, deliveryId: queued.delivery.id, recipientMasked, test, queuedAt: now }
}
