import { isIdempotencyKey } from "~/api/idempotency"
import {
  asRecord,
  clearHeldKeys,
  dropOtherAdminsKeys,
  heldAtOf,
  parseJson,
  sessionStore,
} from "~/features/admin/shared/heldWriteStore"

import { MONTHLY_REASON } from "./recordingSheet"
import type { RecordingBody } from "./recordingSheet"

export type HeldRecording = Readonly<{ idempotencyKey: string; userId: string; body: RecordingBody }>

export type StoredRecording = HeldRecording & Readonly<{ heldAt: number | null }>

export type HeldRecordingsRead = Readonly<{
  held: ReadonlyMap<string, StoredRecording>
  unreadable: readonly string[]
}>

const PREFIX = "beo.admin.recording-sheet.v1"

const NOTHING_HELD: HeldRecordingsRead = { held: new Map(), unreadable: [] }

const storageKey = (scheduleId: string, month: string): string => `${PREFIX}:${month}:${scheduleId}`

const isText = (value: unknown): value is string => typeof value === "string" && value !== ""

const parseHeld = (raw: string, scheduleId: string, month: string): StoredRecording | null => {
  const held = asRecord(parseJson(raw))
  const body = asRecord(held?.body)
  const link = asRecord(body?.sipScheduleLink)
  if (held === null || body === null || link === null) return null
  const { idempotencyKey, userId } = held
  const { fundId, amountPaise, effectiveDate, reasonCode } = body
  if (!isText(idempotencyKey) || !isIdempotencyKey(idempotencyKey) || !isText(userId)) return null
  if (!isText(fundId) || !isText(amountPaise) || !isText(effectiveDate) || reasonCode !== MONTHLY_REASON) return null
  if (link.scheduleId !== scheduleId || link.month !== month) return null
  return {
    idempotencyKey,
    userId,
    body: { fundId, amountPaise, effectiveDate, reasonCode, sipScheduleLink: { scheduleId, month } },
    heldAt: heldAtOf(held),
  }
}

export const readHeldRecordings = (month: string, adminId: string): HeldRecordingsRead => {
  const store = sessionStore()
  const prefix = `${PREFIX}:${month}:`
  if (store === null || !dropOtherAdminsKeys(prefix, adminId)) return NOTHING_HELD
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index) ?? "")
    const read = keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => {
        const scheduleId = key.slice(prefix.length)
        const raw = store.getItem(key)
        return { scheduleId, held: raw === null ? null : parseHeld(raw, scheduleId, month) }
      })
    return {
      held: new Map(read.flatMap(({ scheduleId, held }) => (held === null ? [] : [[scheduleId, held] as const]))),
      unreadable: read.flatMap(({ scheduleId, held }) => (held === null ? [scheduleId] : [])),
    }
  } catch {
    return NOTHING_HELD
  }
}

export const loadHeldRecordings = (month: string, adminId: string): ReadonlyMap<string, HeldRecording> =>
  readHeldRecordings(month, adminId).held

export const keepHeldRecording = (adminId: string, held: HeldRecording, heldAt: number = Date.now()): boolean => {
  const { scheduleId, month } = held.body.sipScheduleLink
  const store = sessionStore()
  if (store === null) return false
  try {
    const { idempotencyKey, userId, body } = held
    store.setItem(storageKey(scheduleId, month), JSON.stringify({ adminId, idempotencyKey, userId, body, heldAt }))
    return true
  } catch {
    return false
  }
}

export const releaseHeldRecording = (scheduleId: string, month: string): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    store.removeItem(storageKey(scheduleId, month))
    return true
  } catch {
    return false
  }
}

export const clearHeldRecordings = (): boolean => clearHeldKeys(`${PREFIX}:`)

export const dropOtherAdminsRecordings = (adminId: string): boolean => dropOtherAdminsKeys(`${PREFIX}:`, adminId)
