import { renderEmail, type EmailBlock, type RenderedEmail } from "./emailLayout.js"
import { formatCalendarDate, formatRupeesFromPaise } from "./emailMoney.js"
import { requiredString, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { growthChangeOf, growthPartLines, type GrowthChange } from "./investmentGrowthParts.js"

export const INVESTMENT_GROWTH_TEMPLATE_KEY = "investment_growth"

const changeBlocks = (
  data: Readonly<Record<string, unknown>>,
  change: GrowthChange,
  fundName: string,
  date: string,
): readonly EmailBlock[] => {
  if (data.parts === undefined) {
    return [
      {
        kind: "text",
        text: `The value of your investment in ${fundName} was updated as of ${date}. This update is a ${change.kind} of ${change.amount}.`,
      },
    ]
  }
  return [
    { kind: "text", text: `The value of your investments in ${fundName} was updated as of ${date}.` },
    ...growthPartLines(data.parts, change.paise).map((text): EmailBlock => ({ kind: "text", text })),
    { kind: "text", text: `In total, this update is a ${change.kind} of ${change.amount}.` },
  ]
}

const render = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig): RenderedEmail => {
  const change = growthChangeOf(requiredString(data, "deltaPaise"))
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
      ...changeBlocks(data, change, fundName, date),
      { kind: "text", text: `Your value in this fund is now ${valueAfter}.` },
      { kind: "text", text: "Open the BeOnEdge app and go to Portfolio to see your current value." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you have questions about this update, contact BeOnEdge support." },
      { kind: "text", text: "Investments are subject to market risk." },
    ],
  })
}

export const investmentGrowthTemplate: EmailTemplateModule = {
  key: INVESTMENT_GROWTH_TEMPLATE_KEY,
  versions: ["v1", "v2"],
  render,
}
