import { renderEmail, type RenderedEmail } from "./emailLayout.js"
import { formatCalendarDate, formatRupeesFromPaise } from "./emailMoney.js"
import { requiredString, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { EmailValidationError } from "./emailValidation.js"

export const INVESTMENT_GROWTH_TEMPLATE_KEY = "investment_growth"

const SIGNED_NON_ZERO_PAISE = /^(-?)([1-9][0-9]{0,18})$/u

interface GrowthChange {
  readonly kind: "gain" | "loss"
  readonly amount: string
}

const changeOf = (data: Readonly<Record<string, unknown>>): GrowthChange => {
  const match = SIGNED_NON_ZERO_PAISE.exec(requiredString(data, "deltaPaise"))
  if (match === null) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return { kind: match[1] === "-" ? "loss" : "gain", amount: formatRupeesFromPaise(match[2] ?? "") }
}

const render = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig): RenderedEmail => {
  const change = changeOf(data)
  const valueAfter = formatRupeesFromPaise(requiredString(data, "valueAfterPaise"))
  const date = formatCalendarDate(requiredString(data, "effectiveDate"))
  const fundName = requiredString(data, "fundName")
  return renderEmail({
    subject: "Investment value updated",
    preheader: "The value of one of your BeOnEdge investments was updated.",
    heading: "Investment value updated",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${requiredString(data, "fullName")},` },
      {
        kind: "text",
        text: `The value of your investment in ${fundName} was updated as of ${date}. This update is a ${change.kind} of ${change.amount}.`,
      },
      { kind: "text", text: `After this update, your value in this fund is ${valueAfter}.` },
      { kind: "text", text: "Open the BeOnEdge app and go to Portfolio to see your current value." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you have questions about this update, contact BeOnEdge support." },
      { kind: "text", text: "Investments are subject to market risk." },
    ],
  })
}

export const investmentGrowthTemplate: EmailTemplateModule = {
  key: INVESTMENT_GROWTH_TEMPLATE_KEY,
  versions: ["v1"],
  render,
}
