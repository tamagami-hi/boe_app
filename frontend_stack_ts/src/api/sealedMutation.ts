import { useMutation } from "@tanstack/react-query"
import type { MutateOptions, UseMutationOptions, UseMutationResult } from "@tanstack/react-query"
import { useCallback } from "react"

const SPENT_MESSAGE = "These details were already sent once. Enter them again to retry."

export type Sealed<TValue> = Readonly<{ open: () => TValue }>

export const seal = <TValue>(value: TValue): Sealed<TValue> => {
  let held: Readonly<{ value: TValue }> | null = { value }
  return {
    open: () => {
      if (held === null) throw new Error(SPENT_MESSAGE)
      const opened = held.value
      held = null
      return opened
    },
  }
}

type WithoutMutate<TResult> = TResult extends unknown ? Omit<TResult, "mutate" | "mutateAsync"> : never

export type SealedCallbacks<TData, TInput> = MutateOptions<TData, Error, Sealed<TInput>>

type SealedMutate<TData, TInput> = (input: TInput, callbacks?: SealedCallbacks<TData, TInput>) => void

type SealedMutateAsync<TData, TInput> = (input: TInput, callbacks?: SealedCallbacks<TData, TInput>) => Promise<TData>

export type SealedMutationResult<TData, TInput> = WithoutMutate<UseMutationResult<TData, Error, Sealed<TInput>>> &
  Readonly<{
    mutate: SealedMutate<TData, TInput>
    mutateAsync: SealedMutateAsync<TData, TInput>
  }>

export type SealedMutationOptions<TData, TInput> = Omit<
  UseMutationOptions<TData, Error, Sealed<TInput>>,
  "mutationFn" | "retry" | "retryDelay"
> &
  Readonly<{ mutationFn: (input: TInput) => Promise<TData> }>

export const useSealedMutation = <TData, TInput>({
  mutationFn,
  ...options
}: SealedMutationOptions<TData, TInput>): SealedMutationResult<TData, TInput> => {
  const mutation = useMutation({
    ...options,
    retry: false,
    mutationFn: async (sealed: Sealed<TInput>) => mutationFn(sealed.open()),
  })
  const { mutate, mutateAsync } = mutation
  const mutateSealed = useCallback<SealedMutate<TData, TInput>>(
    (input, callbacks) => {
      mutate(seal(input), callbacks)
    },
    [mutate],
  )
  const mutateAsyncSealed = useCallback<SealedMutateAsync<TData, TInput>>(
    async (input, callbacks) => mutateAsync(seal(input), callbacks),
    [mutateAsync],
  )
  return { ...mutation, mutate: mutateSealed, mutateAsync: mutateAsyncSealed }
}
