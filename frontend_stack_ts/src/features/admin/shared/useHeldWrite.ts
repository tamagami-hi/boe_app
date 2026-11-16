import type { UseMutationResult } from "@tanstack/react-query"
import { useState } from "react"

import { isApiError, isUnknownWriteOutcome, type FieldErrors } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"

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
  submit: (body: TBody) => void
  checkAgain: () => void
  reset: () => void
}>

export type HeldWritePersistence<TBody> = Readonly<{
  slot: string
  parseBody: (value: unknown) => TBody | null
}>

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }
const UNKNOWN: HeldWriteOutcome<never> = { kind: "unknown" }
const NO_FIELDS: FieldErrors = {}

const restoreHold = <TBody extends object>(persist: HeldWritePersistence<TBody> | undefined): (TBody & Keyed) | null => {
  if (persist === undefined) return null
  const hold = loadHold(persist.slot, persist.parseBody)
  return hold === null ? null : { ...hold.body, idempotencyKey: hold.idempotencyKey }
}

const persistence = <TBody extends object>(persist: HeldWritePersistence<TBody> | undefined) => ({
  keep: (attempt: TBody & Keyed): void => {
    if (persist === undefined) return
    const { idempotencyKey, ...body } = attempt
    keepHold(persist.slot, { idempotencyKey, body })
  },
  release: (): void => {
    if (persist !== undefined) releaseHold(persist.slot)
  },
})

export const useHeldWrite = <TBody extends object, TResult>(
  mutation: UseMutationResult<TResult, Error, TBody & Keyed>,
  unsentMessage: string,
  persist?: HeldWritePersistence<TBody>,
): HeldWrite<TBody, TResult> => {
  const [held, setHeld] = useState<(TBody & Keyed) | null>(() => restoreHold(persist))
  const [outcome, setOutcome] = useState<HeldWriteOutcome<TResult>>(() => (held === null ? IDLE : UNKNOWN))
  const { keep, release } = persistence(persist)

  const send = (attempt: TBody & Keyed): void => {
    setHeld(attempt)
    keep(attempt)
    setOutcome(IDLE)
    mutation.mutate(attempt, {
      onSuccess: (result) => {
        release()
        setHeld(null)
        setOutcome({ kind: "done", result })
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown" })
          return
        }
        release()
        setHeld(null)
        setOutcome(
          isApiError(error)
            ? { kind: "rejected", message: error.message, fields: error.fields ?? NO_FIELDS, code: error.code }
            : { kind: "rejected", message: unsentMessage, fields: NO_FIELDS, code: null },
        )
      },
    })
  }

  return {
    outcome,
    pending: mutation.isPending,
    held,
    submit: (body) => {
      send({ ...body, idempotencyKey: mintIdempotencyKey() })
    },
    checkAgain: () => {
      if (held !== null) send(held)
    },
    reset: () => {
      release()
      setHeld(null)
      setOutcome(IDLE)
      mutation.reset()
    },
  }
}
