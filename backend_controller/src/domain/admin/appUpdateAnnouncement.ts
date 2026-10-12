import { createHash, randomUUID } from "node:crypto"

import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction, UserId } from "../../db/repositories.js"
import { appUpdateNoticeEmail } from "../../email/emailTemplates.js"
import type { RenderedEmail } from "../../email/emailLayout.js"
import { AppError } from "../../http/errorCatalog.js"
import { compareVersions, latestPublishedRelease, type PublishedRelease, type ReleaseFeed } from "../../release/releaseFeed.js"
import type { AdminContentRepository } from "../../repositories/adminContentRepository.js"
import type {
  AnnouncementRecipient,
  AppUpdateAnnouncementRepository,
} from "../../repositories/appUpdateAnnouncementRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { enqueueEmail } from "../email/enqueueEmail.js"

const NOTICE_TEMPLATE_VERSION = "v1"

export interface AppUpdateAnnouncementDeps {
  readonly appUpdate: ReleaseFeed
  readonly appUpdateAnnouncementRepository: AppUpdateAnnouncementRepository
  readonly contentRepository: Pick<
    AdminContentRepository,
    "findCurrentAppConfig" | "maxAppConfigVersion" | "retireCurrentAppConfig" | "insertAppConfigVersion"
  >
  readonly userRepository: Pick<UserWriteRepository, "findById">
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: { readonly sesConfigurationSet: string; readonly supportAddress: string | null }
}

export interface AnnouncementContent {
  readonly mandatory: boolean
  readonly message: string | null
}

export interface AppUpdateAnnouncementPreview {
  readonly release: PublishedRelease | null
  readonly email: RenderedEmail | null
  readonly recipientCount: number
  readonly alreadySent: boolean
  readonly currentMinimum: string | null
}

export interface SentAppUpdateAnnouncement {
  readonly announcementId: string
  readonly release: PublishedRelease
  readonly mandatory: boolean
  readonly recipientCount: number
  readonly appConfigVersion: number | null
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const currentConfigPayload = async (tx: Transaction, deps: AppUpdateAnnouncementDeps) => {
  const current = await deps.contentRepository.findCurrentAppConfig(tx)
  return { current, payload: asRecord(current?.payload) }
}

const androidMinimum = (payload: Readonly<Record<string, unknown>>): string | null => {
  const value = asRecord(payload.minimumSupportedVersion).android
  return typeof value === "string" && value !== "" ? value : null
}

const render = (deps: AppUpdateAnnouncementDeps, release: PublishedRelease, content: AnnouncementContent, test: boolean) =>
  appUpdateNoticeEmail(
    { version: release.version, mandatory: content.mandatory, message: content.message, downloadUrl: release.url, test },
    { supportAddress: deps.config.supportAddress },
  )

const requireRelease = async (deps: AppUpdateAnnouncementDeps, versionCode: number): Promise<PublishedRelease> => {
  const release = await latestPublishedRelease(deps.appUpdate, "client")
  if (release === null) {
    throw new AppError("STATE_CONFLICT", { message: "No client app is published on this server yet, so there is nothing to announce." })
  }
  if (release.versionCode !== versionCode) {
    throw new AppError("STATE_CONFLICT", {
      message: "A different app version was published after you previewed. Review the new preview before sending.",
    })
  }
  return release
}

export const previewAppUpdateAnnouncement = async (
  tx: Transaction,
  deps: AppUpdateAnnouncementDeps,
  content: AnnouncementContent,
): Promise<AppUpdateAnnouncementPreview> => {
  const release = await latestPublishedRelease(deps.appUpdate, "client")
  const recipients = await deps.appUpdateAnnouncementRepository.listRecipients(tx)
  const { payload } = await currentConfigPayload(tx, deps)
  const sent =
    release === null
      ? null
      : await deps.appUpdateAnnouncementRepository.findSent(tx, { versionCode: release.versionCode, mandatory: content.mandatory })
  return {
    release,
    email: release === null ? null : render(deps, release, content, false),
    recipientCount: recipients.length,
    alreadySent: sent !== null,
    currentMinimum: androidMinimum(payload),
  }
}

const enforceMinimum = async (
  tx: Transaction,
  deps: AppUpdateAnnouncementDeps,
  input: Readonly<{ version: string; actorUserId: string; requestId: string; now: Date }>,
): Promise<number> => {
  const { current, payload } = await currentConfigPayload(tx, deps)
  const existing = androidMinimum(payload)
  if (current !== null && existing !== null && compareVersions(existing, input.version) >= 0) return current.version
  const next = {
    featureFlags: {},
    downloads: {},
    maintenance: { enabled: false },
    presentation: {},
    ...payload,
    minimumSupportedVersion: { ...asRecord(payload.minimumSupportedVersion), android: input.version },
  }
  const version = (await deps.contentRepository.maxAppConfigVersion(tx)) + 1
  await deps.contentRepository.retireCurrentAppConfig(tx, input.now)
  const published = await deps.contentRepository.insertAppConfigVersion(tx, {
    version,
    payload: next,
    contentSha256: createHash("sha256").update(JSON.stringify(next)).digest(),
    publishedByUserId: input.actorUserId,
    now: input.now,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "app_config.published",
    entityType: "app_config_version",
    entityId: published.id,
    fromState: current === null ? null : String(current.version),
    toState: String(published.version),
    requestId: input.requestId,
    entityVersion: published.version,
    metadata: { version: published.version, reason: `Required app update ${input.version} announced` },
  })
  return published.version
}

const queueNotice = (
  tx: Transaction,
  deps: AppUpdateAnnouncementDeps,
  input: Readonly<{
    recipient: AnnouncementRecipient
    release: PublishedRelease
    content: AnnouncementContent
    announcementId: string | null
    requestId: string
  }>,
) =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email,
    template: { templateKey: "app_update_notice", userId: input.recipient.userId },
    templateVersion: NOTICE_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: input.announcementId === null ? "admin.app_update_test_sent" : "admin.app_update_announced",
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: input.recipient.userId,
    requestId: input.requestId,
    deduplicationKey:
      input.announcementId === null
        ? `app_update_notice:test:${randomUUID()}`
        : `app_update_notice:${input.announcementId}:${input.recipient.userId}`,
    payload: {
      template: "app_update_notice",
      announcementId: input.announcementId,
      test: input.announcementId === null,
      version: input.release.version,
      mandatory: input.content.mandatory,
      message: input.content.message,
      downloadUrl: input.release.url,
      boundEmailRevision: input.recipient.emailRevision,
    },
  })

