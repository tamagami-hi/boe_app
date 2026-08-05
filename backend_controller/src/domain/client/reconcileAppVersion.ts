/**
 * Reconcile a client's reported app version against the newest published build.
 *
 * The app reports what it is running on every launch (POST /v1/client/app-version).
 * This turns that report into exactly one durable consequence:
 *
 *   behind      → ensure ONE unread `app_update_available` notification exists
 *   up to date  → mark any such notification read
 *
 * ── WHY THIS IS A NOTIFICATION AND NOT JUST A DIALOG ────────────────────────
 * The launch dialog is easy to dismiss and there is no push channel in this
 * product, so a dismissed dialog is the end of the story. An inbox row survives
 * dismissal and gives the user a way back to the update later.
 *
 * ── WHY IT SELF-HEALS INSTEAD OF BEING SWEPT ────────────────────────────────
 * The row is retired by the same report that created it — the first launch after
 * the user actually updates marks it read. There is no cron, nothing to run on a
 * schedule, and no way for the inbox to disagree with the installed build for
 * longer than one launch. Equally there is no fan-out: a user who never opens
 * the app gets no row, which is correct, because without push they could never
 * have been shown it anyway.
 */
import type { Transaction } from "../../db/repositories.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"

/** Payload key the notification is de-duplicated on. */
const VERSION_CODE_KEY = "versionCode"
export const APP_UPDATE_KIND = "app_update_available"

export interface ReconcileAppVersionInput {
  readonly userId: string
  /** Version code of the build the caller is running. */
  readonly versionCode: number
  /** Newest published build for the caller's applicationId, if any. */
  readonly latest: {
    readonly versionCode: number
    readonly version: string
  } | null
}

export interface ReconcileAppVersionDeps {
  readonly notificationRepository: NotificationWriteRepository
  readonly clock: () => Date
}

export type ReconcileAppVersionResult = Readonly<{
  /** True when the caller is behind the newest published build. */
  updateAvailable: boolean
  /** True when this call inserted a notification. */
  notified: boolean
  /** How many stale update notifications this call retired. */
  retired: number
}>

export const reconcileAppVersion = async (
  tx: Transaction,
  deps: ReconcileAppVersionDeps,
  input: ReconcileAppVersionInput,
): Promise<ReconcileAppVersionResult> => {
  const latest = input.latest
  const behind = latest !== null && latest.versionCode > input.versionCode

  if (!behind) {
    // Up to date (or nothing published): retire anything left over from before.
    // This is the only place the prompt is cleared, and it runs on every launch,
    // so an inbox entry cannot outlive the update it was asking for.
    const retired = await deps.notificationRepository.markKindRead(tx, {
      userId: input.userId,
      kind: APP_UPDATE_KIND,
      now: deps.clock(),
    })
    return { updateAvailable: false, notified: false, retired }
  }

  const existing = await deps.notificationRepository.findUnreadByPayload(tx, {
    userId: input.userId,
    kind: APP_UPDATE_KIND,
    payloadKey: VERSION_CODE_KEY,
    payloadValue: String(latest.versionCode),
  })
  if (existing !== null) {
    // Already told about this exact build and not yet read: say nothing more.
    return { updateAvailable: true, notified: false, retired: 0 }
  }

  /*
   * A newer build than the one previously announced supersedes it. Retiring the
   * old row first keeps at most one update prompt in the inbox, so a user who
   * skips three releases sees "update to the newest", not three stale entries.
   */
  const retired = await deps.notificationRepository.markKindRead(tx, {
    userId: input.userId,
    kind: APP_UPDATE_KIND,
    now: deps.clock(),
  })

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: APP_UPDATE_KIND,
    title: "App update available",
    body: `Version ${latest.version} is ready to install. Open the app to update.`,
    payload: {
      // Number, not string: the app compares it against its own version code.
      versionCode: latest.versionCode,
      version: latest.version,
    },
  })

  return { updateAvailable: true, notified: true, retired }
}
