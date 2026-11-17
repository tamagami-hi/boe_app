import { isTemporaryFailure, TransportError } from "~/api/errors"
import { DEFAULT_TIMEOUT_MS } from "~/api/http"
import { holdsUser } from "~/api/session/refresh"
import type { RefreshOutcome } from "~/api/session/refresh"
import type { SessionScope } from "~/api/session/scope"
import { readStored } from "~/api/session/sessionEnd"
import { credentialStorageKey } from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"

export type StoredTokenChanged = () => boolean

export type RecoveryStep = (storedTokenChanged: StoredTokenChanged) => Promise<RefreshOutcome>

export type RecoveryQueue = (step: RecoveryStep) => Promise<RefreshOutcome>

const storedTokenUnchanged: StoredTokenChanged = () => false

const webLocks = (): LockManager | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as Readonly<{ locks?: LockManager }>).locks

const recoveryLockName = (scope: SessionScope): string => `boe.${scope}.session-recovery`

const createInTabQueue = (): RecoveryQueue => {
  let last: Promise<unknown> = Promise.resolve()
  return (step) => {
    const run = last.then(() => step(storedTokenUnchanged))
    last = run.catch(() => undefined)
    return run
  }
}

const lockWaitTimedOut = (): TransportError => new TransportError("timeout", "The request timed out.")

const createCrossTabQueue = (scope: SessionScope, locks: LockManager): RecoveryQueue => {
  const csrfKey = credentialStorageKey(scope, "csrfToken")
  return async (step) => {
    const storedBefore = readStored(csrfKey)
    const wait = new AbortController()
    const timer = setTimeout(() => {
      wait.abort()
    }, DEFAULT_TIMEOUT_MS)
    try {
      const outcome = await locks.request(recoveryLockName(scope), { signal: wait.signal }, () => {
        clearTimeout(timer)
        return step(() => readStored(csrfKey) !== storedBefore)
      })
      return outcome
    } catch (error) {
      if (wait.signal.aborted) throw lockWaitTimedOut()
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

export const createRecoveryQueue = (
  scope: SessionScope,
  locks: LockManager | undefined = webLocks(),
): RecoveryQueue => (locks === undefined ? createInTabQueue() : createCrossTabQueue(scope, locks))

export type SessionRead = Readonly<{ userId: string; principal: string }>

export type AnotherTabsRotation = Readonly<{
  tokenStore: TokenStore
  scope: SessionScope
  csrfToken: string
  readSession: () => Promise<SessionRead>
}>

export const adoptAnotherTabsRotation = async ({
  tokenStore,
  scope,
  csrfToken,
  readSession,
}: AnotherTabsRotation): Promise<RefreshOutcome | null> => {
  const session = await readSession().catch((error: unknown) => {
    if (isTemporaryFailure(error)) throw error
    return null
  })
  if (session === null) return null
  if (!holdsUser(tokenStore, scope, session.userId)) return "replaced"
  tokenStore.update(scope, { csrfToken, principal: session.principal })
  return "rotated"
}
