import type { SessionScope } from "~/api/session/scope"
import type { TokenStore } from "~/api/session/tokenStore"

export type RefreshOutcome = "rotated" | "unauthenticated" | "replaced"

export type RefreshExecutor = (scope: SessionScope) => Promise<RefreshOutcome>

export type RefreshCoordinator = Readonly<{
  refreshOnce: (scope: SessionScope) => Promise<RefreshOutcome>
  inFlight: (scope: SessionScope) => boolean
}>

export const userIdOf = (principal: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(principal)
    if (typeof parsed !== "object" || parsed === null) return null
    const { userId } = parsed as Readonly<Record<string, unknown>>
    return typeof userId === "string" ? userId : null
  } catch {
    return null
  }
}

export const heldUserId = (tokenStore: TokenStore, scope: SessionScope): string | null => {
  const held = tokenStore.read(scope, "principal")
  return held === null ? null : userIdOf(held)
}

export const holdsUser = (tokenStore: TokenStore, scope: SessionScope, userId: string): boolean =>
  heldUserId(tokenStore, scope) === userId

export const createRefreshCoordinator = (execute: RefreshExecutor): RefreshCoordinator => {
  const pending = new Map<SessionScope, Promise<RefreshOutcome>>()

  return {
    refreshOnce: (scope) => {
      const existing = pending.get(scope)
      if (existing !== undefined) return existing

      const attempt = execute(scope).finally(() => {
        pending.delete(scope)
      })
      pending.set(scope, attempt)
      return attempt
    },

    inFlight: (scope) => pending.has(scope),
  }
}
