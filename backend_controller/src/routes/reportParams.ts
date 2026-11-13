import { z } from "zod"

import { AppError } from "../http/errorCatalog.js"

const DAY_MS = 24 * 60 * 60 * 1000

export const calendarDateSchema = z.iso.date()

export const calendarMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, "must be a month as YYYY-MM")

export const indiaDayStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)

export const indiaNextDayStart = (date: string): Date => new Date(indiaDayStart(date).getTime() + DAY_MS)

const uuidValue = z.string().uuid()

export const readUuidPairKeyset = (
  values: readonly string[],
): Readonly<{ first: string; second: string }> | null => {
  if (values.length === 0) return null
  const [first, second] = values
  if (
    first === undefined ||
    second === undefined ||
    !uuidValue.safeParse(first).success ||
    !uuidValue.safeParse(second).success
  ) {
    throw new AppError("CURSOR_INVALID")
  }
  return { first, second }
}
