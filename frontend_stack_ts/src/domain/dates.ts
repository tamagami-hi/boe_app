export class DateFormatError extends Error {
  public readonly code = "DATE_FORMAT_INVALID"

  public constructor(message: string) {
    super(message)
    this.name = "DateFormatError"
  }
}

const LOCALE = "en-IN"
const TIME_ZONE = "Asia/Kolkata"
const MS_PER_DAY = 86_400_000

export const parseIsoDateTime = (value: string): Date => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new DateFormatError("Value is not a parseable ISO date-time")
  }
  return parsed
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
})

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const monthFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  month: "short",
  year: "numeric",
})

export const formatDate = (value: string): string => dateFormatter.format(parseIsoDateTime(value))

export const formatDateTime = (value: string): string =>
  dateTimeFormatter.format(parseIsoDateTime(value))

export const formatTime = (value: string): string => timeFormatter.format(parseIsoDateTime(value))

export const formatMonth = (value: string): string => monthFormatter.format(parseIsoDateTime(value))

const startOfUtcDay = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

export const daysBetween = (from: Date, to: Date): number =>
  Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY)

export const formatRelativeDay = (value: string, now: Date = new Date()): string => {
  const target = parseIsoDateTime(value)
  const difference = daysBetween(now, target)
  if (difference === 0) return "Today"
  if (difference === -1) return "Yesterday"
  if (difference === 1) return "Tomorrow"
  return formatDate(value)
}

export const secondsUntil = (value: string, now: Date = new Date()): number => {
  const target = parseIsoDateTime(value)
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000))
}

export const hasElapsed = (value: string, now: Date = new Date()): boolean =>
  parseIsoDateTime(value).getTime() <= now.getTime()

export const formatCountdown = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new DateFormatError("Countdown seconds must be a non-negative finite number")
  }
  const whole = Math.floor(totalSeconds)
  const minutes = Math.floor(whole / 60)
  const seconds = whole % 60
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`
}

export const DEBIT_DAY_MIN = 1
export const DEBIT_DAY_MAX = 28

export const isDebitDay = (value: number): boolean =>
  Number.isInteger(value) && value >= DEBIT_DAY_MIN && value <= DEBIT_DAY_MAX
