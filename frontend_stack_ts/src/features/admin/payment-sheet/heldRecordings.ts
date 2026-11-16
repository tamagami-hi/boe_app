import { isIdempotencyKey } from "~/api/idempotency"
import { clearHeldKeys, dropOtherAdminsKeys } from "~/features/admin/shared/heldWriteStore"

import { MONTHLY_REASON } from "./recordingSheet"
import type { RecordingBody } from "./recordingSheet"

export type HeldRecording = Readonly<{ idempotencyKey: string; userId: string; body: RecordingBody }>

const PREFIX = "beo.admin.recording-sheet.v1"

const storageKey = (scheduleId: string, month: string): string => `${PREFIX}:${month}:${scheduleId}`

const isText = (value: unknown): value is string => typeof value === "string" && value !== ""

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

const parseHeld = (raw: string, scheduleId: string, month: string): HeldRecording | null => {
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
  }
}

const sessionStore = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const loadHeldRecordings = (month: string, adminId: string): ReadonlyMap<string, HeldRecording> => {
  const store = sessionStore()
  const prefix = `${PREFIX}:${month}:`
  if (store === null || !dropOtherAdminsKeys(prefix, adminId)) return new Map()
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index) ?? "")
    return new Map(
      keys
        .filter((key) => key.startsWith(prefix))
        .flatMap((key) => {
          const scheduleId = key.slice(prefix.length)
          const raw = store.getItem(key)
          const held = raw === null ? null : parseHeld(raw, scheduleId, month)
          return held === null ? [] : [[scheduleId, held] as const]
        }),
    )
  } catch {
    return new Map()
  }
}

export const keepHeldRecording = (adminId: string, held: HeldRecording): boolean => {
  const { scheduleId, month } = held.body.sipScheduleLink
  const store = sessionStore()
  if (store === null) return false
  try {
    store.setItem(storageKey(scheduleId, month), JSON.stringify({ adminId, ...held }))
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
