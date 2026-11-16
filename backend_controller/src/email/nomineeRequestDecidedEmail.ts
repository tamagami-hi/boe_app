import { renderEmail, type EmailBlock, type RenderedEmail } from "./emailLayout.js"
import { requiredString, stringField, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { EmailValidationError } from "./emailValidation.js"

export const NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY = "nominee_request_decided"

export type NomineeRequestDecision = "accepted" | "declined"

export interface NomineeRequestDecidedInput {
  readonly fullName: string
  readonly decision: NomineeRequestDecision
  readonly declineReason: string | null
}

const TITLE: Readonly<Record<NomineeRequestDecision, string>> = {
  accepted: "Your nominee request was accepted",
  declined: "Your nominee request was declined",
}

const outcomeBlocks = (input: NomineeRequestDecidedInput): readonly EmailBlock[] => {
  if (input.decision === "accepted") {
    return [
      { kind: "text", text: "The BeOnEdge team has accepted your nominee request, and the nominee on your account is now updated." },
    ]
  }
  return [
    { kind: "text", text: "The BeOnEdge team has declined your nominee request, so the nominee on your account has not changed." },
    input.declineReason === null
      ? { kind: "text", text: "The team did not give a reason." }
      : { kind: "text", text: `The reason the team gave: ${input.declineReason}` },
  ]
}

export const nomineeRequestDecidedEmail = (input: NomineeRequestDecidedInput, config: EmailTemplateConfig): RenderedEmail => {
  const title = TITLE[input.decision]
  return renderEmail({
    subject: title,
    preheader: "An update on the nominee request you sent from the BeOnEdge app.",
    heading: title,
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${input.fullName},` },
      ...outcomeBlocks(input),
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
    nomineeRequestDecidedEmail(
      { fullName: requiredString(data, "fullName"), decision: decisionOf(data), declineReason: stringField(data, "declineReason") },
      config,
    ),
}
