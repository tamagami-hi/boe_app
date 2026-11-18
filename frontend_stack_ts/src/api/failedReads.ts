import type { Query, QueryClient } from "@tanstack/react-query"

const isFailedRead = (query: Query): boolean => query.state.status === "error"

export const refetchFailedReads = (client: QueryClient): Promise<void> =>
  client.refetchQueries({ type: "active", predicate: isFailedRead }, { cancelRefetch: false })
