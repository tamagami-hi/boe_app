/**
 * Concrete `SesEmailSender` for the outbox delivery worker (spec 04 §6.2).
 *
 * The worker's port was written for Amazon SES, but the deployment sends through
 * the same company mailbox that already carries KYC codes. This adapter renders
 * the body locally from the template key + queued payload and hands it to the
 * transport-agnostic `EmailSender` (SMTP in a deployment, the metadata-only log
 * sender when SMTP is not configured), then maps the outcome onto the port's
 * accepted/retryable/permanent vocabulary the retry schedule depends on.
 *
 * Swapping in a real SES adapter later means implementing the same port; nothing
 * in the domain changes.
 */
import { randomUUID } from "node:crypto"

import { EmailTransportNotConfiguredError, type EmailSender } from "./emailSender.js"
import { renderEmailTemplate, type EmailTemplateConfig } from "./emailTemplates.js"
import type { SesEmailSender, SesSendRequest, SesSendResult } from "./ports.js"

export interface TransactionalSenderDeps {
  readonly sender: EmailSender
  readonly templates: EmailTemplateConfig
}

/**
 * SMTP replies in the 5xx range are refusals the mailbox will repeat (unknown
 * recipient, blocked domain), so they dead-letter instead of burning the retry
 * budget. Anything else — a connection reset, a 4xx greylist, an unclassified
 * throw — is treated as retryable.
 */
const classify = (error: unknown): SesSendResult => {
  /*
   * A missing transport is a deployment fault, not a bad recipient. It is
   * retryable so the queue drains once SMTP is configured, and it gets its own
   * code so "nobody set EMAIL_SMTP_*" is distinguishable in
   * `email_deliveries.last_error_code` from "the mail server refused us".
   */
  if (error instanceof EmailTransportNotConfiguredError) {
    return { outcome: "rejected", disposition: "retryable", errorCode: error.code }
  }
  const responseCode = (error as { responseCode?: unknown }).responseCode
  if (typeof responseCode === "number" && responseCode >= 500 && responseCode < 600) {
    return { outcome: "rejected", disposition: "permanent", errorCode: "SMTP_PERMANENT_REJECT" }
  }
  return { outcome: "rejected", disposition: "retryable", errorCode: "SMTP_TRANSPORT_ERROR" }
}

export const createTransactionalEmailSender = (deps: TransactionalSenderDeps): SesEmailSender => ({
  send: async (request: SesSendRequest): Promise<SesSendResult> => {
    const rendered = renderEmailTemplate(request.templateKey, request.templateData, deps.templates)
    if (rendered.kind === "unrenderable") {
      // A body that cannot be built will never build; retrying is pointless.
      return { outcome: "rejected", disposition: "permanent", errorCode: rendered.errorCode }
    }

    try {
      const result = await deps.sender.send({
        to: request.toAddress,
        subject: rendered.email.subject,
        text: rendered.email.text,
      })
      return {
        outcome: "accepted",
        // The transport's own id when it supplies one, so a message can be traced
        // in the mailbox; otherwise a local correlation id.
        sesMessageId: result.messageId ?? `local-${randomUUID()}`,
        sesRequestId: null,
      }
    } catch (error) {
      return classify(error)
    }
  },
})
