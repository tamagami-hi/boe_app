/**
 * Transport-agnostic transactional email sender (decision 10). This is the seam
 * used by direct, transactional sends (e.g. the KYC one-time code) — distinct
 * from the SES `outbox` pipeline in `dispatchDueDeliveries`. Two adapters:
 *
 *  - `createSmtpEmailSender` — sends through a company mailbox over SMTP
 *    (`nodemailer`), with host/port/credentials and the `from` address supplied
 *    from the environment. This is what actually delivers KYC codes.
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
  /** The company `From` address (spec/decision 10: `KYC_EMAIL_FROM`). */
  readonly fromAddress: string
}

export const createSmtpEmailSender = (config: SmtpEmailConfig): EmailSender => {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
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
