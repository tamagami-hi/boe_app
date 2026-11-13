import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { isUnknownWriteOutcome } from "~/api/errors"
import { listClientReviews, submitClientReview } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ClientReviews = DataOf<typeof listClientReviews>
export type ClientReview = DataOf<typeof submitClientReview>

export type ReviewInput = Readonly<{ rating: number; comment: string | null }>

const REVIEW_PAGE_LIMIT = 25

export const useClientReviews = (): PagedQuery<ClientReviews> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.client.reviews(),
    staleTime: STALE.MONEY,
    limit: REVIEW_PAGE_LIMIT,
    fetchPage: async (after) => api.request(listClientReviews, { query: { limit: REVIEW_PAGE_LIMIT, after } }),
  })
}

export const useSubmitReview = (): UseMutationResult<ClientReview, Error, ReviewInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReviewInput) => (await api.request(submitClientReview, { body: input })).data,
    onSettled: async (_review, error) => {
      if (error !== null && isUnknownWriteOutcome(error)) return
      await queryClient.invalidateQueries({ queryKey: qk.client.reviews() })
    },
  })
}

export type ReviewArrival = Readonly<{ canSubmit: boolean; latest: ClientReviews["items"][number] | null }>

export const useReviewArrivalCheck = (): UseMutationResult<ReviewArrival, Error, void> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const result = await api.request(listClientReviews, { query: { limit: 1 } })
      await queryClient.invalidateQueries({ queryKey: qk.client.reviews() })
      return { canSubmit: result.data.canSubmit, latest: result.data.items[0] ?? null }
    },
  })
}
