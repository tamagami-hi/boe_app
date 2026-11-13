import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { startEmailVerification } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { useSession } from "~/app/providers/SessionProvider"

export type StartedEmailVerification = Readonly<{ alreadyVerified: boolean }>

export const useStartEmailVerification = (): UseMutationResult<StartedEmailVerification, Error, void> => {
  const api = useApi()
  const queryClient = useQueryClient()
  const { principal } = useSession()
  return useMutation({
    mutationFn: async () => {
      const issued = (await api.request(startEmailVerification)).data
      return { alreadyVerified: issued.status === "verified" }
    },
    onSuccess: async ({ alreadyVerified }) => {
      if (!alreadyVerified) return
      await queryClient.invalidateQueries({ queryKey: qk.client.emailVerification() })
      if (principal !== null) {
        await queryClient.invalidateQueries({ queryKey: qk.client.eligibility(principal.userId) })
      }
    },
  })
}
