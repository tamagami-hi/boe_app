import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import {
  deriveEmailSendTiming,
  EMAIL_PASS_BUDGET_MS,
  HEARTBEAT_MAX_AGE_MS,
  LOOP_SLEEP_MS,
} from "./sendTiming.js"

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8")

const STACK_COMPOSE_FILES = [
  "release_manager/stacks/dev_release/docker-compose.dev_app.yml",
  "release_manager/stacks/prod_release/docker-compose.prod_app.yml",
] as const

const CONFIGURED_LEASES_MS = [1_000, 5_000, 20_000, 29_999, 30_000, 45_000, 60_000, 80_000, 600_000, 3_600_000, 2_147_483_647]

const worstCaseMs = (timing: ReturnType<typeof deriveEmailSendTiming>): number =>
  timing.smtp.dnsTimeoutMs +
  timing.smtp.connectionTimeoutMs +
  timing.smtp.greetingTimeoutMs +
  timing.smtp.socketTimeoutMs

describe("deriveEmailSendTiming", () => {
  test("splits the default 60 s lease into a 20 s send budget with 10/20/20/50 percent phases", () => {
    expect(deriveEmailSendTiming(60_000)).toEqual({
      leaseMs: 60_000,
      sendBudgetMs: 20_000,
      messageBudgetMs: 25_000,
      smtp: { dnsTimeoutMs: 2_000, connectionTimeoutMs: 4_000, greetingTimeoutMs: 4_000, socketTimeoutMs: 10_000 },
    })
  })

  test.each(CONFIGURED_LEASES_MS)("keeps the worst-case total at least 10 s below the lease for a configured %i ms", (configured) => {
    const timing = deriveEmailSendTiming(configured)

    expect(worstCaseMs(timing)).toBe(timing.sendBudgetMs)
    expect(worstCaseMs(timing) + 10_000).toBeLessThanOrEqual(timing.leaseMs)
    expect(timing.leaseMs).toBeGreaterThanOrEqual(configured)
    for (const timeout of Object.values(timing.smtp)) {
      expect(Number.isInteger(timeout)).toBe(true)
      expect(timeout).toBeGreaterThanOrEqual(1_000)
    }
  })

  test.each(CONFIGURED_LEASES_MS)("lets one message always fit inside a pass for a configured %i ms", (configured) => {
    expect(deriveEmailSendTiming(configured).messageBudgetMs).toBeLessThanOrEqual(EMAIL_PASS_BUDGET_MS)
  })
})

describe("worker heartbeat budget", () => {
  test.each(STACK_COMPOSE_FILES)("matches the %s healthcheck and loop interval", (file) => {
    const compose = repoFile(file)
    const maxAgeSeconds = Number(/check-worker-health\.js email_dispatch (\d+)/u.exec(compose)?.[1])
    const sleepSeconds = Number(/EMAIL_WORKER_INTERVAL_SECONDS:-(\d+)/u.exec(compose)?.[1])

    expect(HEARTBEAT_MAX_AGE_MS).toBe(maxAgeSeconds * 1_000)
    expect(LOOP_SLEEP_MS).toBe(sleepSeconds * 1_000)
    expect(EMAIL_PASS_BUDGET_MS + sleepSeconds * 1_000 + 5_000).toBeLessThan(maxAgeSeconds * 1_000)
  })
})
