import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { isOutage } from "~/api/errors"
import { subscribeToSessionInvalidated } from "~/api/session/scope"
import type { SessionScope } from "~/api/session/scope"
import type { TokenStore } from "~/api/session/tokenStore"
import type { PermissionCode, RoleCode } from "~/domain/permissions"
import { hasAll, hasAny, hasRole } from "~/domain/permissions"

export type SessionStatus = "restoring" | "authenticated" | "anonymous"

export type Principal = Readonly<{
  userId: string
  fullName: string
  email: string
  roles: readonly RoleCode[]
  permissions: readonly PermissionCode[]
  accountState: "active" | "suspended" | "closed" | "invited"
}>

export type SessionState = Readonly<{
  status: SessionStatus
  principal: Principal | null
  error: unknown
  endedReason: "expired" | "revoked" | null
}>

export type SessionActions = Readonly<{
  scope: SessionScope
  signedIn: (principal: Principal) => void
  signedOut: () => void
  failedRestore: (error: unknown) => void
  retryRestore: () => void
  hasRole: (role: RoleCode) => boolean
  hasAnyPermission: (required: readonly PermissionCode[]) => boolean
  hasAllPermissions: (required: readonly PermissionCode[]) => boolean
}>

export type SessionRestorer = () => Promise<Principal | null>

const SessionContext = createContext<(SessionState & SessionActions) | null>(null)

export type SessionProviderProps = Readonly<{
  scope: SessionScope
  tokenStore: TokenStore
  restore: SessionRestorer
  children: ReactNode
}>

export const SessionProvider = ({
  scope,
  tokenStore,
  restore,
  children,
}: SessionProviderProps): React.ReactElement => {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SessionState>({
    status: "restoring",
    principal: null,
    error: null,
    endedReason: null,
  })
  const [restoreNonce, setRestoreNonce] = useState(0)
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    if (state.principal === null) return
    const currentId = state.principal.userId
    const previousId = lastUserId.current
    if (previousId !== null && previousId !== currentId) queryClient.clear()
    lastUserId.current = currentId
  }, [state.principal, queryClient])

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      setState((current) => ({ ...current, status: "restoring", error: null }))
      try {
        await tokenStore.hydrate()
      } catch (error) {
        if (cancelled) return
        setState({ status: "anonymous", principal: null, error, endedReason: null })
        return
      }

      try {
        const principal = await restore()
        if (cancelled) return
        setState(
          principal === null
            ? { status: "anonymous", principal: null, error: null, endedReason: null }
            : { status: "authenticated", principal, error: null, endedReason: null },
        )
      } catch (error) {
        if (cancelled) return
        setState({
          status: isOutage(error) ? "restoring" : "anonymous",
          principal: null,
          error,
          endedReason: null,
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [tokenStore, restore, restoreNonce])

  useEffect(
    () =>
      subscribeToSessionInvalidated((detail) => {
        if (detail.scope !== scope) return
        queryClient.clear()
        setState({
          status: "anonymous",
          principal: null,
          error: null,
          endedReason: detail.reason,
        })
      }),
    [scope, queryClient],
  )

  const signedIn = useCallback((principal: Principal): void => {
    setState({ status: "authenticated", principal, error: null, endedReason: null })
  }, [])

  const signedOut = useCallback((): void => {
    tokenStore.clear(scope)
    queryClient.clear()
    lastUserId.current = null
    setState({ status: "anonymous", principal: null, error: null, endedReason: null })
  }, [tokenStore, scope, queryClient])

  const failedRestore = useCallback((error: unknown): void => {
    setState({ status: "anonymous", principal: null, error, endedReason: null })
  }, [])

  const retryRestore = useCallback((): void => {
    setRestoreNonce((current) => current + 1)
  }, [])

  const value = useMemo<SessionState & SessionActions>(
    () => ({
      ...state,
      scope,
      signedIn,
      signedOut,
      failedRestore,
      retryRestore,
      hasRole: (role) => hasRole(state.principal?.roles ?? [], role),
      hasAnyPermission: (required) => hasAny(state.principal?.permissions ?? [], required),
      hasAllPermissions: (required) => hasAll(state.principal?.permissions ?? [], required),
    }),
    [state, scope, signedIn, signedOut, failedRestore, retryRestore],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = (): SessionState & SessionActions => {
  const value = useContext(SessionContext)
  if (value === null) throw new Error("useSession requires a SessionProvider ancestor")
  return value
}
