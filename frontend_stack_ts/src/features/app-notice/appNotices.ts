export type MaintenanceNotice = Readonly<{
  message: string
  scheduledFor: string | null
  active: boolean
}>

export type AppNotices = Readonly<{
  updateMessage: string | null
  maintenance: MaintenanceNotice | null
}>

const UPDATE_MESSAGE_MAX = 500
const MAINTENANCE_MESSAGE_MAX = 2_000

export const NO_NOTICES: AppNotices = { updateMessage: null, maintenance: null }

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const asText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed.slice(0, max)
}

const asTime = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null

export const readAppNotices = (config: unknown, now: Date): AppNotices => {
  const root = asRecord(config)
  const maintenance = asRecord(root.maintenance)
  const message = asText(maintenance.message, MAINTENANCE_MESSAGE_MAX)
  const scheduledFor = asTime(maintenance.scheduledFor)
  const active = maintenance.enabled === true
  const upcoming = scheduledFor !== null && Date.parse(scheduledFor) > now.getTime()

  return {
    updateMessage: asText(asRecord(root.minimumSupportedVersion).message, UPDATE_MESSAGE_MAX),
    maintenance: message !== null && (active || upcoming) ? { message, scheduledFor, active } : null,
  }
}
