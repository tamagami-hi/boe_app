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

const TEMPLATE_VERSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["application_rejected", ["v1"]],
  ["account_approved", ["v1"]],
  ["password_set_link", ["v1"]],
  ["password_reset_link", ["v1"]],
  ["password_app_download", ["v1"]],
  ["contact_phone_changed", ["v1"]],
  ["email_change_code", ["v1"]],
  ["contact_email_changed", ["v1"]],
  ["admin_message", ["v1"]],
  ["app_update_notice", ["v1"]],
])

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

const requiredString = (data: Readonly<Record<string, unknown>>, key: string): string => {
  const value = stringField(data, key)
  if (value === null) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return value
}

const requiredDuration = (data: Readonly<Record<string, unknown>>, key: string): number => {
  const value = data[key]
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  }
  return value
}

const passwordLinkInput = (data: Readonly<Record<string, unknown>>): PasswordLinkInput => ({
  link: requiredString(data, "link"),
  validForMs: requiredDuration(data, "validForMs"),
})

const plural = (count: number, unit: string): string =>
  `${String(count)} ${unit}${count === 1 ? "" : "s"}`

const SECONDS_PER_HOUR = 3_600

const describeDuration = (ms: number): string => {
  const seconds = Math.max(1, Math.floor(ms / 1000))
  if (seconds % SECONDS_PER_HOUR === 0) return plural(seconds / SECONDS_PER_HOUR, "hour")
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

export const phoneChangedEmail = (ending: string, config: EmailTemplateConfig): RenderedEmail =>
  renderEmail({
    subject: "Your BeOnEdge phone number was changed",
    preheader: "The phone number on your BeOnEdge account was changed.",
    heading: "Your phone number was changed",
    supportAddress: config.supportAddress,
    blocks: [
      {
        kind: "text",
        text: `The phone number on your BeOnEdge account was changed to a number ending in ${ending}.`,
      },
      { kind: "text", text: "If you made this change, you do not need to do anything." },
      {
        kind: "text",
        text: "If you did not, contact BeOnEdge support straight away and change your password.",
      },
    ],
  })

const phoneEndingField = (data: Readonly<Record<string, unknown>>): string => {
  const ending = requiredString(data, "phoneEnding")
  if (!/^[0-9]{4}$/u.test(ending)) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return ending
}

export const emailChangeCodeEmail = (input: VerificationCodeInput, config: EmailTemplateConfig): RenderedEmail =>
  renderEmail({
    subject: "Confirm your new BeOnEdge email address",
    preheader: "Use this code to confirm your new email address in BeOnEdge.",
    heading: "Confirm your new email address",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "code", lead: "Your BeOnEdge confirmation code is", code: input.code },
      {
        kind: "text",
        text: `This is a ${String(input.code.length)}-character code. It is case-sensitive, so enter it exactly as shown, with the same upper and lower case letters.`,
      },
      { kind: "text", text: `The code expires in ${describeDuration(input.validForMs)}.` },
      { kind: "text", text: "Do not share this code with anyone." },
      {
        kind: "text",
        text: "If you did not ask to change your email address, ignore this email. Your account stays unchanged.",
      },
    ],
  })

export const emailChangedEmail = (
  input: Readonly<{ role: "previous" | "current"; newEmail: string }>,
  config: EmailTemplateConfig,
): RenderedEmail =>
  input.role === "previous"
    ? renderEmail({
        subject: "Your BeOnEdge email address was changed",
        preheader: "The sign-in email on your BeOnEdge account was changed.",
        heading: "Your email address was changed",
        supportAddress: config.supportAddress,
        blocks: [
          {
            kind: "text",
            text: `The sign-in email on your BeOnEdge account was changed to ${input.newEmail}. Every device was signed out.`,
          },
          { kind: "text", text: "If you made this change, you do not need to do anything." },
          { kind: "text", text: "If you did not, contact BeOnEdge support straight away." },
        ],
      })
    : renderEmail({
        subject: "This is now your BeOnEdge sign-in email",
        preheader: "Your BeOnEdge account now uses this email address.",
        heading: "Your new sign-in email",
        supportAddress: config.supportAddress,
        blocks: [
          { kind: "text", text: "Your BeOnEdge account now uses this email address to sign in." },
          { kind: "text", text: "Sign in again with this address and your existing password." },
          { kind: "text", text: "If you did not make this change, contact BeOnEdge support straight away." },
        ],
      })

const changeRole = (data: Readonly<Record<string, unknown>>): "previous" | "current" => {
  const role = data.role
  if (role !== "previous" && role !== "current") throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return role
}

export interface AdminMessageInput {
  readonly subject: string
  readonly body: string
  readonly test: boolean
}

