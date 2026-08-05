import { describe, expect, test } from "vitest"

import type { Notification, Transaction } from "../../db/repositories.js"
import type {
  CreateNotificationInput,
  NotificationWriteRepository,
} from "../../repositories/notificationRepository.js"

import { APP_UPDATE_KIND, reconcileAppVersion } from "./reconcileAppVersion.js"

/**
 * The reconcile step decides what a user finds in their inbox, so these tests
 * pin the four outcomes that matter: told once, not told twice, superseded by a
 * newer build, and retired once installed.
 */

const NOW = new Date("2026-08-05T12:00:00Z")
const tx = {} as Transaction

interface Recorded {
  readonly created: CreateNotificationInput[]
  readonly markedRead: number
}

/** In-memory stand-in that behaves like the unread-dedupe contract in SQL. */
const fakeRepository = (
  unread: readonly Readonly<{ versionCode: number }>[] = [],
): NotificationWriteRepository & { recorded: Recorded } => {
  const created: CreateNotificationInput[] = []
  let pending = [...unread]
  let markedRead = 0
  const repository = {
    create: (_tx: Transaction, input: CreateNotificationInput) => {
      created.push(input)
      pending.push({ versionCode: Number(input.payload?.versionCode) })
      return Promise.resolve({ id: `n${created.length}` } as unknown as Notification)
    },
    findUnreadByPayload: (
      _tx: Transaction,
      input: Readonly<{ kind: string; payloadValue: string }>,
    ) => {
      if (input.kind !== APP_UPDATE_KIND) return Promise.resolve(null)
      const hit = pending.some((row) => String(row.versionCode) === input.payloadValue)
      return Promise.resolve(hit ? ({ id: "existing" } as unknown as Notification) : null)
    },
    markKindRead: () => {
      markedRead += pending.length
      pending = []
      return Promise.resolve(markedRead)
    },
  } as unknown as NotificationWriteRepository & { recorded: Recorded }
  Object.defineProperty(repository, "recorded", {
    get: () => ({ created, markedRead }),
  })
  return repository
}

const deps = (repository: NotificationWriteRepository) => ({
  notificationRepository: repository,
  clock: () => NOW,
})

describe("reconcileAppVersion", () => {
  test("files one notification when the caller is behind", async () => {
    const repository = fakeRepository()

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 705,
      latest: { versionCode: 706, version: "0.7.6" },
    })

    expect(result).toMatchObject({ updateAvailable: true, notified: true })
    expect(repository.recorded.created).toHaveLength(1)
    expect(repository.recorded.created[0]).toMatchObject({
      userId: "user-1",
      kind: APP_UPDATE_KIND,
      title: "App update available",
    })
    // The version code must be a number: the app compares it numerically.
    expect(repository.recorded.created[0]?.payload?.versionCode).toBe(706)
  })

  test("does not file a second notification for the same build", async () => {
    // This runs on every launch, so re-notifying would bury the inbox.
    const repository = fakeRepository([{ versionCode: 706 }])

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 705,
      latest: { versionCode: 706, version: "0.7.6" },
    })

    expect(result).toMatchObject({ updateAvailable: true, notified: false })
    expect(repository.recorded.created).toHaveLength(0)
  })

  test("supersedes an older announcement rather than stacking", async () => {
    // A user who skipped a release should see "update to the newest", not one
    // entry per release they missed.
    const repository = fakeRepository([{ versionCode: 706 }])

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 705,
      latest: { versionCode: 707, version: "0.7.7" },
    })

    expect(result.notified).toBe(true)
    expect(result.retired).toBeGreaterThan(0)
    expect(repository.recorded.created).toHaveLength(1)
    expect(repository.recorded.created[0]?.payload?.versionCode).toBe(707)
  })

  test("retires the notification once the caller reports the newer build", async () => {
    const repository = fakeRepository([{ versionCode: 706 }])

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 706,
      latest: { versionCode: 706, version: "0.7.6" },
    })

    expect(result).toMatchObject({ updateAvailable: false, notified: false })
    expect(result.retired).toBeGreaterThan(0)
    expect(repository.recorded.created).toHaveLength(0)
  })

  test("a caller ahead of the published build is treated as up to date", async () => {
    // Happens on a device sideloaded with a build newer than the feed; it must
    // not be nagged, and any stale entry should clear.
    const repository = fakeRepository([{ versionCode: 706 }])

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 999,
      latest: { versionCode: 706, version: "0.7.6" },
    })

    expect(result.updateAvailable).toBe(false)
    expect(result.retired).toBeGreaterThan(0)
  })

  test("nothing published is not an update and clears stale entries", async () => {
    const repository = fakeRepository([{ versionCode: 706 }])

    const result = await reconcileAppVersion(tx, deps(repository), {
      userId: "user-1",
      versionCode: 705,
      latest: null,
    })

    expect(result).toMatchObject({ updateAvailable: false, notified: false })
    expect(result.retired).toBeGreaterThan(0)
  })
})
