import { renderEmail, type EmailBlock, type RenderedEmail } from "./emailLayout.js"
import { requiredString, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { EmailValidationError } from "./emailValidation.js"

export const NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY = "nominee_request_decided"

export type NomineeRequestDecision = "accepted" | "declined"

export interface NomineeRequestDecidedInput {
  readonly fullName: string
  readonly decision: NomineeRequestDecision
}

const COPY: Readonly<Record<NomineeRequestDecision, Readonly<{ title: string; outcome: readonly EmailBlock[] }>>> = {
  accepted: {
    title: "Your nominee request was accepted",
    outcome: [
      { kind: "text", text: "The BeOnEdge team has accepted your nominee request, and the nominee on your account is now updated." },
    ],
  },
  declined: {
    title: "Your nominee request was declined",
    outcome: [
      { kind: "text", text: "The BeOnEdge team has declined your nominee request, so the nominee on your account has not changed." },
      { kind: "text", text: "If the team gave a reason, you can read it on your Profile." },
    ],
  },
}

export const nomineeRequestDecidedEmail = (input: NomineeRequestDecidedInput, config: EmailTemplateConfig): RenderedEmail => {
  const copy = COPY[input.decision]
  return renderEmail({
    subject: copy.title,
    preheader: "An update on the nominee request you sent from the BeOnEdge app.",
    heading: copy.title,
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${input.fullName},` },
      ...copy.outcome,
      { kind: "text", text: "Open the BeOnEdge app and go to Profile to see the nominee on your account." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you did not send this request, contact BeOnEdge support." },
    ],
  })
}

const decisionOf = (data: Readonly<Record<string, unknown>>): NomineeRequestDecision => {
  const decision = data.decision
  if (decision !== "accepted" && decision !== "declined") throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return decision
}

export const nomineeRequestDecidedTemplate: EmailTemplateModule = {
  key: NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY,
  versions: ["v1"],
  render: (data, config) =>
    nomineeRequestDecidedEmail({ fullName: requiredString(data, "fullName"), decision: decisionOf(data) }, config),
}
