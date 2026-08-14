import { describe, expect, test } from "vitest"
import { CACHE_KEYS, createRedisCache, createUncachedCache, type RedisLike } from "./cache.js"

const createFakeRedis = (
  overrides: Partial<RedisLike> = {},
): { client: RedisLike; store: Map<string, string>; calls: string[] } => {
  const store = new Map<string, string>()
  const calls: string[] = []

  const client: RedisLike = {
    isReady: () => true,
    get: async (key) => {
      calls.push(`get ${key}`)
      return store.get(key) ?? null
    },
    set: async (key, value) => {
      calls.push(`set ${key}`)
      store.set(key, value)
      return "OK"
    },
    del: async (...keys) => {
      calls.push(`del ${keys.join(",")}`)
      for (const key of keys) store.delete(key)
      return keys.length
    },
    scan: async (cursor, _match, pattern) => {
      calls.push(`scan ${pattern}`)
      if (cursor !== "0") return ["0", []]
      const prefix = pattern.replace(/\*$/u, "")
      return ["0", [...store.keys()].filter((key) => key.startsWith(prefix))]
    },
    quit: async () => {
      calls.push("quit")
      return "OK"
    },
    ...overrides,
  }

  return { client, store, calls }
}

describe("the uncached fallback", () => {
  test("always loads, so a missing Redis degrades to plain PostgreSQL reads", async () => {
    const cache = createUncachedCache()
    let loads = 0

    const first = await cache.readOrLoad("k", 1_000, async () => {
      loads += 1
      return { value: 1 }
    })
    const second = await cache.readOrLoad("k", 1_000, async () => {
      loads += 1
      return { value: 1 }
    })

    expect(first).toEqual({ value: 1 })
    expect(second).toEqual({ value: 1 })
    expect(loads).toBe(2)
    expect(cache.stats().configured).toBe(false)
  })

  test("invalidation is a no-op rather than an error", async () => {
    const cache = createUncachedCache()
    await expect(cache.invalidate(["a"])).resolves.toBeUndefined()
    await expect(cache.invalidatePrefix("a")).resolves.toBeUndefined()
    await expect(cache.close()).resolves.toBeUndefined()
  })
})

