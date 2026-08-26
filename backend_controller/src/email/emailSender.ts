/**
 * Transport-agnostic transactional email sender (decision 10). This is the seam
 * used by direct, transactional sends (e.g. the Email OTP Verification code) — distinct
 * from the SES `outbox` pipeline in `dispatchDueDeliveries`. Two adapters:
 *
 *  - `createSmtpEmailSender` — sends through a company mailbox over SMTP
 *    (`nodemailer`), with host/port/credentials and the `from` address supplied
 *    from the environment. This is what actually delivers Email OTP codes.
 *  - `createLogEmailSender` — a safe local/test fallback used when SMTP is not
 *    configured. It records only non-secret metadata (never the body/code).
 *
 * BE-023's Amazon SES sender can implement this same interface later so the two
 * transports coexist or swap without touching the domain.
 */
import nodemailer from "nodemailer"

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html?: string
}

/**
 * What the transport reported for an accepted message. `messageId` lets a send be
 * traced in the mailbox; transports that do not supply one return null.
 */
export interface EmailSendResult {
  readonly messageId: string | null
}

/** Sends a single transactional email. Throws on transport failure. */
export interface EmailSender {
  send: (message: EmailMessage) => Promise<EmailSendResult>
}

export interface SmtpEmailConfig {
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly user: string
  readonly password: string
  /** The company `From` address used for Email OTP Verification. */
  readonly fromAddress: string
}

const isLoopbackSmtp = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost" || host === "::1"

export const createSmtpEmailSender = (config: SmtpEmailConfig): EmailSender => {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Production deploy policy pins implicit TLS on 465. Local Mailpit does not
    // implement STARTTLS, so plaintext is allowed only on the loopback device.
    requireTLS: !config.secure && !isLoopbackSmtp(config.host),
    auth: { user: config.user, pass: config.password },
  })
  return {
    send: async (message) => {
      const info = await transporter.sendMail({
        from: config.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      })
      return { messageId: typeof info.messageId === "string" ? info.messageId : null }
    },
  }
}

/** Metadata-only sink for dev/test (never logs the recipient body or any code). */
export interface EmailSendLog {
  (metadata: Readonly<{ to: string; subject: string; fromAddress: string }>): void
}

export const createLogEmailSender = (fromAddress: string, log?: EmailSendLog): EmailSender => ({
  send: (message) => {
    log?.({ to: message.to, subject: message.subject, fromAddress })
    return Promise.resolve({ messageId: null })
  },
})


/**
 * Thrown by {@link createUnconfiguredEmailSender} when there is no transport to
 * hand a message to. Carries a stable code so the outbox adapter can classify it
 * distinctly from a transport that exists and failed.
 */
export class EmailTransportNotConfiguredError extends Error {
  readonly code = "EMAIL_TRANSPORT_NOT_CONFIGURED"

  constructor() {
    super("No SMTP transport is configured")
    this.name = "EmailTransportNotConfiguredError"
  }
}

/**
 * The sender used by the outbox worker when no SMTP transport is configured. It
 * *fails* rather than quietly succeeding.
 *
 * `createLogEmailSender` was previously used for this, and it resolves
 * successfully — so `dispatchDueDeliveries` recorded the delivery as `sent` and
 * settled the outbox event as `delivered` for a message that never left the
 * process. The database then asserted that a confirmation link had been sent to
 * someone who could not possibly have received it, `email_deliveries.state` could
 * not be trusted to mean anything, and nothing anywhere reported a problem.
 *
 * Failing keeps that state honest: a delivery reaches `sent` only when a
 * transport accepted it. The outbox classifies this as retryable, so once SMTP is
 * configured the queued mail drains on the next pass rather than being lost — the
 * ladder in retrySchedule.ts allows roughly 42 hours before dead-lettering.
 *
 * Used whenever no SMTP transport exists. Direct Email OTP delivery and the outbox
 * worker both fail honestly instead of claiming an unsent message succeeded.
 */
export const createUnconfiguredEmailSender = (): EmailSender => ({
  send: () => Promise.reject(new EmailTransportNotConfiguredError()),
})
