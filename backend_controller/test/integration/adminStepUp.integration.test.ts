import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"

import { createUncachedCache } from "../../src/cache/cache.js"
import { createAdminContentRepository } from "../../src/repositories/adminContentRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminContentRoutes } from "../../src/routes/adminContentRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInAs, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PASSWORD, PasswordMailStack } from "./passwordMailSupport.js"
import {
  confirmedAs,
  confirmedHeaders,
  registerStepUp,
  requestConfirmation,
  stepUpFor,
  type PublishTarget,
} from "./stepUpSupport.js"

const ROUTE = "/v1/admin/app-config"
const CONFIRMATION_LIFETIME_MS = 5 * 60_000
const FAILURES_PER_WINDOW = 5
const WRONG_PASSWORD = "a password this admin never had"

interface Envelope {
  readonly data: { readonly version: number | null; readonly config: unknown } | null
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } | null
  readonly meta: { readonly idempotencyReplay?: boolean }
}

let stack: PasswordMailStack
let app: FastifyInstance

const envelope = (r: { json: () => unknown }): Envelope => r.json() as Envelope
const errorOf = (r: { json: () => unknown }): string => envelope(r).error?.code ?? "none"
const outcomeOf = (r: { statusCode: number; json: () => unknown }): [number, string] => [r.statusCode, errorOf(r)]
const newKey = (): string => `publish-${randomBytes(8).toString("hex")}`
const versionRows = () => stack.count("app_config_versions")
const publishAudits = () => stack.count("audit_events", "command = 'app_config.published'")
const superadmin = (): Promise<AdminSession> => signInRoleAdmin(app, stack, "superadmin")

const publish = (headers: Record<string, string>, payload: PublishTarget) =>
  app.inject({ method: "PATCH", url: ROUTE, headers, payload })

const live = async (session: AdminSession): Promise<Envelope["data"]> =>
  envelope(await app.inject({ method: "GET", url: ROUTE, headers: adminHeaders(session) })).data

const unconsumed = (userId: string) =>
  stack.count("admin_step_up_confirmations", "user_id = $1 and consumed_at is null", [userId])

const attempts = async (session: AdminSession, password: string, count: number): Promise<[number, string][]> => {
  const outcomes: [number, string][] = []
  for (let attempt = 0; attempt < count; attempt += 1) {
    outcomes.push(outcomeOf(await requestConfirmation(app, session, { config: { presentation: { attempt } } }, password)))
  }
  return outcomes
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerStepUp(instance, stack, webAuth)
      registerAdminContentRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        contentRepository: createAdminContentRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        cache: createUncachedCache(),
        stepUp: stepUpFor(stack),
      })
    },
  })
}, 220_000)

afterEach(() => {
  stack.clockOffsetMs = 0
})

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("publishing app config without a password confirmation", () => {
  test("an admin app released before this change sends none and is refused with a plain message, writing nothing", async () => {
    const editor = await superadmin()
    const before = [await versionRows(), await publishAudits()]

    const response = await publish(adminHeaders(editor, newKey()), { config: { featureFlags: { released: true } } })

    expect(response.statusCode).toBe(403)
    expect(envelope(response).error).toEqual({
      code: "AUTHORIZATION_DENIED",
      message: "Update the admin app to publish app config.",
      retryable: false,
    })
    expect([await versionRows(), await publishAudits()]).toEqual(before)
  })
})

