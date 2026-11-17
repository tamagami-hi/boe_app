import { isTemporaryFailure } from "~/api/errors"
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

const createCrossTabQueue = (scope: SessionScope, locks: LockManager): RecoveryQueue => {
  const csrfKey = credentialStorageKey(scope, "csrfToken")
  return async (step) => {
    const storedBefore = readStored(csrfKey)
    const outcome = await locks.request(recoveryLockName(scope), () =>
      step(() => readStored(csrfKey) !== storedBefore),
    )
    return outcome
  }
}

export const createRecoveryQueue = (
  scope: SessionScope,
  locks: LockManager | undefined = webLocks(),
): RecoveryQueue => (locks === undefined ? createInTabQueue() : createCrossTabQueue(scope, locks))

export type AnotherTabsRotation = Readonly<{
  tokenStore: TokenStore
  scope: SessionScope
  csrfToken: string
  readSessionUser: () => Promise<string>
}>

export const adoptAnotherTabsRotation = async ({
  tokenStore,
  scope,
  csrfToken,
  readSessionUser,
}: AnotherTabsRotation): Promise<RefreshOutcome | null> => {
  const sessionUser = await readSessionUser().catch((error: unknown) => {
    if (isTemporaryFailure(error)) throw error
    return null
  })
  if (sessionUser === null) return null
  if (!holdsUser(tokenStore, scope, sessionUser)) return "replaced"
  tokenStore.set(scope, "csrfToken", csrfToken)
  return "rotated"
}
