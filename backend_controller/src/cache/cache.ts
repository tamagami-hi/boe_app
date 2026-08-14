export interface CacheStats {
  readonly configured: boolean
  readonly hits: number
  readonly misses: number
  readonly errors: number
}

export interface Cache {
  readOrLoad: <T>(key: string, ttlMs: number, load: () => Promise<T>) => Promise<T>
  invalidate: (keys: readonly string[]) => Promise<void>
  invalidatePrefix: (prefix: string) => Promise<void>
  stats: () => CacheStats
  close: () => Promise<void>
}

export interface RedisLike {
  isReady: () => boolean
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, mode: "PX", ttlMs: number) => Promise<unknown>
  del: (...keys: readonly string[]) => Promise<unknown>
  scan: (
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    size: number,
  ) => Promise<[string, string[]]>
  quit: () => Promise<unknown>
}

export const createUncachedCache = (): Cache => {
  let misses = 0
  return {
    readOrLoad: async (_key, _ttlMs, load) => {
      misses += 1
      return load()
    },
    invalidate: async () => {},
    invalidatePrefix: async () => {},
    stats: () => ({ configured: false, hits: 0, misses, errors: 0 }),
    close: async () => {},
  }
}

export interface RedisCacheOptions {
  readonly client: RedisLike
  readonly namespace: string
  readonly onError?: (error: unknown, operation: string) => void
}

export const createRedisCache = ({ client, namespace, onError }: RedisCacheOptions): Cache => {
  let hits = 0
  let misses = 0
  let errors = 0

  const inFlight = new Map<string, Promise<unknown>>()

  const scoped = (key: string): string => `${namespace}:${key}`

  const report = (error: unknown, operation: string): void => {
    errors += 1
    onError?.(error, operation)
  }

  const readOrLoad = async <T,>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const scopedKey = scoped(key)

    if (!client.isReady()) {
      misses += 1
      return load()
    }

    try {
      const cached = await client.get(scopedKey)
      if (cached !== null) {
        hits += 1
        return JSON.parse(cached) as T
      }
    } catch (error) {
      report(error, "get")
    }

    misses += 1

    const pending = inFlight.get(scopedKey)
    if (pending !== undefined) return pending as Promise<T>

    const attempt = load()
      .then(async (value) => {
        if (ttlMs > 0 && value !== undefined) {
          try {
            await client.set(scopedKey, JSON.stringify(value), "PX", ttlMs)
          } catch (error) {
            report(error, "set")
          }
        }
        return value
      })
      .finally(() => {
        inFlight.delete(scopedKey)
      })

    inFlight.set(scopedKey, attempt)
    return attempt
  }

  const invalidate = async (keys: readonly string[]): Promise<void> => {
    if (keys.length === 0 || !client.isReady()) return
    try {
      await client.del(...keys.map(scoped))
    } catch (error) {
      report(error, "del")
    }
  }

  const invalidatePrefix = async (prefix: string): Promise<void> => {
    if (!client.isReady()) return
    try {
      let cursor = "0"
      do {
        const [next, found] = await client.scan(cursor, "MATCH", `${scoped(prefix)}*`, "COUNT", 200)
        cursor = next
        if (found.length > 0) await client.del(...found)
      } while (cursor !== "0")
    } catch (error) {
      report(error, "scan")
    }
  }

  return {
    readOrLoad,
    invalidate,
    invalidatePrefix,
    stats: () => ({ configured: true, hits, misses, errors }),
    close: async () => {
      try {
        await client.quit()
      } catch (error) {
        report(error, "quit")
      }
    },
  }
}

export const CACHE_KEYS = {
  appConfig: "app-config",
  publicContent: (key: string) => `public-content:${key}`,
  fundList: "funds:list",
  fundDetail: (fundId: string) => `funds:detail:${fundId}`,
  supportFaqs: "support:faqs",
} as const

export const CACHE_PREFIXES = {
  funds: "funds:",
  publicContent: "public-content:",
} as const
