import type { SessionScope } from "~/api/session/scope"

export type SeenStorage = Pick<Storage, "getItem" | "setItem">

export type DurableSeenStore = Readonly<{
  readAll: () => Promise<ReadonlyMap<string, string>>
  write: (key: string, entryId: string) => Promise<void>
}>

export type WhatsNewSeen = Readonly<{
  lastSeen: (scope: SessionScope, userId: string) => string | null
  markSeen: (scope: SessionScope, userId: string, entryId: string) => void
}>

const SEEN_DATABASE = "boe.whatsNew"
const SEEN_DATABASE_VERSION = 1
const SEEN_STORE = "seen"
const RELEASE_ID = /^(\d+)\.(\d+)\.(\d+)$/u

const NOTHING_STORED: ReadonlyMap<string, string> = new Map()

const NO_DURABLE_STORE: DurableSeenStore = {
  readAll: () => Promise.resolve(NOTHING_STORED),
  write: () => Promise.resolve(),
}

export const whatsNewSeenKey = (scope: SessionScope, userId: string): string =>
  `boe.${scope}.whatsNew.${userId}`

const releaseParts = (entryId: string): readonly number[] | null => {
  const match = RELEASE_ID.exec(entryId)
  return match === null ? null : match.slice(1).map(Number)
}

const isOlderRelease = (candidate: string, than: string): boolean => {
  const left = releaseParts(candidate)
  const right = releaseParts(than)
  if (left === null || right === null) return false
  const differing = left.findIndex((part, index) => part !== right[index])
  return differing !== -1 && (left[differing] ?? 0) < (right[differing] ?? 0)
}

const newerSeen = (local: string | null, durable: string | null): string | null => {
  if (durable === null) return local
  if (local === null) return durable
  return isOlderRelease(durable, local) ? local : durable
}

const readLocal = (storage: () => SeenStorage, key: string): string | null => {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

const loadDurable = (durable: DurableSeenStore, onLoad: (stored: ReadonlyMap<string, string>) => void): void => {
  try {
    void durable.readAll().then(onLoad, () => {
      onLoad(NOTHING_STORED)
    })
  } catch {
    onLoad(NOTHING_STORED)
  }
}

const writeDurable = (durable: DurableSeenStore, key: string, entryId: string): void => {
  try {
    void durable.write(key, entryId).catch(() => undefined)
  } catch {
    void 0
  }
}

export const createWhatsNewSeen = (
  storage: () => SeenStorage,
  durable: DurableSeenStore = NO_DURABLE_STORE,
): WhatsNewSeen => {
  const thisRun = new Map<string, string>()
  let stored = NOTHING_STORED
  loadDurable(durable, (loaded) => {
    stored = loaded
  })
  return {
    lastSeen: (scope, userId) => {
      const key = whatsNewSeenKey(scope, userId)
      return thisRun.get(key) ?? newerSeen(readLocal(storage, key), stored.get(key) ?? null)
    },
    markSeen: (scope, userId, entryId) => {
      const key = whatsNewSeenKey(scope, userId)
      thisRun.set(key, entryId)
      try {
        storage().setItem(key, entryId)
      } catch {
        void 0
      }
      writeDurable(durable, key, entryId)
    },
  }
}

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result)
    })
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("The What's new store refused the request."))
    })
  })

const committed = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    const refuse = (): void => {
      reject(transaction.error ?? new Error("The What's new store did not save."))
    }
    transaction.addEventListener("complete", () => {
      resolve()
    })
    transaction.addEventListener("error", refuse)
    transaction.addEventListener("abort", refuse)
  })

const closeOnVersionChange = (database: IDBDatabase): IDBDatabase => {
  database.addEventListener("versionchange", () => {
    database.close()
  })
  return database
}

const openSeenDatabase = (factory: () => IDBFactory | null): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const available = factory()
    if (available === null) {
      reject(new Error("IndexedDB is not available."))
      return
    }
    const request = available.open(SEEN_DATABASE, SEEN_DATABASE_VERSION)
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(SEEN_STORE)
    })
    void settled(request).then(resolve, reject)
  }).then(closeOnVersionChange)

const storedPairs = (keys: readonly IDBValidKey[], values: readonly unknown[]): ReadonlyMap<string, string> =>
  new Map(
    keys.flatMap((key, index) => {
      const value = values[index]
      return typeof key === "string" && typeof value === "string" ? [[key, value] as const] : []
    }),
  )

export const indexedDbSeenStore = (factory: () => IDBFactory | null): DurableSeenStore => {
  let opening: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => {
    opening ??= openSeenDatabase(factory)
    return opening
  }
  return {
    readAll: async () => {
      const store = (await database()).transaction(SEEN_STORE, "readonly").objectStore(SEEN_STORE)
      const [keys, values] = await Promise.all([settled(store.getAllKeys()), settled<unknown[]>(store.getAll())])
      return storedPairs(keys, values)
    },
    write: async (key, entryId) => {
      const transaction = (await database()).transaction(SEEN_STORE, "readwrite", { durability: "strict" })
      transaction.objectStore(SEEN_STORE).put(entryId, key)
      await committed(transaction)
    },
  }
}

const browserIndexedDb = (): IDBFactory | null => {
  try {
    return "indexedDB" in globalThis ? globalThis.indexedDB : null
  } catch {
    return null
  }
}

export const browserWhatsNewSeen: WhatsNewSeen = createWhatsNewSeen(
  () => window.localStorage,
  indexedDbSeenStore(browserIndexedDb),
)
