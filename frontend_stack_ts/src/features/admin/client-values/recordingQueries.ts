import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import type { AdminRecordedContributionBody } from "@beonedge/contracts"

import { recordAdminClientContribution } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type RecordedContributionBody = Readonly<{ userId: string }> & AdminRecordedContributionBody

export type RecordedContributionInput = RecordedContributionBody & Readonly<{ idempotencyKey: string }>


export const useRecordClientContribution = (): UseMutationResult<
  DataOf<typeof recordAdminClientContribution>,
  Error,
  RecordedContributionInput
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, idempotencyKey, ...body }: RecordedContributionInput) =>
      (
        await api.request(recordAdminClientContribution, {
          params: { userId },
          body,
          idempotencyKey,
        })
      ).data,
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "investor", variables.userId] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() })
    },
  })
}
