import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { reverseAdminClientLedgerEntry } from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type LedgerReversalInput = Readonly<{
  userId: string
  entryId: string
  reasonCode: string
  note?: string
}>

export const useReverseClientLedgerEntry = (): UseMutationResult<
  DataOf<typeof reverseAdminClientLedgerEntry>,
  Error,
  LedgerReversalInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, entryId, ...body }: LedgerReversalInput) =>
      (
        await api.request(reverseAdminClientLedgerEntry, {
          params: { userId, entryId },
          body,
          idempotencyKey: mintIdempotencyKey(),
        })
      ).data,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", variables.userId] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() })
    },
  })
}
