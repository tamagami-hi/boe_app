import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAdminOversightRepository } from "../../src/repositories/adminOversightRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { registerAdminOversightRoutes } from "../../src/routes/adminOversightRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

type LockingAction = "suspend" | "close"

const LOCKING_ACTIONS: readonly LockingAction[] = ["suspend", "close"]
const STATE_AFTER: Readonly<Record<LockingAction, string>> = { suspend: "suspended", close: "closed" }

let stack: PasswordMailStack
let app: FastifyInstance

const lifecycle = (as: AdminSession, userId: string, action: LockingAction, key?: string) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/users/${userId}/${action}`,
    headers: adminHeaders(as, key),
    payload: { reasonCode: `admin_${action}` },
  })

const footprint = async (userId: string) => ({
  user: await stack.first(
    "select account_state, version::text as version, suspended_at, closed_at, updated_at from users where id = $1",
    [userId],
  ),
  activeSessions: await stack.count("auth_sessions", "user_id = $1 and state = 'active'", [userId]),
  auditRows: await stack.count("audit_events"),
  receipts: await stack.count("idempotency_records"),
})

const errorOf = (response: { json: <T>() => T }) => response.json<{ error: { code: string; message: string } }>().error

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminOversightRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        oversightRepository: createAdminOversightRepository(),
        loginEventRepository: createLoginEventRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        authSessionRepository: stack.authSessionRepository,
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("an admin suspending or closing an admin account", () => {
  test.each(LOCKING_ACTIONS)("%s on the admin's own account is refused and changes nothing", async (action) => {
    const self = await signInRoleAdmin(app, stack, "superadmin")
    const before = await footprint(self.userId)
    expect(before.user.account_state).toBe("active")
    expect(before.activeSessions).toBeGreaterThan(0)

    const key = randomUUID()
    const attempts = [
      await lifecycle(self, self.userId, action, key),
      await lifecycle(self, self.userId, action, key),
      await lifecycle(self, self.userId.toUpperCase(), action),
    ]

    for (const refused of attempts) {
      expect(refused.statusCode, refused.body).toBe(403)
      expect(errorOf(refused).code).toBe("AUTHORIZATION_DENIED")
      expect(errorOf(refused).message).toMatch(/your own account/u)
    }
    expect(await footprint(self.userId)).toEqual(before)

    const stillSignedIn = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${self.userId}/detail`,
      headers: adminHeaders(self),
    })
    expect(stillSignedIn.statusCode, stillSignedIn.body).toBe(200)
    expect(stillSignedIn.json<{ data: { user: { accountState: string } } }>().data.user.accountState).toBe("active")
  })

  test.each(LOCKING_ACTIONS)("%s on another admin's account still applies, revokes it and is audited", async (action) => {
    const actor = await signInRoleAdmin(app, stack, "superadmin")
    const target = await signInRoleAdmin(app, stack, "superadmin")
    const auditBefore = await stack.count("audit_events", "entity_id = $1 and command = $2", [
      target.userId,
      `user.${STATE_AFTER[action]}`,
    ])

    const applied = await lifecycle(actor, target.userId, action, randomUUID())

    expect(applied.statusCode, applied.body).toBe(200)
    expect(applied.json<{ data: { status: string } }>().data.status).toBe(STATE_AFTER[action])
    const after = await footprint(target.userId)
    expect(after.user.account_state).toBe(STATE_AFTER[action])
    expect(after.activeSessions).toBe(0)
    expect(
      await stack.count("audit_events", "entity_id = $1 and command = $2 and actor_user_id = $3", [
        target.userId,
        `user.${STATE_AFTER[action]}`,
        actor.userId,
      ]),
    ).toBe(auditBefore + 1)
  })
})
