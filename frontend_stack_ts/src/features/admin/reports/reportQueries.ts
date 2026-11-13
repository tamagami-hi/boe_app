import { useMemo } from "react"

import type { ResponseMeta } from "~/api/envelope"
import { listAdminClientBalances, listAdminMonthContributions } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { useApi } from "~/app/providers/ApiProvider"

import { collectPages, type ExportPage } from "./collectPages"

export const EXPORT_PAGE_LIMIT = 100

export type ClientBalance = DataOf<typeof listAdminClientBalances>["items"][number]
export type MonthContribution = DataOf<typeof listAdminMonthContributions>["items"][number]

export type ReportExports = Readonly<{
  clientBalances: (asOfDate: string, onProgress: (loaded: number) => void) => Promise<readonly ClientBalance[]>
  monthContributions: (month: string, onProgress: (loaded: number) => void) => Promise<readonly MonthContribution[]>
}>

const exportPageOf = <TItem>(result: Readonly<{ data: { items: readonly TItem[] }; meta: ResponseMeta }>): ExportPage<TItem> => {
  if (result.meta.page === null) throw new Error("The page carried no paging details")
  return { items: result.data.items, nextCursor: result.meta.page.nextCursor, hasMore: result.meta.page.hasMore }
}

export const useReportExports = (): ReportExports => {
  const api = useApi()
  return useMemo(
    () => ({
      clientBalances: (asOfDate, onProgress) =>
        collectPages(
          async (after) =>
            exportPageOf(
              await api.request(listAdminClientBalances, { query: { asOfDate, limit: EXPORT_PAGE_LIMIT, after } }),
            ),
          onProgress,
        ),
      monthContributions: (month, onProgress) =>
        collectPages(
          async (after) =>
            exportPageOf(
              await api.request(listAdminMonthContributions, { query: { month, limit: EXPORT_PAGE_LIMIT, after } }),
            ),
          onProgress,
        ),
    }),
    [api],
  )
}
