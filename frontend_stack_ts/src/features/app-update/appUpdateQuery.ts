import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"

import { getAppUpdate } from "~/api/generated/operations"
import { STALE, qk } from "~/api/queryKeys"
import { useApi } from "~/app/providers/ApiProvider"
import { appTarget } from "~/lib/env"
import { canCheckForUpdates, readInstalledApp } from "~/platform/appUpdate"

import type { AppUpdateFeed } from "./updateDecision"

export const useAppUpdateFeed = (): UseQueryResult<AppUpdateFeed> => {
  const api = useApi()
  const variant = appTarget()

  return useQuery({
    queryKey: qk.app.update(variant),
    enabled: canCheckForUpdates(),
    staleTime: STALE.CONFIG,
    retry: false,
    queryFn: async () => {
      const installed = await readInstalledApp()
      const { data } = await api.request(getAppUpdate, {
        query: {
          platform: "android",
          variant,
          applicationId: installed.applicationId,
          versionCode: installed.versionCode,
          version: installed.versionName,
        },
        unauthenticated: true,
      })
      return data
    },
  })
}
