import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { decideAdminApplication } from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export const useDecideApplication = (
  applicationId: string,
): UseMutationResult<void, Error, "approved" | "rejected"> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (outcome: "approved" | "rejected") => {
      await api.request(decideAdminApplication, {
        params: { applicationId },
        query: { outcome },
        body: {},
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "applications"] })
      await queryClient.invalidateQueries({ queryKey: qk.admin.application(applicationId) })
    },
  })
}
