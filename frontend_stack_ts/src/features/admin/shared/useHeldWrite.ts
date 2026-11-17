import type { UseMutationResult } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { isApiError, isUnknownRetryOutcome, isUnknownWriteOutcome, type FieldErrors } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { useSession } from "~/app/providers/SessionProvider"

import { isPastReceiptLifetime, keepHold, readHold, releaseHold, type ReceiptRetention } from "./heldWriteStore"

export type HeldWriteOutcome<TResult> =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "done"; result: TResult }>
  | Readonly<{ kind: "rejected"; message: string; fields: FieldErrors; code: string | null }>
  | Readonly<{ kind: "unknown" }>

type Keyed = Readonly<{ idempotencyKey: string }>

export type HeldWrite<TBody, TResult> = Readonly<{
  outcome: HeldWriteOutcome<TResult>
  pending: boolean
  held: TBody | null
  persisted: boolean
  unreadable: boolean
  expired: boolean
  submit: (body: TBody) => void
  checkAgain: () => void
  reset: () => void
}>

export type HeldWritePersistence<TBody> = Readonly<{
  slot: string
  parseBody: (value: unknown) => TBody | null
  retention?: ReceiptRetention
}>

type HoldPlace = Readonly<{ slot: string; adminId: string; retention: ReceiptRetention }>

type Hold<TBody> = Readonly<{ body: TBody; idempotencyKey: string; place: HoldPlace | null; heldAt: number | null }>

type Restored<TBody> = Readonly<{
  hold: Hold<TBody> | null
  unreadableAt: HoldPlace | null
  expired: boolean
}>

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }
const UNKNOWN: HeldWriteOutcome<never> = { kind: "unknown" }
const NO_FIELDS: FieldErrors = {}
const NOTHING_RESTORED: Restored<never> = { hold: null, unreadableAt: null, expired: false }

const placeOf = (persist: HeldWritePersistence<unknown> | undefined, adminId: string | null): HoldPlace | null =>
  persist === undefined || adminId === null
    ? null
    : { slot: persist.slot, adminId, retention: persist.retention ?? "ordinary" }

const isPastLifetime = ({ place, heldAt }: Hold<unknown>, now: number): boolean =>
  place !== null && isPastReceiptLifetime(heldAt, now, place.retention)

const restore = <TBody>(persist: HeldWritePersistence<TBody> | undefined, adminId: string | null): Restored<TBody> => {
  const place = placeOf(persist, adminId)
  if (persist === undefined || place === null) return NOTHING_RESTORED
  const read = readHold(place.slot, place.adminId, persist.parseBody)
  if (read.kind === "none") return NOTHING_RESTORED
  if (read.kind === "unreadable") return { hold: null, unreadableAt: place, expired: false }
  const hold = { body: read.hold.body, idempotencyKey: read.hold.idempotencyKey, place, heldAt: read.heldAt }
  return { hold, unreadableAt: null, expired: isPastLifetime(hold, Date.now()) }
}

const keep = ({ body, idempotencyKey, place, heldAt }: Hold<unknown>): boolean =>
  place !== null && keepHold(place.slot, place.adminId, { idempotencyKey, body }, heldAt ?? undefined)

const release = ({ place }: Hold<unknown>): void => {
  if (place !== null) releaseHold(place.slot)
}

export const useHeldWrite = <TBody extends object, TResult>(
  mutation: UseMutationResult<TResult, Error, TBody & Keyed>,
  unsentMessage: string,
  persist?: HeldWritePersistence<TBody>,
): HeldWrite<TBody, TResult> => {
  const adminId = useSession().principal?.userId ?? null
  const [restored] = useState(() => restore(persist, adminId))
  const [hold, setHold] = useState<Hold<TBody> | null>(restored.hold)
  const current = useRef(hold)
  const [persisted, setPersisted] = useState(() => restored.hold !== null)
  const [unreadableAt, setUnreadableAt] = useState(restored.unreadableAt)
  const [expired, setExpired] = useState(restored.expired)
  const [outcome, setOutcome] = useState<HeldWriteOutcome<TResult>>(() => (restored.hold === null ? IDLE : UNKNOWN))

  const holdOn = (next: Hold<TBody> | null): void => {
    current.current = next
    setHold(next)
  }

  const drop = (sent: Hold<TBody>): void => {
    release(sent)
    holdOn(null)
    setPersisted(false)
  }

  const send = (next: Hold<TBody>, isUnknown: (error: unknown) => boolean): void => {
    holdOn(next)
    setPersisted(keep(next))
    setOutcome(IDLE)
    mutation.mutate(
      { ...next.body, idempotencyKey: next.idempotencyKey },
      {
        onSuccess: (result) => {
          drop(next)
          setOutcome({ kind: "done", result })
        },
        onError: (error) => {
          if (isUnknown(error)) {
            setOutcome(UNKNOWN)
            return
          }
          drop(next)
          setOutcome(
            isApiError(error)
              ? { kind: "rejected", message: error.message, fields: error.fields ?? NO_FIELDS, code: error.code }
              : { kind: "rejected", message: unsentMessage, fields: NO_FIELDS, code: null },
          )
        },
      },
    )
  }

  return {
    outcome,
    pending: mutation.isPending,
    held: hold === null ? null : hold.body,
    persisted,
    unreadable: unreadableAt !== null,
    expired,
    submit: (body) => {
      if (current.current !== null) return
      setUnreadableAt(null)
      setExpired(false)
      send(
        { body, idempotencyKey: mintIdempotencyKey(), place: placeOf(persist, adminId), heldAt: Date.now() },
        isUnknownWriteOutcome,
      )
    },
    checkAgain: () => {
      const held = current.current
      if (held === null) return
      if (isPastLifetime(held, Date.now())) {
        setExpired(true)
        return
      }
      send(held, isUnknownRetryOutcome)
    },
    reset: () => {
      if (current.current !== null) drop(current.current)
      if (unreadableAt !== null) releaseHold(unreadableAt.slot)
      setUnreadableAt(null)
      setExpired(false)
      setOutcome(IDLE)
      mutation.reset()
    },
  }
}
