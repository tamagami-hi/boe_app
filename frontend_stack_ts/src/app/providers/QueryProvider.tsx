import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import type { ReactNode } from "react"

import { isRetryable } from "~/api/errors"

const MAX_QUERY_RETRIES = 2

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => failureCount < MAX_QUERY_RETRIES && isRetryable(error),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

export const QueryProvider = ({
  children,
  client,
}: Readonly<{ children: ReactNode; client?: QueryClient }>): React.ReactElement => {
  const [fallback] = useState(createQueryClient)
  return <QueryClientProvider client={client ?? fallback}>{children}</QueryClientProvider>
}
