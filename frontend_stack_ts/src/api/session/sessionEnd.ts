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

const namesAnotherUser = (stored: string | null, userId: string | null): boolean => {
  if (stored === null || userId === null) return false
  const written = userIdOf(stored)
  return written !== null && written !== userId
}

const endIfAnotherUserStored = (
  scope: SessionScope,
  tokenStore: TokenStore,
  stored: string | null,
): void => {
  if (namesAnotherUser(stored, heldUserId(tokenStore, scope))) endSession(tokenStore, scope, "revoked")
}

export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export type StoredPrincipalWatch = Readonly<{
  anotherUserSince: (userId: string) => boolean
  wrote: (principal: string) => void
}>

export const watchStoredPrincipal = (scope: SessionScope): StoredPrincipalWatch => {
  const principalKey = credentialStorageKey(scope, "principal")
  const expected = { value: readStored(principalKey) }
  return {
    anotherUserSince: (userId) => {
      const stored = readStored(principalKey)
      return stored !== expected.value && namesAnotherUser(stored, userId)
    },
    wrote: (principal) => {
      expected.value = principal
    },
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