describe("the redis cache", () => {
  test("loads once then serves from the cache", async () => {
    const { client } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })
    let loads = 0
    const load = async () => {
      loads += 1
      return { fund: "abc" }
    }

    expect(await cache.readOrLoad("funds:list", 1_000, load)).toEqual({ fund: "abc" })
    expect(await cache.readOrLoad("funds:list", 1_000, load)).toEqual({ fund: "abc" })

    expect(loads).toBe(1)
    expect(cache.stats()).toMatchObject({ configured: true, hits: 1, misses: 1, errors: 0 })
  })

  test("namespaces keys so two deployments cannot read each other's data", async () => {
    const { client, store } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "boe-prod" })

    await cache.readOrLoad(CACHE_KEYS.appConfig, 1_000, async () => ({ version: 3 }))

    expect([...store.keys()]).toEqual(["boe-prod:app-config"])
  })

  test("collapses a stampede into one load", async () => {
    const { client } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })
    let loads = 0
    let release: (value: { ok: boolean }) => void = () => {}
    const load = () => {
      loads += 1
      return new Promise<{ ok: boolean }>((resolve) => { release = resolve })
    }

    const all = Promise.all([
      cache.readOrLoad("hot", 1_000, load),
      cache.readOrLoad("hot", 1_000, load),
      cache.readOrLoad("hot", 1_000, load),
    ])

    await new Promise((r) => setTimeout(r, 5))
    release({ ok: true })
    const results = await all

    expect(loads).toBe(1)
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }])
  })

  test("a ttl of zero is not written, so a caller can disable caching per key", async () => {
    const { client, store } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })

    await cache.readOrLoad("never", 0, async () => ({ a: 1 }))

    expect(store.size).toBe(0)
  })

  test("a read failure falls through to the loader instead of failing the request", async () => {
    const { client } = createFakeRedis({
      get: async () => { throw new Error("redis down") },
    })
    const errors: string[] = []
    const cache = createRedisCache({
      client,
      namespace: "test",
      onError: (_error, operation) => errors.push(operation),
    })

    const value = await cache.readOrLoad("k", 1_000, async () => ({ served: "from postgres" }))

    expect(value).toEqual({ served: "from postgres" })
    expect(errors).toContain("get")
    expect(cache.stats().errors).toBeGreaterThan(0)
  })

  test("a write failure still returns the loaded value", async () => {
    const { client } = createFakeRedis({
      set: async () => { throw new Error("redis read-only") },
    })
    const cache = createRedisCache({ client, namespace: "test" })

    await expect(cache.readOrLoad("k", 1_000, async () => 42)).resolves.toBe(42)
  })

  test("a loader failure is not cached and propagates to the caller", async () => {
    const { client, store } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })

    await expect(
      cache.readOrLoad("k", 1_000, async () => { throw new Error("db exploded") }),
    ).rejects.toThrow("db exploded")

    expect(store.size).toBe(0)

    await expect(cache.readOrLoad("k", 1_000, async () => "recovered")).resolves.toBe("recovered")
  })

  test("invalidate removes exactly the named keys", async () => {
    const { client, store } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })
    await cache.readOrLoad(CACHE_KEYS.appConfig, 1_000, async () => 1)
    await cache.readOrLoad(CACHE_KEYS.supportFaqs, 1_000, async () => 2)

    await cache.invalidate([CACHE_KEYS.appConfig])

    expect([...store.keys()]).toEqual(["test:support:faqs"])
  })

  test("invalidatePrefix clears a whole family, so publishing one fund drops the list too", async () => {
    const { client, store } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })
    await cache.readOrLoad(CACHE_KEYS.fundList, 1_000, async () => [])
    await cache.readOrLoad(CACHE_KEYS.fundDetail("f1"), 1_000, async () => ({ id: "f1" }))
    await cache.readOrLoad(CACHE_KEYS.appConfig, 1_000, async () => 1)

    await cache.invalidatePrefix("funds:")

    expect([...store.keys()]).toEqual(["test:app-config"])
  })

  test("invalidate with no keys does not issue a del", async () => {
    const { client, calls } = createFakeRedis()
    const cache = createRedisCache({ client, namespace: "test" })

    await cache.invalidate([])

    expect(calls.filter((call) => call.startsWith("del"))).toEqual([])
  })
})

describe("a client that is not connected yet", () => {
  test("is skipped entirely rather than issuing commands that fail", async () => {
    const { client, calls } = createFakeRedis({ isReady: () => false })
    const errors: string[] = []
    const cache = createRedisCache({
      client,
      namespace: "test",
      onError: (_error, operation) => errors.push(operation),
    })

    const value = await cache.readOrLoad("k", 1_000, async () => ({ from: "postgres" }))

    expect(value).toEqual({ from: "postgres" })
    expect(calls).toEqual([])
    expect(errors).toEqual([])
  })

  test("invalidation while disconnected does not raise", async () => {
    const { client, calls } = createFakeRedis({ isReady: () => false })
    const cache = createRedisCache({ client, namespace: "test" })

    await cache.invalidate(["a"])
    await cache.invalidatePrefix("funds:")

    expect(calls).toEqual([])
  })

  test("starts caching once the client becomes ready", async () => {
    let ready = false
    const { client } = createFakeRedis({ isReady: () => ready })
    const cache = createRedisCache({ client, namespace: "test" })
    let loads = 0
    const load = async () => {
      loads += 1
      return { n: loads }
    }

    await cache.readOrLoad("k", 1_000, load)
    expect(loads).toBe(1)

    ready = true
    await cache.readOrLoad("k", 1_000, load)
    expect(loads).toBe(2)
    await cache.readOrLoad("k", 1_000, load)
    expect(loads).toBe(2)
  })
})
