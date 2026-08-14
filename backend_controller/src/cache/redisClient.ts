import { Redis } from "ioredis"
import type { RedisLike } from "./cache.js"

export interface RedisConnectionConfig {
  readonly url: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly maxRetriesPerRequest: number
}

export interface RedisClientOptions {
  readonly config: RedisConnectionConfig
  readonly onConnectionError: (error: unknown) => void
}

export const createRedisClient = ({ config, onConnectionError }: RedisClientOptions): RedisLike => {
  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
  })

  client.on("error", onConnectionError)
  void client.connect().catch(onConnectionError)

  const isReady = (): boolean => client.status === "ready"

  return Object.assign(client as unknown as RedisLike, { isReady })
}
