import type { OrderState } from "../../db/types.js"

const OPEN_INSTALLMENT_STATES: readonly OrderState[] = ["submitted", "payment_pending"]

export const isInstallmentPeriodResolved = (state: OrderState): boolean => !OPEN_INSTALLMENT_STATES.includes(state)

export const termEndPeriod = (startDate: Date | string, durationMonths: number): string => {
  const start = new Date(startDate)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + durationMonths, 1)).toISOString().slice(0, 10)
}
