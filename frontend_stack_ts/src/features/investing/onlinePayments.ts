import type { StatusPresentation } from "~/domain/status"
import { useAppConfigFeed } from "~/features/app-notice/appNoticeQuery"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const readOnlinePaymentsOff = (config: unknown): boolean => {
  if (!isRecord(config)) return false
  const flags = config.featureFlags
  return isRecord(flags) && flags.onlinePayments === false
}

export const useOnlinePaymentsOff = (): boolean => {
  const feed = useAppConfigFeed(false)
  return readOnlinePaymentsOff(feed.data?.config)
}

export const PAYMENT_NOT_COMPLETED: StatusPresentation = { label: "Not completed", tone: "neutral" }
