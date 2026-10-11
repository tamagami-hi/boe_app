import type { Transaction } from "../../db/repositories.js"
import { withSavepoint } from "../../db/savepoint.js"
import type { PasswordTokenPurpose } from "../../db/types.js"
import type {
  EmailDeliveryWriteRepository,
  PasswordMailTemplateKey,
} from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import { enqueueEmail } from "../email/enqueueEmail.js"
import {
  issuePasswordToken,
  type PasswordCredentialConfig,
  type PasswordCredentialDeps,
  type PasswordLinkRequester,
} from "./passwordCredential.js"
import { buildPasswordLink, type PasswordLinkSettings } from "./passwordLinkUrl.js"

const PASSWORD_MAIL_TEMPLATE_VERSION = "v1"

const LINK_TEMPLATES: Readonly<
  Record<PasswordTokenPurpose, { readonly templateKey: PasswordMailTemplateKey; readonly eventType: string }>
> = {
  set: { templateKey: "password_set_link", eventType: "user.password_set_link" },
  reset: { templateKey: "password_reset_link", eventType: "user.password_reset_link" },
}

export interface PasswordLinkMailConfig extends PasswordCredentialConfig {
  readonly passwordLinks: PasswordLinkSettings
  readonly sesConfigurationSet: string
}

export interface PasswordLinkMailDeps extends PasswordCredentialDeps {
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly config: PasswordLinkMailConfig
}

export interface QueuedPasswordLink {
  readonly userId: string
  readonly tokenId: string
  readonly purpose: PasswordTokenPurpose
  readonly expiresAt: Date
  readonly deliveryId: string
}

export const issuePasswordLinkMail = async (
  tx: Transaction,
  deps: PasswordLinkMailDeps,
  input: Readonly<{ userId: string; requestId: string; requester: PasswordLinkRequester; linkBase: string }>,
): Promise<QueuedPasswordLink> => {
  const issued = await issuePasswordToken(tx, deps, {
    userId: input.userId,
    requestId: input.requestId,
    requester: input.requester,
  })
  const { templateKey, eventType } = LINK_TEMPLATES[issued.purpose]
  const queued = await enqueueEmail(tx, deps, {
    recipient: issued.email,
    template: { templateKey, userId: issued.userId },
    templateVersion: PASSWORD_MAIL_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType,
    eventVersion: 1,
    aggregateType: "user",
    aggregateId: issued.userId,
    requestId: input.requestId,
    deduplicationKey: `password_link:${issued.tokenId}`,
    payload: { template: templateKey, passwordTokenId: issued.tokenId, validForMs: deps.config.tokenTtlMs },
    sealedPayload: { link: buildPasswordLink(input.linkBase, issued.rawToken) },
  })
  return {
    userId: issued.userId,
    tokenId: issued.tokenId,
    purpose: issued.purpose,
    expiresAt: issued.expiresAt,
    deliveryId: queued.delivery.id,
  }
}

export type AppDownloadMailOutcome =
  | { readonly kind: "queued"; readonly deliveryId: string }
  | { readonly kind: "failed"; readonly error: unknown }

export const queueAppDownloadMail = async (
  tx: Transaction,
  deps: Pick<PasswordLinkMailDeps, "outboxRepository" | "emailDeliveryRepository" | "crypto"> & {
    readonly config: Pick<PasswordLinkMailConfig, "sesConfigurationSet">
  },
  input: Readonly<{ tokenId: string; userId: string; email: string; downloadUrl: string; requestId: string }>,
): Promise<AppDownloadMailOutcome> => {
  const attempt = await withSavepoint(tx, () =>
    enqueueEmail(tx, deps, {
      recipient: input.email,
      template: { templateKey: "password_app_download", userId: input.userId },
      templateVersion: PASSWORD_MAIL_TEMPLATE_VERSION,
      sesConfigurationSet: deps.config.sesConfigurationSet,
      eventType: "user.password_app_download",
      eventVersion: 1,
      aggregateType: "user",
      aggregateId: input.userId,
      requestId: input.requestId,
      deduplicationKey: `password_app_download:${input.tokenId}`,
      payload: { template: "password_app_download", downloadUrl: input.downloadUrl },
    }),
  )
  return attempt.kind === "completed"
    ? { kind: "queued", deliveryId: attempt.value.delivery.id }
    : { kind: "failed", error: attempt.error }
}
