export const IDLE_LOCK_THRESHOLD_MS = 120_000

export const LOCK_TRIGGERS = ["cold-start", "resume"] as const

export type LockTrigger = (typeof LOCK_TRIGGERS)[number]

export type LockDecisionInput = Readonly<{
  native: boolean
  enrolled: boolean
  trigger: LockTrigger
  leftAt: number | null
  now: number
  idleThresholdMs?: number
}>

export const shouldLock = ({
  native,
  enrolled,
  trigger,
  leftAt,
  now,
  idleThresholdMs = IDLE_LOCK_THRESHOLD_MS,
}: LockDecisionInput): boolean => {
  if (!native) return false
  if (!enrolled) return false
  if (trigger === "cold-start") return true
  if (leftAt === null) return true
  if (!Number.isFinite(leftAt) || !Number.isFinite(now)) return true
  const idleMs = now - leftAt
  if (idleMs < 0) return true
  return idleMs >= idleThresholdMs
}
