import { renderEmail, type EmailBlock, type RenderedEmail } from "./emailLayout.js"
import { formatCalendarDate, formatCalendarMonth, formatRupeesFromPaise } from "./emailMoney.js"
import { requiredString, stringField, webAppBlocks, type EmailTemplateModule } from "./emailTemplateParts.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { EmailValidationError } from "./emailValidation.js"

export const SIP_PAYMENT_TEMPLATE_KEY = "sip_payment_recorded"

const MAX_SCHEDULE_MONTHS = 600

const monthCountOf = (data: Readonly<Record<string, unknown>>, key: string): number => {
  const value = data[key]
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_SCHEDULE_MONTHS) {
    throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  }
  return value
}

const nextMonthBlock = (data: Readonly<Record<string, unknown>>): EmailBlock => {
  if (data.nextMonth === null) return { kind: "text", text: "Every month of this SIP is now recorded." }
  const nextMonth = stringField(data, "nextMonth")
  if (nextMonth === null) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return { kind: "text", text: `The next month due is ${formatCalendarMonth(nextMonth)}.` }
}

const render = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig): RenderedEmail => {
  const amount = formatRupeesFromPaise(requiredString(data, "amountPaise"))
  const date = formatCalendarDate(requiredString(data, "effectiveDate"))
  const sipMonth = formatCalendarMonth(requiredString(data, "sipMonth"))
  const fundName = requiredString(data, "fundName")
  const monthNumber = monthCountOf(data, "monthNumber")
  const monthCount = monthCountOf(data, "monthCount")
  if (monthNumber > monthCount) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return renderEmail({
    subject: "SIP payment recorded",
    preheader: "A SIP payment has been added to your BeOnEdge app.",
    heading: "SIP payment recorded",
    supportAddress: config.supportAddress,
    blocks: [
      { kind: "text", text: `Hello ${requiredString(data, "fullName")},` },
      {
        kind: "text",
        text: `Your SIP payment of ${amount} in ${fundName}, dated ${date}, has been added to your BeOnEdge app.`,
      },
      {
        kind: "text",
        text: `It is recorded for ${sipMonth}, month ${String(monthNumber)} of ${String(monthCount)} of this SIP.`,
      },
      nextMonthBlock(data),
      { kind: "text", text: "Open the BeOnEdge app to check it in your portfolio and on its receipt." },
      ...webAppBlocks(config),
      { kind: "text", text: "If you do not recognise this payment, contact BeOnEdge support." },
      { kind: "text", text: "Investments are subject to market risk." },
    ],
  })
}

export const sipPaymentTemplate: EmailTemplateModule = {
  key: SIP_PAYMENT_TEMPLATE_KEY,
  versions: ["v1"],
  render,
}
