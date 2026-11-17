import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { reverseAdminClientLedgerEntry } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type LedgerReversalBody = Readonly<{
  userId: string
  entryId: string
  reasonCode: string
}>

export type LedgerReversalInput = LedgerReversalBody & Readonly<{ idempotencyKey: string }>

export const useReverseClientLedgerEntry = (): UseMutationResult<
  DataOf<typeof reverseAdminClientLedgerEntry>,
  Error,
  LedgerReversalInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, entryId, idempotencyKey, ...body }: LedgerReversalInput) =>
      (
        await api.request(reverseAdminClientLedgerEntry, {
          params: { userId, entryId },
          body,
          idempotencyKey,
        })
      ).data,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", variables.userId] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() })
    },
  })
}
