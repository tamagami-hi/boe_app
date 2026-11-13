const INDIA_UTC_OFFSET_MS = 330 * 60 * 1000

export const indiaToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + INDIA_UTC_OFFSET_MS).toISOString().slice(0, 10)
