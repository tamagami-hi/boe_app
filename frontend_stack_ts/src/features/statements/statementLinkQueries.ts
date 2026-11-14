import { useMutation } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { issueClientStatementLink, openClientStatementLink } from "~/api/generated/operations"
import { operationUrl } from "~/api/http"
import { useApi } from "~/app/providers/ApiProvider"
import { openDestination } from "~/platform/openExternal"
import type { OpenResult } from "~/platform/openExternal"

export type StatementRange = Readonly<{ fromPeriod: string; toPeriod: string }>

export const useOpenStatement = (): UseMutationResult<OpenResult, Error, StatementRange> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (range: StatementRange) => {
      const link = (await api.request(issueClientStatementLink, { body: range })).data
      return openDestination({ kind: "external", url: operationUrl(openClientStatementLink, { token: link.token }) })
    },
  })
}