export const ADMIN_TEST_NOTICE =
  "This is a test sent from the BeOnEdge admin panel. It was not sent to a client, and the name in it is a sample."

const paragraphBlocks = (body: string): readonly EmailBlock[] =>
  body
    .replace(/\r\n?/gu, "\n")
    .split(/\n[ \t]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((text) => ({ kind: "text", text }))

export const adminMessageEmail = (input: AdminMessageInput, config: EmailTemplateConfig): RenderedEmail => {
  const blocks = paragraphBlocks(input.body)
  if (blocks.length === 0) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return renderEmail({
    subject: input.test ? `[Test] ${input.subject}` : input.subject,
    preheader: input.subject,
    heading: input.subject,
    supportAddress: config.supportAddress,
    blocks: [...(input.test ? [{ kind: "text" as const, text: ADMIN_TEST_NOTICE }] : []), ...blocks],
  })
}

const adminMessageInput = (data: Readonly<Record<string, unknown>>): AdminMessageInput => ({
  subject: requiredString(data, "subject"),
  body: requiredString(data, "body"),
  test: data.test === true,
})

export interface AppUpdateNoticeInput {
  readonly version: string
  readonly mandatory: boolean
  readonly message: string | null
  readonly downloadUrl: string
  readonly test: boolean
}

const APP_UPDATE_TEST_NOTICE =
  "This is a test sent from the BeOnEdge admin panel. It was not sent to any client."

export const appUpdateNoticeEmail = (input: AppUpdateNoticeInput, config: EmailTemplateConfig): RenderedEmail => {
  if (!/^[0-9]+(?:\.[0-9]+){0,3}$/u.test(input.version)) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  const subject = input.mandatory
    ? `Update required: BeOnEdge app version ${input.version}`
    : `BeOnEdge app version ${input.version} is available`
  const lead: readonly EmailBlock[] = input.mandatory
    ? [
        { kind: "text", text: `Version ${input.version} of the BeOnEdge app is a required update.` },
        {
          kind: "text",
          text: "Older versions of the app will ask you to update before you can continue, so please install it now.",
        },
      ]
    : [{ kind: "text", text: `Version ${input.version} of the BeOnEdge app is ready to install.` }]
  return renderEmail({
    subject: input.test ? `[Test] ${subject}` : subject,
    preheader: subject,
    heading: input.mandatory ? "Please update the BeOnEdge app" : "A new version of the BeOnEdge app",
    supportAddress: config.supportAddress,
    blocks: [
      ...(input.test ? [{ kind: "text" as const, text: APP_UPDATE_TEST_NOTICE }] : []),
      ...lead,
      ...(input.message === null ? [] : [{ kind: "text" as const, text: input.message }]),
      { kind: "action", label: "Download the BeOnEdge app", url: input.downloadUrl },
      {
        kind: "text",
        text: "You can also update from inside the app: open it and follow the update prompt. BeOnEdge only sends the app from its own website.",
      },
    ],
  })
}

const appUpdateNoticeInput = (data: Readonly<Record<string, unknown>>): AppUpdateNoticeInput => ({
  version: requiredString(data, "version"),
  mandatory: data.mandatory === true,
  message: stringField(data, "message"),
  downloadUrl: requiredString(data, "downloadUrl"),
  test: data.test === true,
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
    case "password_set_link":
      return passwordInviteEmail(passwordLinkInput(templateData), config)
    case "password_reset_link":
      return passwordResetEmail(passwordLinkInput(templateData), config)
    case "password_app_download":
      return appDownloadEmail(requiredString(templateData, "downloadUrl"), config)
    case "contact_phone_changed":
      return phoneChangedEmail(phoneEndingField(templateData), config)
    case "email_change_code":
      return emailChangeCodeEmail(
        { code: requiredString(templateData, "code"), validForMs: requiredDuration(templateData, "validForMs") },
        config,
      )
    case "contact_email_changed":
      return emailChangedEmail({ role: changeRole(templateData), newEmail: requiredString(templateData, "newEmail") }, config)
    case "admin_message":
      return adminMessageEmail(adminMessageInput(templateData), config)
    case "app_update_notice":
      return appUpdateNoticeEmail(appUpdateNoticeInput(templateData), config)
    default:
      return null
  }
}

/** Render the body for a queued delivery's template key and payload. */
export const renderEmailTemplate = (
  templateKey: string,
  templateVersion: string,
  templateData: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  const versions = TEMPLATE_VERSIONS.get(templateKey)
  if (versions === undefined) return { kind: "unrenderable", errorCode: "TEMPLATE_UNKNOWN" }
  if (!versions.includes(templateVersion)) return { kind: "unrenderable", errorCode: "TEMPLATE_VERSION_UNSUPPORTED" }
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
