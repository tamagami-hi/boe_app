import type { UseMutationResult } from "@tanstack/react-query"
import { useState } from "react"

import { isApiError, isUnknownWriteOutcome, type FieldErrors } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"

export type HeldWriteOutcome<TResult> =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "done"; result: TResult }>
  | Readonly<{ kind: "rejected"; message: string; fields: FieldErrors; code: string | null }>
  | Readonly<{ kind: "unknown" }>

type Keyed = Readonly<{ idempotencyKey: string }>

export type HeldWrite<TBody, TResult> = Readonly<{
  outcome: HeldWriteOutcome<TResult>
  pending: boolean
  submit: (body: TBody) => void
  checkAgain: () => void
  reset: () => void
}>

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }
const NO_FIELDS: FieldErrors = {}

export const useHeldWrite = <TBody extends object, TResult>(
  mutation: UseMutationResult<TResult, Error, TBody & Keyed>,
  unsentMessage: string,
): HeldWrite<TBody, TResult> => {
  const [held, setHeld] = useState<(TBody & Keyed) | null>(null)
  const [outcome, setOutcome] = useState<HeldWriteOutcome<TResult>>(IDLE)

  const send = (attempt: TBody & Keyed): void => {
    setHeld(attempt)
    setOutcome(IDLE)
    mutation.mutate(attempt, {
      onSuccess: (result) => {
        setHeld(null)
        setOutcome({ kind: "done", result })
      },
      onError: (error) => {
        if (isUnknownWriteOutcome(error)) {
          setOutcome({ kind: "unknown" })
          return
        }
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
    submit: (body) => {
      send({ ...body, idempotencyKey: mintIdempotencyKey() })
    },
    checkAgain: () => {
      if (held !== null) send(held)
    },
    reset: () => {
      setHeld(null)
      setOutcome(IDLE)
      mutation.reset()
    },
  }
}
