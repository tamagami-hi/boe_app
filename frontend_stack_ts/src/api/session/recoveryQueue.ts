import type { RefreshOutcome } from "~/api/session/refresh"
import type { SessionScope } from "~/api/session/scope"
import { readStored } from "~/api/session/sessionEnd"
import { credentialStorageKey } from "~/api/session/tokenStore"

export type RefreshedElsewhere = (csrfToken: string) => boolean

export type RecoveryStep = (refreshedElsewhere: RefreshedElsewhere) => Promise<RefreshOutcome>

export type RecoveryQueue = (step: RecoveryStep) => Promise<RefreshOutcome>

const notRefreshedElsewhere: RefreshedElsewhere = () => false

const webLocks = (): LockManager | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as Readonly<{ locks?: LockManager }>).locks

const recoveryLockName = (scope: SessionScope): string => `boe.${scope}.session-recovery`

const createInTabQueue = (): RecoveryQueue => {
  let last: Promise<unknown> = Promise.resolve()
  return (step) => {
    const run = last.then(() => step(notRefreshedElsewhere))
    last = run.catch(() => undefined)
    return run
  }
}

const createCrossTabQueue = (scope: SessionScope, locks: LockManager): RecoveryQueue => {
  const csrfKey = credentialStorageKey(scope, "csrfToken")
  return async (step) => {
    const storedBefore = readStored(csrfKey)
    const refreshedElsewhere: RefreshedElsewhere = (csrfToken) =>
      csrfToken !== storedBefore && csrfToken === readStored(csrfKey)
    const outcome = await locks.request(recoveryLockName(scope), () => step(refreshedElsewhere))
    return outcome
  }
}

export const createRecoveryQueue = (
  scope: SessionScope,
  locks: LockManager | undefined = webLocks(),
): RecoveryQueue => (locks === undefined ? createInTabQueue() : createCrossTabQueue(scope, locks))
