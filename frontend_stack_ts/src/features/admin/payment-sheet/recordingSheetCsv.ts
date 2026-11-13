import { AMOUNT_MESSAGE, DATE_MESSAGE, isPastOrToday, parseSheetAmount } from "./recordingSheet"
import type { SheetSchedule } from "./recordingSheet"

export type CsvFill = Readonly<{ line: number; scheduleId: string; amountText: string; dateText: string | null }>

export type CsvProblem = Readonly<{ line: number; text: string; reason: string }>

export type CsvMatch = Readonly<{ fills: readonly CsvFill[]; problems: readonly CsvProblem[] }>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export const SHAPE_MESSAGE = "Expected a reference, an amount and an optional date, separated by commas or tabs."
export const NO_MATCH_MESSAGE =
  "No schedule on this sheet matches this reference. Use the client's email, the client id or the schedule id."
export const NOT_FILLABLE_MESSAGE = "This row is already recorded, being sent or waiting for Check again, so it was not changed."

const ambiguousMessage = (count: number): string =>
  `This client has ${String(count)} schedules on this sheet. Use the schedule id, or choose a fund first.`

const duplicateMessage = (line: number): string => `Line ${String(line)} already fills this row.`

const splitQuoted = (line: string): string[] => {
  const fields: string[] = []
  let current = ""
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }
  return [...fields, current]
}

export const splitCsvLine = (line: string): readonly string[] =>
  (line.includes("\t") ? line.split("\t") : splitQuoted(line)).map((field) => field.trim())

const matchingRows = (reference: string, rows: readonly SheetSchedule[]): readonly SheetSchedule[] => {
  const wanted = reference.toLowerCase()
  if (UUID_PATTERN.test(reference)) {
    const bySchedule = rows.filter((row) => row.scheduleId.toLowerCase() === wanted)
    return bySchedule.length > 0 ? bySchedule : rows.filter((row) => row.userId.toLowerCase() === wanted)
  }
  if (!reference.includes("@")) return []
  return rows.filter((row) => row.clientEmail.toLowerCase() === wanted)
}

type LineVerdict = Readonly<{ fill: CsvFill } | { reason: string }>

const judgeLine = (
  fields: readonly string[],
  line: number,
  rows: readonly SheetSchedule[],
  today: string,
): LineVerdict => {
  const [reference = "", amountText = "", dateText = ""] = fields
  if (fields.length < 2 || fields.length > 3 || reference === "") return { reason: SHAPE_MESSAGE }
  const matches = matchingRows(reference, rows)
  const [row] = matches
  if (row === undefined) return { reason: NO_MATCH_MESSAGE }
  if (matches.length > 1) return { reason: ambiguousMessage(matches.length) }
  if (parseSheetAmount(amountText) === null) return { reason: AMOUNT_MESSAGE }
  if (dateText !== "" && !isPastOrToday(dateText, today)) return { reason: DATE_MESSAGE }
  return { fill: { line, scheduleId: row.scheduleId, amountText, dateText: dateText === "" ? null : dateText } }
}

export const matchCsv = (
  text: string,
  rows: readonly SheetSchedule[],
  isFillable: (scheduleId: string) => boolean,
  today: string,
): CsvMatch =>
  text.split(/\r?\n/u).reduce<CsvMatch>(
    (match, raw, index) => {
      const line = index + 1
      const trimmed = raw.trim()
      if (trimmed === "") return match
      const verdict = judgeLine(splitCsvLine(trimmed), line, rows, today)
      const problem = (reason: string): CsvMatch => ({
        ...match,
        problems: [...match.problems, { line, text: trimmed, reason }],
      })
      if ("reason" in verdict) return problem(verdict.reason)
      const earlier = match.fills.find((fill) => fill.scheduleId === verdict.fill.scheduleId)
      if (earlier !== undefined) return problem(duplicateMessage(earlier.line))
      if (!isFillable(verdict.fill.scheduleId)) return problem(NOT_FILLABLE_MESSAGE)
      return { ...match, fills: [...match.fills, verdict.fill] }
    },
    { fills: [], problems: [] },
  )
