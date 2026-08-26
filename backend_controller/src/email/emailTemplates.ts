/**
 * Onboarding email bodies (spec 04 §6.2, decision 10).
 *
 * The outbox row carries the template key plus any data the message needs
 * (`downloadUrl` for the approval mail); this module turns that pair into the
 * subject and body actually sent. Rendering is pure so the wording and the link
 * shapes are unit-testable without a transport.
 *
 * Only two templates remain after the onboarding rework: signup lands directly
 * in `submitted` with the password already chosen, so approval is a plain
 * notification (optionally carrying the client APK download link) and
 * rejection is a plain notification. There is no pre-approval verification
 * mail and no activation invite anymore.
 */

export interface EmailTemplateConfig {
  /** Address investors are told to contact. */
  readonly supportAddress: string | null
}

export interface RenderedEmail {
  readonly subject: string
  readonly text: string
}

/** Unknown or unrenderable templates are reported rather than guessed at. */
export type TemplateRenderResult =
  | { readonly kind: "rendered"; readonly email: RenderedEmail }
  | { readonly kind: "unrenderable"; readonly errorCode: string }

const stringField = (data: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

const signature = (config: EmailTemplateConfig): readonly string[] => [
  "",
  "— BeOnEdge",
  ...(config.supportAddress === null ? [] : [`Questions? Write to ${config.supportAddress}.`]),
]

const applicationRejected = (config: EmailTemplateConfig): TemplateRenderResult => {
  const lines = [
    "Thank you for your interest in BeOnEdge.",
    "",
    "After review, we are not able to open an account for you at this time.",
    "No further action is needed, and nothing has been charged.",
    ...signature(config),
  ]
  return { kind: "rendered", email: { subject: "Update on your BeOnEdge application", text: lines.join("\n") } }
}

/**
 * Approval for an applicant who already chose their password at signup.
 *
 * Carries no token and no code, because there is nothing to redeem: the account
 * exists and the credential is already theirs. Deliberately does not restate the
 * password or hint at it — the message is a notification, and an approval mail
 * that cannot be replayed into account access is one less thing an intercepted
 * mailbox is worth.
 *
 * When the payload carries `downloadUrl` (the latest published client APK), the
 * message includes it so the recipient can install the app straight away. When
 * no APK is published the mail still sends, just without the link.
 */
const accountApproved = (
  data: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  const downloadUrl = stringField(data, "downloadUrl")

  const lines = [
    "Welcome to BeOnEdge — your application has been approved.",
    "",
    ...(downloadUrl === null
      ? []
      : ["Download the BeOnEdge app here:", downloadUrl, ""]),
    "Sign in with the same email address and password you used when you signed",
    "up at beonedge.in.",
    "",
    "Before you can invest, the app will ask you to verify your email address",
    "and complete Email OTP Verification.",
    "",
    "If you no longer remember your password, contact us and we will help you",
    "regain access.",
    ...signature(config),
  ]
  return {
    kind: "rendered",
    email: { subject: "Welcome to BeOnEdge — your account is approved", text: lines.join("\n") },
  }
}

/** Render the body for a queued delivery's template key and payload. */
export const renderEmailTemplate = (
  templateKey: string,
  templateData: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  switch (templateKey) {
    case "application_rejected":
      return applicationRejected(config)
    case "account_approved":
      return accountApproved(templateData, config)
    default:
      return { kind: "unrenderable", errorCode: "TEMPLATE_UNKNOWN" }
  }
}
