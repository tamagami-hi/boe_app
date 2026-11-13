import { AppError } from "../../http/errorCatalog.js"

const INDIA_UTC_OFFSET_MS = 330 * 60 * 1000

export const indiaCalendarDate = (now: Date): string =>
  new Date(now.getTime() + INDIA_UTC_OFFSET_MS).toISOString().slice(0, 10)

export const refuseFutureDate = (field: string, date: string, now: Date): void => {
  if (date > indiaCalendarDate(now)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { [field]: ["cannot be later than today in India"] },
    })
  }
}
