import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"

import { createUncachedCache } from "../../src/cache/cache.js"
import { createAdminContentRepository } from "../../src/repositories/adminContentRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminContentRoutes } from "../../src/routes/adminContentRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInAs, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"
import { confirmedAs, confirmedHeaders, registerStepUp, requestConfirmation, stepUpFor } from "./stepUpSupport.js"

const ROUTE = "/v1/admin/app-config"
const CONFIRMATION_LIFETIME_MS = 5 * 60_000
const ATTEMPTS_PER_WINDOW = 5
const WRONG_PASSWORD = "a password this admin never had"

interface Envelope {
  readonly data: { readonly version: number | null } | null
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } | null
  readonly meta: { readonly idempotencyReplay?: boolean }
}

let stack: PasswordMailStack
let app: FastifyInstance

const envelope = (r: { json: () => unknown }): Envelope => r.json() as Envelope
const errorOf = (r: { json: () => unknown }): string => envelope(r).error?.code ?? "none"
const newKey = (): string => `publish-${randomBytes(8).toString("hex")}`
const versionRows = () => stack.count("app_config_versions")
const publishAudits = () => stack.count("audit_events", "command = 'app_config.published'")
const superadmin = (): Promise<AdminSession> => signInRoleAdmin(app, stack, "superadmin")

const publish = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: "PATCH", url: ROUTE, headers, payload })

const liveVersion = async (session: AdminSession): Promise<number | null> =>
  envelope(await app.inject({ method: "GET", url: ROUTE, headers: adminHeaders(session) })).data?.version ?? null

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
    const confirmation = await confirmedAs(app, editor)
    const key = newKey()
    const payload = { config: { featureFlags: { confirmed: true } } }

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

  test("a used confirmation cannot publish again under a new request", async () => {
    const editor = await superadmin()
    const confirmation = await confirmedAs(app, editor)
    const first = await publish(confirmedHeaders(editor, confirmation, newKey()), { config: { presentation: { round: 1 } } })
    const rows = await versionRows()

    const again = await publish(confirmedHeaders(editor, confirmation, newKey()), { config: { presentation: { round: 2 } } })

    expect(first.statusCode).toBe(200)
    expect([again.statusCode, errorOf(again)]).toEqual([409, "TOKEN_ALREADY_USED"])
    expect(await versionRows()).toBe(rows)
  })

  test("a confirmation is honoured just inside five minutes and refused just after, writing nothing", async () => {
    const editor = await superadmin()
    const early = await confirmedAs(app, editor)
    const late = await confirmedAs(app, editor)

    stack.clockOffsetMs = CONFIRMATION_LIFETIME_MS - 5_000
    const inside = await publish(confirmedHeaders(editor, early, newKey()), { config: { presentation: { inside: true } } })
    const rows = await versionRows()
    stack.clockOffsetMs = CONFIRMATION_LIFETIME_MS + 1_000
    const outside = await publish(confirmedHeaders(editor, late, newKey()), { config: { presentation: { outside: true } } })

    expect(inside.statusCode).toBe(200)
    expect([outside.statusCode, errorOf(outside)]).toEqual([410, "TOKEN_EXPIRED"])
    expect(await versionRows()).toBe(rows)
  })

  test("a confirmation belongs to the session that asked for it, not another admin or another session of the same admin", async () => {
    const owner = await superadmin()
    const otherAdmin = await superadmin()
    const ownersOtherSession = await signInAs(app, owner.userId, owner.email)
    const confirmation = await confirmedAs(app, owner)
    const rows = await versionRows()

    const byOtherAdmin = await publish(confirmedHeaders(otherAdmin, confirmation, newKey()), { config: { presentation: { by: "other" } } })
    const byOtherSession = await publish(confirmedHeaders(ownersOtherSession, confirmation, newKey()), { config: { presentation: { by: "session" } } })
    const byOwner = await publish(confirmedHeaders(owner, confirmation, newKey()), { config: { presentation: { by: "owner" } } })

    expect([byOtherAdmin.statusCode, errorOf(byOtherAdmin)]).toEqual([400, "TOKEN_INVALID"])
    expect([byOtherSession.statusCode, errorOf(byOtherSession)]).toEqual([400, "TOKEN_INVALID"])
    expect(byOwner.statusCode).toBe(200)
    expect(await versionRows()).toBe(rows + 1)
  })

  test("a publish refused for a stale version leaves its confirmation unused, because both commit together", async () => {
    const editor = await superadmin()
    const live = await liveVersion(editor)
    const confirmation = await confirmedAs(app, editor)

    const stale = await publish(confirmedHeaders(editor, confirmation, newKey()), {
      config: { presentation: { attempt: "stale" } },
      expectedVersion: (live ?? 0) + 100,
    })
    const current = await publish(confirmedHeaders(editor, confirmation, newKey()), {
      config: { presentation: { attempt: "current" } },
      expectedVersion: live,
    })

    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "STATE_CONFLICT"])
    expect(current.statusCode).toBe(200)
  })
})

describe("confirming the password", () => {
  test("a wrong password is refused and audited without the password, and counts toward a limit that then refuses even the right one", async () => {
    const admin = await superadmin()

    const wrong = []
    for (let attempt = 0; attempt < ATTEMPTS_PER_WINDOW; attempt += 1) {
      wrong.push(await requestConfirmation(app, admin, WRONG_PASSWORD))
    }
    const right = await requestConfirmation(app, admin)

    expect(wrong.map((response) => [response.statusCode, errorOf(response)])).toEqual(
      Array.from({ length: ATTEMPTS_PER_WINDOW }, () => [401, "INVALID_CREDENTIALS"]),
    )
    expect([right.statusCode, errorOf(right)]).toEqual([429, "RATE_LIMITED"])
    expect(await stack.count("audit_events", "command = 'auth.step_up_refused' and actor_user_id = $1", [admin.userId])).toBe(
      ATTEMPTS_PER_WINDOW,
    )
    expect(await stack.count("admin_step_up_confirmations", "user_id = $1", [admin.userId])).toBe(0)
    expect(await stack.rowsMentioning(WRONG_PASSWORD)).toBe(0)
  })
})
