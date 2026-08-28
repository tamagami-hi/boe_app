import { createContext, useContext } from "react"

import type { Principal } from "~/app/providers/SessionProvider"

export type LoginInput = Readonly<{
  email: string
  password: string
}>

export type AuthPort = Readonly<{
  login: (input: LoginInput) => Promise<Principal>
  logout: () => Promise<void>
  probeReachability: () => Promise<boolean>
  loginPath: string
  homePath: string
  supportPath: string | null
  audienceLabel: string
}>

const AuthPortContext = createContext<AuthPort | null>(null)

export const AuthPortProvider = AuthPortContext.Provider

export const useAuthPort = (): AuthPort => {
  const port = useContext(AuthPortContext)
  if (port === null) throw new Error("useAuthPort requires an AuthPortProvider ancestor")
  return port
}