export const sendAppUpdateAnnouncement = async (
  tx: Transaction,
  deps: AppUpdateAnnouncementDeps,
  input: AnnouncementContent & Readonly<{ versionCode: number; actorUserId: string; requestId: string }>,
): Promise<SentAppUpdateAnnouncement> => {
  const release = await requireRelease(deps, input.versionCode)
  const content = { mandatory: input.mandatory, message: input.message }
  await deps.appUpdateAnnouncementRepository.lockForSend(tx)
  if ((await deps.appUpdateAnnouncementRepository.findSent(tx, { versionCode: release.versionCode, mandatory: input.mandatory })) !== null) {
    throw new AppError("STATE_CONFLICT", {
      message: input.mandatory
        ? "A required-update email for this version was already sent."
        : "An update email for this version was already sent.",
    })
  }
  const now = deps.clock()
  const appConfigVersion = input.mandatory
    ? await enforceMinimum(tx, deps, { version: release.version, actorUserId: input.actorUserId, requestId: input.requestId, now })
    : null
  const recipients = await deps.appUpdateAnnouncementRepository.listRecipients(tx)
  const announcement = await deps.appUpdateAnnouncementRepository.create(tx, {
    id: randomUUID(),
    version: release.version,
    versionCode: release.versionCode,
    mandatory: input.mandatory,
    message: input.message,
    downloadUrl: release.url,
    recipientCount: recipients.length,
    appConfigVersion,
    actorUserId: input.actorUserId,
    now,
  })
  for (const recipient of recipients) {
    await queueNotice(tx, deps, { recipient, release, content, announcementId: announcement.id, requestId: input.requestId })
  }
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "app_update.announced",
    entityType: "app_update_announcement",
    entityId: announcement.id,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {
      version: release.version,
      versionCode: release.versionCode,
      mandatory: input.mandatory,
      recipientCount: recipients.length,
      appConfigVersion,
    },
  })
  return { announcementId: announcement.id, release, mandatory: input.mandatory, recipientCount: recipients.length, appConfigVersion }
}

export const sendAppUpdateAnnouncementTest = async (
  tx: Transaction,
  deps: AppUpdateAnnouncementDeps,
  input: AnnouncementContent & Readonly<{ versionCode: number; actorUserId: string; requestId: string }>,
): Promise<Readonly<{ deliveryId: string; recipientMasked: string }>> => {
  const release = await requireRelease(deps, input.versionCode)
  const admin = await deps.userRepository.findById(tx, input.actorUserId as UserId)
  if (admin === null) throw new AppError("RESOURCE_NOT_FOUND")
  const queued = await queueNotice(tx, deps, {
    recipient: { userId: admin.id, email: admin.email_normalized, emailRevision: String(admin.email_revision) },
    release,
    content: { mandatory: input.mandatory, message: input.message },
    announcementId: null,
    requestId: input.requestId,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "app_update.test_sent",
    entityType: "user",
    entityId: admin.id,
    requestId: input.requestId,
    entityVersion: Number(admin.version),
    metadata: { version: release.version, mandatory: input.mandatory, deliveryId: queued.delivery.id },
  })
  return { deliveryId: queued.delivery.id, recipientMasked: deps.crypto.maskEmail(admin.email_normalized) }
}
