import { heldUserId, userIdOf } from "~/api/session/refresh"
import { emitSessionInvalidated } from "~/api/session/scope"
import type { SessionInvalidatedDetail, SessionScope } from "~/api/session/scope"
import { credentialStorageKey } from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"
import { isNative } from "~/platform/capacitor"

export const endSession = (
  tokenStore: TokenStore,
  scope: SessionScope,
  reason: SessionInvalidatedDetail["reason"],
): void => {
  tokenStore.clear(scope)
  emitSessionInvalidated({ scope, reason })
}

const endIfAnotherUserStored = (
  scope: SessionScope,
  tokenStore: TokenStore,
  stored: string | null,
): void => {
  if (stored === null) return
  const written = userIdOf(stored)
  const held = heldUserId(tokenStore, scope)
  if (written === null || held === null || written === held) return
  endSession(tokenStore, scope, "revoked")
}

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const endSessionOnOtherTabSignIn = (
  scope: SessionScope,
  tokenStore: TokenStore,
): (() => void) => {
  if (typeof window === "undefined" || isNative()) return () => undefined
  const principalKey = credentialStorageKey(scope, "principal")
  const handler = (event: StorageEvent): void => {
    if (event.key === principalKey) endIfAnotherUserStored(scope, tokenStore, event.newValue)
  }
  window.addEventListener("storage", handler)
  endIfAnotherUserStored(scope, tokenStore, readStored(principalKey))
  return () => {
    window.removeEventListener("storage", handler)
  }
}
