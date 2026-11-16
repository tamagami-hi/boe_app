import { useRef, useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { useSession } from "~/app/providers/SessionProvider"

import { keepHeldRecording, loadHeldRecordings, releaseHeldRecording } from "./heldRecordings"
import type { HeldRecording } from "./heldRecordings"
import type { RecordingBody, RowEntry } from "./recordingSheet"
import type { RefreshAfterRecording, SendRecording } from "./recordingSheetQueries"

export const MAX_IN_FLIGHT = 2

export const UNSENT_MESSAGE = "This row could not be sent. Reload the page and try again."

export type RecordJob = Readonly<{ userId: string; body: RecordingBody }>

export type SheetRecorder = Readonly<{
  entries: ReadonlyMap<string, RowEntry>
  held: ReadonlyMap<string, HeldRecording>
  busy: boolean
  record: (jobs: readonly RecordJob[]) => void
  checkAgain: (scheduleId: string) => void
  recordAnother: (scheduleId: string) => void
}>

const QUEUED: RowEntry = { kind: "queued" }
const SENDING: RowEntry = { kind: "sending" }
const UNKNOWN: RowEntry = { kind: "unknown" }
const REARMED: RowEntry = { kind: "rearmed" }

const FIELD_LABELS: Readonly<Record<string, string>> = {
  amountPaise: "Amount",
  effectiveDate: "Date",
  fundId: "Fund",
  sipScheduleLink: "Schedule link",
  "sipScheduleLink.scheduleId": "Schedule",
  "sipScheduleLink.month": "Month",
}

const BLOCKING_KINDS: ReadonlySet<RowEntry["kind"]> = new Set(["queued", "sending", "unknown", "recorded"])

export const refusalMessage = (error: unknown): string => {
  if (!isApiError(error)) return UNSENT_MESSAGE
  const lines = Object.entries(error.fields ?? {}).flatMap(([field, messages]) =>
    messages.map((message) => `${FIELD_LABELS[field] ?? field} ${message}`),
  )
  return lines.length === 0 ? error.message : lines.join(" ")
}

const idOf = (job: HeldRecording): string => job.body.sipScheduleLink.scheduleId

const withEntry = (entries: ReadonlyMap<string, RowEntry>, scheduleId: string, entry: RowEntry) =>
  new Map(entries).set(scheduleId, entry)

const withoutHeld = (held: ReadonlyMap<string, HeldRecording>, scheduleId: string) =>
  new Map([...held].filter(([id]) => id !== scheduleId))

export const useRecordingSheetRecorder = (
  month: string,
  send: SendRecording,
  refresh: RefreshAfterRecording,
): SheetRecorder => {
  const adminId = useSession().principal?.userId ?? null
  const [held, setHeld] = useState<ReadonlyMap<string, HeldRecording>>(() =>
    adminId === null ? new Map() : loadHeldRecordings(month, adminId),
  )
  const [entries, setEntries] = useState<ReadonlyMap<string, RowEntry>>(
    () => new Map([...held.keys()].map((scheduleId) => [scheduleId, UNKNOWN])),
  )
  const queue = useRef<readonly HeldRecording[]>([])
  const active = useRef<ReadonlySet<string>>(new Set())
  const touchedUsers = useRef<ReadonlySet<string>>(new Set())

  const confirm = (scheduleId: string, entry: RowEntry): void => {
    releaseHeldRecording(scheduleId, month)
    setHeld((current) => withoutHeld(current, scheduleId))
    setEntries((current) => withEntry(current, scheduleId, entry))
  }

  const settle = async (job: HeldRecording): Promise<void> => {
    const scheduleId = idOf(job)
    try {
      const result = await send(job)
      confirm(scheduleId, { kind: "recorded", amountPaise: result.amountPaise, effectiveDate: result.effectiveDate })
    } catch (error) {
      if (isUnknownWriteOutcome(error)) {
        setEntries((current) => withEntry(current, scheduleId, UNKNOWN))
        return
      }
      confirm(scheduleId, { kind: "refused", message: refusalMessage(error) })
    }
  }

  const finish = (job: HeldRecording): void => {
    active.current = new Set([...active.current].filter((id) => id !== idOf(job)))
    pump()
    if (active.current.size > 0) return
    const users = [...touchedUsers.current]
    touchedUsers.current = new Set()
    void refresh(users)
  }

  const pump = (): void => {
    const inFlight = active.current.size - queue.current.length
    const startable = queue.current.slice(0, Math.max(0, MAX_IN_FLIGHT - inFlight))
    if (startable.length === 0) return
    queue.current = queue.current.slice(startable.length)
    touchedUsers.current = new Set([...touchedUsers.current, ...startable.map((job) => job.userId)])
    setEntries((current) => startable.reduce((next, job) => withEntry(next, idOf(job), SENDING), current))
    for (const job of startable) {
      void settle(job).finally(() => {
        finish(job)
      })
    }
  }

  const enqueue = (jobs: readonly HeldRecording[]): void => {
    if (jobs.length === 0) return
    queue.current = [...queue.current, ...jobs]
    active.current = new Set([...active.current, ...jobs.map(idOf)])
    setEntries((current) => jobs.reduce((next, job) => withEntry(next, idOf(job), QUEUED), current))
    pump()
  }

  const isFree = (scheduleId: string): boolean => {
    const entry = entries.get(scheduleId)
    return !held.has(scheduleId) && !active.current.has(scheduleId) && (entry === undefined || !BLOCKING_KINDS.has(entry.kind))
  }

  return {
    entries,
    held,
    busy: [...entries.values()].some((entry) => entry.kind === "queued" || entry.kind === "sending"),
    record: (jobs) => {
      const minted = jobs
        .filter((job) => isFree(job.body.sipScheduleLink.scheduleId))
        .map((job): HeldRecording => ({ idempotencyKey: mintIdempotencyKey(), userId: job.userId, body: job.body }))
      if (adminId !== null) for (const job of minted) keepHeldRecording(adminId, job)
      setHeld((current) => new Map([...current, ...minted.map((job) => [idOf(job), job] as const)]))
      enqueue(minted)
    },
    checkAgain: (scheduleId) => {
      const job = held.get(scheduleId)
      if (job === undefined || active.current.has(scheduleId)) return
      enqueue([job])
    },
    recordAnother: (scheduleId) => {
      if (held.has(scheduleId) || active.current.has(scheduleId)) return
      setEntries((current) => withEntry(current, scheduleId, REARMED))
    },
  }
}
