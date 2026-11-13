import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { listAdminRecordingSheet, recordAdminClientContribution } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { SIP_MONTH_PATTERN } from "~/features/admin/client-values/sipScheduleMonths"

import type { HeldRecording } from "./heldRecordings"

export type RecordingSheetData = DataOf<typeof listAdminRecordingSheet>
export type RecordingSheetRow = RecordingSheetData["items"][number]
export type RecordedContribution = DataOf<typeof recordAdminClientContribution>

export type SendRecording = (held: HeldRecording) => Promise<RecordedContribution>
export type RefreshAfterRecording = (userIds: readonly string[]) => Promise<void>

const SHEET_PAGE_LIMIT = 100

export const useRecordingSheet = (month: string, fundId: string): PagedQuery<RecordingSheetData> => {
  const api = useApi()
  return usePagedQuery({
    queryKey: qk.admin.recordingSheet(month, fundId),
    enabled: SIP_MONTH_PATTERN.test(month),
    staleTime: STALE.MONEY,
    limit: SHEET_PAGE_LIMIT,
    loadAll: true,
    fetchPage: async (after) =>
      api.request(listAdminRecordingSheet, {
        query: { month, limit: SHEET_PAGE_LIMIT, after, ...(fundId === "" ? {} : { fundId }) },
      }),
  })
}

export const useSendRecording = (): SendRecording => {
  const api = useApi()
  return useCallback(
    async (held) =>
      (
        await api.request(recordAdminClientContribution, {
          params: { userId: held.userId },
          body: held.body,
          idempotencyKey: held.idempotencyKey,
        })
      ).data,
    [api],
  )
}

export const useRefreshAfterRecording = (): RefreshAfterRecording => {
  const queryClient = useQueryClient()
  return useCallback(
    async (userIds) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.recordingSheetRoot() }),
        queryClient.invalidateQueries({ queryKey: qk.admin.clientValueSummaryRoot() }),
        ...userIds.map((userId) => queryClient.invalidateQueries({ queryKey: ["admin", "investor", userId] })),
      ])
    },
    [queryClient],
  )
}
