import { renderEmail, type RenderedEmail } from "./emailLayout.js"
import { formatCalendarDate, formatRupeesFromPaise } from "./emailMoney.js"
import { requiredString, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"

export const ONE_TIME_INVESTMENT_TEMPLATE_KEY = "one_time_investment_recorded"

const render = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig): RenderedEmail => {
  const amount = formatRupeesFromPaise(requiredString(data, "amountPaise"))
  const date = formatCalendarDate(requiredString(data, "effectiveDate"))
  const fundName = requiredString(data, "fundName")
  return renderEmail({
    subject: "One-time investment recorded",
    preheader: "A one-time investment has been added to your BeOnEdge app.",
    heading: "One-time investment recorded",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${requiredString(data, "fullName")},` },
      {
        kind: "text",
        text: `Your one-time investment of ${amount} in ${fundName}, dated ${date}, has been added to your BeOnEdge app.`,
      },
      { kind: "text", text: "Open the BeOnEdge app to check it in your portfolio and on its receipt." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you do not recognise this investment, contact BeOnEdge support." },
      { kind: "text", text: "Investments are subject to market risk." },
    ],
  })
}

export const oneTimeInvestmentTemplate: EmailTemplateModule = {
  key: ONE_TIME_INVESTMENT_TEMPLATE_KEY,
  versions: ["v1"],
  render,
}
