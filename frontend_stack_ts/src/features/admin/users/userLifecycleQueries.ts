import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"

import { closeAdminUser, reinstateAdminUser, suspendAdminUser } from "~/api/generated/operations"
import { qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"

export type UserLifecycle = "suspend" | "reinstate" | "close"

export type UserLifecycleInput = Readonly<{
  action: UserLifecycle
  idempotencyKey: string
  reasonCode?: string
  reason?: string
}>

const USER_LIFECYCLE = {
  suspend: suspendAdminUser,
  reinstate: reinstateAdminUser,
  close: closeAdminUser,
} as const

export const useUserLifecycle = (userId: string): UseMutationResult<void, Error, UserLifecycleInput> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, idempotencyKey, reasonCode, reason }: UserLifecycleInput) => {
      await api.request(USER_LIFECYCLE[action], {
        params: { userId },
        body: {
          ...(reasonCode === undefined || reasonCode === "" ? {} : { reasonCode }),
          ...(reason === undefined || reason === "" ? {} : { reason }),
        },
        idempotencyKey,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.admin.user(userId) })
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}
