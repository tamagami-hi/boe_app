/**
 * Onboarding email bodies (spec 04 §6.2, decision 10).
 *
 * The outbox row carries the template key and the transient secret the message
 * needs (`verificationToken`, `activationToken`); this module turns that pair
 * into the subject and body actually sent. Rendering is pure so the wording and
 * the link shapes are unit-testable without a transport.
 *
 * Two link styles are needed because the two flows land in different places:
 *  - email verification continues on the public site, which has a
 *    `/verify-email` page that posts the token for the visitor;
 *  - activation happens inside the app, which has no deep-link scheme
 *    registered yet, so the invite carries the token as text for the client to
 *    paste on the activation screen. When an activation URL *is* configured the
 *    message adds it as a convenience link.
 */

export interface EmailTemplateConfig {
  /** Public origin of the marketing/landing site, e.g. `https://beonedge.example`. */
  readonly landingOrigin: string | null
  /** Optional deep/app link that opens the activation screen with a token. */
  readonly activationUrl: string | null
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

const appendLink = (lines: readonly string[], label: string, url: string | null): readonly string[] =>
  url === null ? lines : [...lines, "", label, url]

const signature = (config: EmailTemplateConfig): readonly string[] => [
  "",
  "— BeOnEdge",
  ...(config.supportAddress === null ? [] : [`Questions? Write to ${config.supportAddress}.`]),
]

const verifyEmail = (
  data: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  const token = stringField(data, "verificationToken")
  // Without the token the message would be useless; that is a permanent failure,
  // not something a retry can fix.
  if (token === null) return { kind: "unrenderable", errorCode: "TEMPLATE_DATA_MISSING" }

  const link =
    config.landingOrigin === null
      ? null
      : `${config.landingOrigin}/verify-email?token=${encodeURIComponent(token)}`

  const lines = [
    "Confirm your email address to continue your BeOnEdge application.",
    ...appendLink([], "Open this link to confirm:", link),
    ...(link === null ? ["", "Your confirmation code:", token] : []),
    "",
    "The link expires shortly. If it has expired, start the signup again.",
    ...signature(config),
  ]
  return { kind: "rendered", email: { subject: "Confirm your email for BeOnEdge", text: lines.join("\n") } }
}

const activationInvite = (
  data: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  const token = stringField(data, "activationToken")
  if (token === null) return { kind: "unrenderable", errorCode: "TEMPLATE_DATA_MISSING" }

  const link =
    config.activationUrl === null
      ? null
      : `${config.activationUrl}${config.activationUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`

  const lines = [
    "Your BeOnEdge application has been approved.",
    "",
    "Open the BeOnEdge app, choose “Activate account”, and enter this activation code",
    "to set your password:",
    "",
    token,
    ...appendLink([], "Or open the app directly:", link),
    "",
    "The code can be used once and expires. Ask for a new invitation if it lapses.",
    ...signature(config),
  ]
  return { kind: "rendered", email: { subject: "Your BeOnEdge account is approved", text: lines.join("\n") } }
}

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
 */
const accountApproved = (config: EmailTemplateConfig): TemplateRenderResult => {
  const lines = [
    "Your BeOnEdge application has been approved.",
    "",
    "You can sign in to the BeOnEdge app now, using your email address and the",
    "password you chose when you signed up.",
    "",
    "If you no longer remember that password, contact us and we will help you",
    "regain access.",
    ...signature(config),
  ]
  return { kind: "rendered", email: { subject: "Your BeOnEdge account is open", text: lines.join("\n") } }
}

/** Render the body for a queued delivery's template key and payload. */
export const renderEmailTemplate = (
  templateKey: string,
  templateData: Readonly<Record<string, unknown>>,
  config: EmailTemplateConfig,
): TemplateRenderResult => {
  switch (templateKey) {
    case "verify_email":
      return verifyEmail(templateData, config)
    case "activation_invite":
      return activationInvite(templateData, config)
    case "application_rejected":
      return applicationRejected(config)
    case "account_approved":
      return accountApproved(config)
    default:
      return { kind: "unrenderable", errorCode: "TEMPLATE_UNKNOWN" }
  }
}
