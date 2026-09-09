import type { StatusTone } from "~/domain/status"

export type NotificationCategory = Readonly<{
  label: string
  tone: StatusTone
}>

const CATEGORIES: Readonly<Record<string, NotificationCategory>> = {
  client_value_updated: { label: "Portfolio", tone: "info" },
  client_contribution_recorded: { label: "Investment", tone: "info" },
  fund_receipt_acknowledged: { label: "Investment", tone: "positive" },
  sip_installment_due: { label: "SIP", tone: "info" },
  app_update_available: { label: "App", tone: "neutral" },
}

export const notificationCategory = (kind: string): NotificationCategory | null =>
  CATEGORIES[kind] ?? null
