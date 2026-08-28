import type { SessionScope } from "~/api/session/scope"

export type RefreshOutcome = "rotated" | "unauthenticated"

export type RefreshExecutor = (scope: SessionScope) => Promise<RefreshOutcome>

export type RefreshCoordinator = Readonly<{
  refreshOnce: (scope: SessionScope) => Promise<RefreshOutcome>
  inFlight: (scope: SessionScope) => boolean
}>

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
