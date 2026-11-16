import type { EmailBlock, RenderedEmail } from "./emailLayout.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { EmailValidationError } from "./emailValidation.js"

export interface EmailTemplateModule {
  readonly key: string
  readonly versions: readonly string[]
  readonly render: (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig) => RenderedEmail
}

export const stringField = (data: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export const requiredString = (data: Readonly<Record<string, unknown>>, key: string): string => {
  const value = stringField(data, key)
  if (value === null) throw new EmailValidationError("EMAIL_TEMPLATE_DATA_INVALID")
  return value
}

const WEB_APP_LEAD = "On an iPhone or a computer, you can open the BeOnEdge web app at"

export const webAppBlocks = (config: EmailTemplateConfig): readonly EmailBlock[] => {
  const url = config.webAppUrl ?? null
  return url === null ? [] : [{ kind: "link", lead: WEB_APP_LEAD, url }]
}