describe("publishing app config with a password confirmation", () => {
  test("publishes once, ties the publish to the confirmation, and a replay of the same request returns the stored result", async () => {
    const editor = await superadmin()
    const payload = { config: { featureFlags: { confirmed: true } } }
    const confirmation = await confirmedAs(app, editor, payload)
    const key = newKey()

    const first = await publish(confirmedHeaders(editor, confirmation, key), payload)
    const rowsAfterFirst = await versionRows()
    const replay = await publish(confirmedHeaders(editor, confirmation, key), payload)

    expect([first.statusCode, replay.statusCode]).toEqual([200, 200])
    expect(envelope(replay).data).toEqual(envelope(first).data)
    expect(envelope(replay).meta.idempotencyReplay).toBe(true)
    expect(await versionRows()).toBe(rowsAfterFirst)
    const issued = await stack.first("select id, consumed_at from admin_step_up_confirmations where user_id = $1", [editor.userId])
    const published = await stack.first(
      "select metadata from audit_events where command = 'app_config.published' and actor_user_id = $1",
      [editor.userId],
    )
    const confirmed = await stack.count("audit_events", "command = 'auth.step_up_confirmed' and entity_id = $1", [issued.id])
    expect(issued.consumed_at).not.toBeNull()
    expect((published.metadata as { stepUpId?: string }).stepUpId).toBe(issued.id)
    expect(confirmed).toBe(1)
  })

  test("a used confirmation cannot publish the same changes again under a new request", async () => {
    const editor = await superadmin()
    const payload = { config: { presentation: { round: 1 } } }
    const confirmation = await confirmedAs(app, editor, payload)
    const first = await publish(confirmedHeaders(editor, confirmation, newKey()), payload)
    const rows = await versionRows()

    const again = await publish(confirmedHeaders(editor, confirmation, newKey()), payload)

    expect(first.statusCode).toBe(200)
    expect(outcomeOf(again)).toEqual([409, "TOKEN_ALREADY_USED"])
    expect(await versionRows()).toBe(rows)
  })

  test("a confirmation is honoured just inside five minutes and refused just after, writing nothing", async () => {
    const editor = await superadmin()
    const inside = { config: { presentation: { inside: true } } }
    const outside = { config: { presentation: { outside: true } } }
    const early = await confirmedAs(app, editor, inside)
    const late = await confirmedAs(app, editor, outside)

    stack.clockOffsetMs = CONFIRMATION_LIFETIME_MS - 5_000
    const accepted = await publish(confirmedHeaders(editor, early, newKey()), inside)
    const rows = await versionRows()
    stack.clockOffsetMs = CONFIRMATION_LIFETIME_MS + 1_000
    const refused = await publish(confirmedHeaders(editor, late, newKey()), outside)

    expect(accepted.statusCode).toBe(200)
    expect(outcomeOf(refused)).toEqual([410, "TOKEN_EXPIRED"])
    expect(await versionRows()).toBe(rows)
  })

  test("a confirmation belongs to the session that asked for it, not another admin or another session of the same admin", async () => {
    const owner = await superadmin()
    const otherAdmin = await superadmin()
    const ownersOtherSession = await signInAs(app, owner.userId, owner.email)
    const payload = { config: { presentation: { by: "owner" } } }
    const confirmation = await confirmedAs(app, owner, payload)
    const rows = await versionRows()

    const byOtherAdmin = await publish(confirmedHeaders(otherAdmin, confirmation, newKey()), payload)
    const byOtherSession = await publish(confirmedHeaders(ownersOtherSession, confirmation, newKey()), payload)
    const byOwner = await publish(confirmedHeaders(owner, confirmation, newKey()), payload)

    expect(outcomeOf(byOtherAdmin)).toEqual([400, "TOKEN_INVALID"])
    expect(outcomeOf(byOtherSession)).toEqual([400, "TOKEN_INVALID"])
    expect(byOwner.statusCode).toBe(200)
    expect(await versionRows()).toBe(rows + 1)
  })

  test("a confirmation publishes only the changes it was given for, and a different body uses nothing up", async () => {
    const editor = await superadmin()
    const version = (await live(editor))?.version ?? null
    const reviewed = { config: { presentation: { reviewed: true } }, expectedVersion: version }
    const confirmation = await confirmedAs(app, editor, reviewed)
    const rows = await versionRows()

    const otherConfig = await publish(confirmedHeaders(editor, confirmation, newKey()), {
      config: { presentation: { reviewed: false } },
      expectedVersion: version,
    })
    const withoutVersion = await publish(confirmedHeaders(editor, confirmation, newKey()), { config: reviewed.config })
    const unusedAfterRefusals = await unconsumed(editor.userId)
    const asReviewed = await publish(confirmedHeaders(editor, confirmation, newKey()), reviewed)

    expect(outcomeOf(otherConfig)).toEqual([400, "TOKEN_INVALID"])
    expect(outcomeOf(withoutVersion)).toEqual([400, "TOKEN_INVALID"])
    expect(unusedAfterRefusals).toBe(1)
    expect(asReviewed.statusCode).toBe(200)
    expect(await versionRows()).toBe(rows + 1)
  })

  test("a publish refused for a stale version writes nothing and leaves its confirmation unused", async () => {
    const editor = await superadmin()
    const opened = (await live(editor))?.version ?? null
    const stalePayload = { config: { presentation: { attempt: "stale" } }, expectedVersion: opened }
    const confirmation = await confirmedAs(app, editor, stalePayload)
    const newer = { config: { presentation: { attempt: "newer" } }, expectedVersion: opened }
    expect((await publish(confirmedHeaders(editor, await confirmedAs(app, editor, newer), newKey()), newer)).statusCode).toBe(200)
    const before = { rows: await versionRows(), audits: await publishAudits(), current: await live(editor) }

    const stale = await publish(confirmedHeaders(editor, confirmation, newKey()), stalePayload)

    expect(outcomeOf(stale)).toEqual([409, "STATE_CONFLICT"])
    expect({ rows: await versionRows(), audits: await publishAudits(), current: await live(editor) }).toEqual(before)
    expect(await unconsumed(editor.userId)).toBe(1)
  })

  test("a replay under the same key with a different body is refused as a reused key and uses no confirmation", async () => {
    const editor = await superadmin()
    const key = newKey()
    const first = { config: { presentation: { replay: "first" } } }
    const second = { config: { presentation: { replay: "second" } } }
    expect((await publish(confirmedHeaders(editor, await confirmedAs(app, editor, first), key), first)).statusCode).toBe(200)
    const confirmation = await confirmedAs(app, editor, second)
    const rows = await versionRows()

    const reused = await publish(confirmedHeaders(editor, confirmation, key), second)
    const unusedAfterReuse = await unconsumed(editor.userId)
    const underNewKey = await publish(confirmedHeaders(editor, confirmation, newKey()), second)

    expect(outcomeOf(reused)).toEqual([409, "IDEMPOTENCY_KEY_REUSED"])
    expect(unusedAfterReuse).toBe(1)
    expect(underNewKey.statusCode).toBe(200)
    expect(await versionRows()).toBe(rows + 1)
  })
})

