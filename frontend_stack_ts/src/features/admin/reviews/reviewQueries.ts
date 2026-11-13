import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"

import {
  getAdminClientReview,
  listAdminClientReviews,
  listAdminUserClientReviews,
  moderateAdminClientReview,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import type { ReviewState } from "~/domain/reviews"

export type ReviewInbox = DataOf<typeof listAdminClientReviews>
export type ReviewSummary = ReviewInbox["items"][number]
export type ReviewDetail = DataOf<typeof getAdminClientReview>

export type ReviewFilter = Readonly<{ state: ReviewState | null; rating: number | null }>

export type ModerationInput = Readonly<{
  state: ReviewState
  moderationNote: string | null
  expectedVersion: number
  idempotencyKey: string
}>

const PAGE_LIMIT = 25

export const useReviewInbox = (filter: ReviewFilter): PagedQuery<ReviewInbox> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.reviews(`${filter.state ?? "any"}:${String(filter.rating ?? "any")}`),
    staleTime: STALE.MONEY,
    limit: PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminClientReviews, {
        query: {
          limit: PAGE_LIMIT,
          after,
          ...(filter.state === null ? {} : { state: filter.state }),
          ...(filter.rating === null ? {} : { rating: filter.rating }),
        },
      }),
  })
}

export const useUserReviews = (userId: string): PagedQuery<DataOf<typeof listAdminUserClientReviews>> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.userReviews(userId),
    enabled: userId !== "",
    staleTime: STALE.MONEY,
    limit: PAGE_LIMIT,
    fetchPage: async (after) =>
      api.request(listAdminUserClientReviews, { params: { userId }, query: { limit: PAGE_LIMIT, after } }),
  })
}

export const useReview = (reviewId: string): UseQueryResult<ReviewDetail> => {
  const api = useApi()
  return useQuery({
    queryKey: qk.admin.review(reviewId),
    enabled: reviewId !== "",
    staleTime: STALE.MONEY,
    queryFn: async () => (await api.request(getAdminClientReview, { params: { reviewId } })).data,
  })
}

export const useModerateReview = (reviewId: string): UseMutationResult<ReviewDetail, Error, ModerationInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ idempotencyKey, ...body }: ModerationInput) =>
      (await api.request(moderateAdminClientReview, { params: { reviewId }, body, idempotencyKey })).data,
    onSuccess: async (review) => {
      queryClient.setQueryData(qk.admin.review(reviewId), review)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.reviewsRoot() }),
        queryClient.invalidateQueries({ queryKey: qk.admin.userReviews(review.userId) }),
      ])
    },
  })
}
