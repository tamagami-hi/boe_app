import { renderEmail, type RenderedEmail } from "./emailLayout.js"
import { formatCalendarDate, formatRupeesFromPaise } from "./emailMoney.js"
import { requiredString, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"

export const SIP_EARLY_EXIT_TEMPLATE_KEY = "sip_early_exit"

const render = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig): RenderedEmail => {
  const amount = formatRupeesFromPaise(requiredString(data, "amountPaise"))
  const date = formatCalendarDate(requiredString(data, "effectiveDate"))
  const fundName = requiredString(data, "fundName")
  return renderEmail({
    subject: "Your SIP was closed early",
    preheader: "Your SIP was closed early and its value is being returned to you.",
    heading: "Your SIP was closed early",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${requiredString(data, "fullName")},` },
      {
        kind: "text",
        text: `Your SIP in ${fundName} was closed early on ${date}. The full current value of your investment in this fund, ${amount}, is being returned to you.`,
      },
      { kind: "text", text: "The payout is awaited. Open the BeOnEdge app to see the early exit in your activity." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you do not recognise this, contact BeOnEdge support." },
      { kind: "text", text: "Investments are subject to market risk." },
    ],
  })
}

export const sipEarlyExitTemplate: EmailTemplateModule = {
  key: SIP_EARLY_EXIT_TEMPLATE_KEY,
  versions: ["v1"],
  render,
}
