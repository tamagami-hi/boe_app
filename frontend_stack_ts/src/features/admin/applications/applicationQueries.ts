import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { decideAdminApplication } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type ApplicationDecision = Readonly<{ outcome: "approved" | "rejected" }>

export const useDecideApplication = (
  applicationId: string,
): UseMutationResult<void, Error, ApplicationDecision & Readonly<{ idempotencyKey: string }>> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ outcome, idempotencyKey }: ApplicationDecision & Readonly<{ idempotencyKey: string }>) => {
      await api.request(decideAdminApplication, {
        params: { applicationId },
        query: { outcome },
        body: {},
        idempotencyKey,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "applications"] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.application(applicationId) })
    },
  })
}