describe("confirming the password", () => {
  test("an admin without config.publish is refused before any password check", async () => {
    const support = await signInRoleAdmin(app, stack, "support")

    const wrong = await requestConfirmation(app, support, { config: {} }, WRONG_PASSWORD)
    const right = await requestConfirmation(app, support, { config: {} })

    expect(outcomeOf(wrong)).toEqual([403, "AUTHORIZATION_DENIED"])
    expect(outcomeOf(right)).toEqual([403, "AUTHORIZATION_DENIED"])
    expect(await stack.count("audit_events", "command like 'auth.step_up_%' and actor_user_id = $1", [support.userId])).toBe(0)
    expect(await stack.count("admin_step_up_confirmations", "user_id = $1", [support.userId])).toBe(0)
  })

  test("a wrong password is refused and audited without the password, and counts toward a limit that then refuses even the right one", async () => {
    const admin = await superadmin()

    const wrong = await attempts(admin, WRONG_PASSWORD, FAILURES_PER_WINDOW)
    const right = await requestConfirmation(app, admin, { config: {} })

    expect(wrong).toEqual(Array.from({ length: FAILURES_PER_WINDOW }, () => [401, "INVALID_CREDENTIALS"]))
    expect(outcomeOf(right)).toEqual([429, "RATE_LIMITED"])
    expect(await stack.count("audit_events", "command = 'auth.step_up_refused' and actor_user_id = $1", [admin.userId])).toBe(
      FAILURES_PER_WINDOW,
    )
    expect(await stack.count("admin_step_up_confirmations", "user_id = $1", [admin.userId])).toBe(0)
    expect(await stack.rowsMentioning(WRONG_PASSWORD)).toBe(0)
  })

  test("only wrong passwords count, so an admin who keeps republishing is never locked out by success", async () => {
    const admin = await superadmin()

    const wrong = await attempts(admin, WRONG_PASSWORD, FAILURES_PER_WINDOW - 1)
    const successes = await attempts(admin, PASSWORD, FAILURES_PER_WINDOW + 1)
    const lastWrong = await attempts(admin, WRONG_PASSWORD, 1)
    const afterLimit = await attempts(admin, PASSWORD, 1)

    expect(wrong.every(([status]) => status === 401)).toBe(true)
    expect(successes.map(([status]) => status)).toEqual(Array.from({ length: FAILURES_PER_WINDOW + 1 }, () => 200))
    expect(lastWrong).toEqual([[401, "INVALID_CREDENTIALS"]])
    expect(afterLimit).toEqual([[429, "RATE_LIMITED"]])
  })
})
