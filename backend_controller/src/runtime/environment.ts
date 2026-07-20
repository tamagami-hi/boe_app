import { z } from "zod"

const DEFAULT_PORT = 47502

const RuntimeEnvironmentSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
})

export type RuntimeEnvironment = Readonly<{
  host: string
  logLevel: z.infer<typeof RuntimeEnvironmentSchema>["LOG_LEVEL"]
  nodeEnvironment: z.infer<typeof RuntimeEnvironmentSchema>["NODE_ENV"]
  port: number
}>

export const parseRuntimeEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): RuntimeEnvironment => {
  const parsed = RuntimeEnvironmentSchema.parse(source)

  return Object.freeze({
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    nodeEnvironment: parsed.NODE_ENV,
    port: parsed.PORT,
  })
}
