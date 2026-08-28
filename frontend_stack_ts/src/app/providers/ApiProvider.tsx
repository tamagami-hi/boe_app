import { createContext, useContext } from "react"

import type { HttpClient } from "~/api/http"

const ApiContext = createContext<HttpClient | null>(null)

export const ApiProvider = ApiContext.Provider

export const useApi = (): HttpClient => {
  const client = useContext(ApiContext)
  if (client === null) throw new Error("useApi requires an ApiProvider ancestor")
  return client
}
