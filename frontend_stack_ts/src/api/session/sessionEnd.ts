import { heldUserId, userIdOf } from "~/api/session/refresh"
import { emitSessionInvalidated } from "~/api/session/scope"
import type { SessionInvalidatedDetail, SessionScope } from "~/api/session/scope"
import { credentialStorageKey } from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"

export const endSession = (
  tokenStore: TokenStore,
  scope: SessionScope,
  reason: SessionInvalidatedDetail["reason"],
): void => {
  tokenStore.clear(scope)
  emitSessionInvalidated({ scope, reason })
}

export const endSessionOnOtherTabSignIn = (
  scope: SessionScope,
  tokenStore: TokenStore,
): (() => void) => {
  if (typeof window === "undefined") return () => undefined
  const principalKey = credentialStorageKey(scope, "principal")
  const handler = (event: StorageEvent): void => {
    if (event.key !== principalKey || event.newValue === null) return
    const written = userIdOf(event.newValue)
    const held = heldUserId(tokenStore, scope)
    if (written === null || held === null || written === held) return
    endSession(tokenStore, scope, "revoked")
  }
  window.addEventListener("storage", handler)
  return () => {
    window.removeEventListener("storage", handler)
  }
}
