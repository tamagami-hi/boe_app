import type { AdminEmailTemplateKey } from "@beonedge/contracts"

export const EMAIL_TEMPLATE_OPTIONS = [
  { value: "account_approved", label: "Account approved" },
  { value: "application_rejected", label: "Application rejected" },
  { value: "password_set_link", label: "Password set link" },
  { value: "password_reset_link", label: "Password reset link" },
  { value: "password_app_download", label: "App download after password" },
  { value: "contact_phone_changed", label: "Phone changed notice" },
  { value: "email_change_code", label: "Email change code" },
  { value: "contact_email_changed", label: "Email changed notice" },
  { value: "admin_message", label: "Admin message" },
  { value: "app_update_notice", label: "App update notice" },
  { value: "investment_recorded", label: "Investment added" },
  { value: "maturity_options", label: "Maturity options" },
  { value: "nominee_request_decided", label: "Nominee request decided" },
  { value: "sip_early_exit", label: "SIP closed early" },
] as const satisfies readonly Readonly<{ value: AdminEmailTemplateKey; label: string }>[]

const TEMPLATE_LABEL: ReadonlyMap<string, string> = new Map(
  EMAIL_TEMPLATE_OPTIONS.map((option) => [option.value, option.label]),
)

export const emailTemplateLabel = (templateKey: string): string => TEMPLATE_LABEL.get(templateKey) ?? templateKey
