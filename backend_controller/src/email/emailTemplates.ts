import { renderEmail, type EmailBlock, type RenderedEmail } from "./emailLayout.js"
import { EmailValidationError } from "./emailValidation.js"

export interface EmailTemplateConfig {
  /** Address investors are told to contact. */
  readonly supportAddress: string | null
}

/** Unknown or unrenderable templates are reported rather than guessed at. */
export type TemplateRenderResult =
  | { readonly kind: "rendered"; readonly email: RenderedEmail }
  | { readonly kind: "unrenderable"; readonly errorCode: string }

export interface PasswordLinkInput {
  readonly link: string
  readonly validForMs: number
}

export interface VerificationCodeInput {
  readonly code: string
  readonly validForMs: number
}

const stringField = (data: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

const plural = (count: number, unit: string): string =>
  `${String(count)} ${unit}${count === 1 ? "" : "s"}`

const describeDuration = (ms: number): string => {
  const seconds = Math.max(1, Math.floor(ms / 1000))
  return seconds % 60 === 0 ? plural(seconds / 60, "minute") : plural(seconds, "second")
}

const downloadBlocks = (downloadUrl: string | null): readonly EmailBlock[] =>
  downloadUrl === null
    ? []
    : [{ kind: "action", label: "Download the BeOnEdge app", url: downloadUrl }]

export const applicationRejectedEmail = (config: EmailTemplateConfig): RenderedEmail =>
  renderEmail({
    subject: "Update on your BeOnEdge application",
    preheader: "An update on your BeOnEdge application.",
    heading: "Update on your application",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: "Thank you for your interest in BeOnEdge." },
      { kind: "text", text: "After review, we are not able to open an account for you at this time." },
      { kind: "text", text: "No further action is needed, and nothing has been charged." },
    ],
  })

export const accountApprovedEmail = (
  downloadUrl: string | null,
  config: EmailTemplateConfig,
): RenderedEmail =>
  renderEmail({
    subject: "Your BeOnEdge account is approved",
    preheader: "Your BeOnEdge application has been approved.",
    heading: "Your application is approved",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: "Welcome to BeOnEdge. Your application has been approved." },
      ...downloadBlocks(downloadUrl),
      {
        kind: "text",
        text: "Sign in with the same email address and password you used when you signed up at beonedge.in.",
      },
      {
        kind: "text",
        text: "Before you can invest, the app will ask you to verify your email address and complete Email OTP Verification.",
      },
      {
        kind: "text",
        text: "If you no longer remember your password, contact us and we will help you regain access.",
      },
    ],
  })

export const passwordInviteEmail = (
  input: PasswordLinkInput,
  config: EmailTemplateConfig,
): RenderedEmail =>
  renderEmail({
    subject: "Set your BeOnEdge password",
    preheader: "Choose a password for your new BeOnEdge account.",
    heading: "Set your password",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: "An account has been opened for you on BeOnEdge." },
      { kind: "action", label: "Set your password", url: input.link },
      { kind: "text", text: `The link works once and expires in ${describeDuration(input.validForMs)}.` },
      {
        kind: "text",
        text: "After signing in you will be asked to verify your email address before you can invest.",
      },
    ],
  })

export const passwordResetEmail = (
  input: PasswordLinkInput,
  config: EmailTemplateConfig,
): RenderedEmail =>
  renderEmail({
    subject: "Reset your BeOnEdge password",
    preheader: "Use the link in this email to choose a new password.",
    heading: "Reset your password",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: "Someone asked to reset the password on your BeOnEdge account." },
      { kind: "action", label: "Reset your password", url: input.link },
      { kind: "text", text: `The link works once and expires in ${describeDuration(input.validForMs)}.` },
      { kind: "text", text: "If you did not ask for this, ignore this email. Nothing has changed." },
    ],
  })

export const appDownloadEmail = (downloadUrl: string, config: EmailTemplateConfig): RenderedEmail =>
  renderEmail({
    subject: "BeOnEdge password set: download the app",
    preheader: "Your password is set. Download the BeOnEdge app.",
    heading: "Your password is set",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: "Your BeOnEdge password has been set successfully." },
      { kind: "text", text: "Download the BeOnEdge Android app using the official link below." },
      ...downloadBlocks(downloadUrl),
      {
        kind: "text",
        text: "Download and install the app, then sign in with your email address and new password.",
      },
      {
        kind: "text",
        text: "If the app is already installed, you can sign in with your new password now.",
      },
      { kind: "text", text: "If you did not change your password, contact BeOnEdge support." },
    ],
  })

export const emailVerificationCodeEmail = (
  input: VerificationCodeInput,
  config: EmailTemplateConfig,
): RenderedEmail =>
  renderEmail({
    subject: "Your BeOnEdge email verification code",
    preheader: "Use this code to verify your email address in the BeOnEdge app.",
    heading: "Verify your email address",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "code", lead: "Your BeOnEdge email verification code is", code: input.code },
      {
        kind: "text",
        text: `This is a ${String(input.code.length)}-character code. It is case-sensitive, so enter it exactly as shown, with the same upper and lower case letters.`,
      },
      { kind: "text", text: `The code expires in ${describeDuration(input.validForMs)}.` },
      { kind: "text", text: "Do not share this code with anyone." },
      { kind: "text", text: "If you did not request this code, ignore this email." },
    ],
  })

const buildTemplate = (
  templateKey: string,
  templateData: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): RenderedEmail | null => {
  switch (templateKey) {
    case "application_rejected":
      return applicationRejectedEmail(config)
    case "account_approved":
      return accountApprovedEmail(stringField(templateData, "downloadUrl"), config)
    default:
      return null
  }
}

/** Render the body for a queued delivery's template key and payload. */
export const renderEmailTemplate = (
  templateKey: string,
  templateData: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  try {
    const email = buildTemplate(templateKey, templateData, config)
    return email === null
      ? { kind: "unrenderable", errorCode: "TEMPLATE_UNKNOWN" }
      : { kind: "rendered", email }
  } catch (error) {
    if (error instanceof EmailValidationError) return { kind: "unrenderable", errorCode: error.code }
    throw error
  }
}
