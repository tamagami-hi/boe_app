import type { UseMutationResult } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { isApiError, isUnknownRetryOutcome, isUnknownWriteOutcome, type FieldErrors } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { useSession } from "~/app/providers/SessionProvider"

import { keepHold, loadHold, releaseHold } from "./heldWriteStore"

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
  submit: (body: TBody) => void
  checkAgain: () => void
  reset: () => void
}>

export type HeldWritePersistence<TBody> = Readonly<{
  slot: string
  parseBody: (value: unknown) => TBody | null
}>

type HoldPlace = Readonly<{ slot: string; adminId: string }>

type Hold<TBody> = Readonly<{ body: TBody; idempotencyKey: string; place: HoldPlace | null }>

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }
const UNKNOWN: HeldWriteOutcome<never> = { kind: "unknown" }
const NO_FIELDS: FieldErrors = {}

const placeOf = (persist: HeldWritePersistence<unknown> | undefined, adminId: string | null): HoldPlace | null =>
  persist === undefined || adminId === null ? null : { slot: persist.slot, adminId }

const restoreHold = <TBody>(persist: HeldWritePersistence<TBody> | undefined, adminId: string | null): Hold<TBody> | null => {
  const place = placeOf(persist, adminId)
  if (persist === undefined || place === null) return null
  const stored = loadHold(place.slot, place.adminId, persist.parseBody)
  return stored === null ? null : { body: stored.body, idempotencyKey: stored.idempotencyKey, place }
}

const keep = ({ body, idempotencyKey, place }: Hold<unknown>): boolean =>
  place !== null && keepHold(place.slot, place.adminId, { idempotencyKey, body })

const release = ({ place }: Hold<unknown>): void => {
  if (place !== null) releaseHold(place.slot)
}

export const useHeldWrite = <TBody extends object, TResult>(
  mutation: UseMutationResult<TResult, Error, TBody & Keyed>,
  unsentMessage: string,
  persist?: HeldWritePersistence<TBody>,
): HeldWrite<TBody, TResult> => {
  const adminId = useSession().principal?.userId ?? null
  const [hold, setHold] = useState<Hold<TBody> | null>(() => restoreHold(persist, adminId))
  const current = useRef(hold)
  const [persisted, setPersisted] = useState(() => hold !== null)
  const [outcome, setOutcome] = useState<HeldWriteOutcome<TResult>>(() => (hold === null ? IDLE : UNKNOWN))

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
    submit: (body) => {
      if (current.current !== null) return
      send({ body, idempotencyKey: mintIdempotencyKey(), place: placeOf(persist, adminId) }, isUnknownWriteOutcome)
    },
    checkAgain: () => {
      if (current.current !== null) send(current.current, isUnknownRetryOutcome)
    },
    reset: () => {
      if (current.current !== null) drop(current.current)
      setOutcome(IDLE)
      mutation.reset()
    },
  }
}
