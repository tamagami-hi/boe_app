import { randomBytes } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAdminOversightRepository } from "../../src/repositories/adminOversightRepository.js"
import { createClientReturnsRepository } from "../../src/repositories/clientReturnsRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { registerAdminOversightRoutes } from "../../src/routes/adminOversightRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface DirectoryPage {
  readonly data: { readonly items: readonly { readonly id: string }[] }
  readonly meta: { readonly page: { readonly nextCursor: string | null; readonly hasMore: boolean } }
}

let stack: PasswordMailStack
let app: FastifyInstance
let admin: AdminSession
let support: AdminSession
let onboarding: AdminSession
let finance: AdminSession

const get = (as: AdminSession, url: string) => app.inject({ method: "GET", url, headers: adminHeaders(as) })

const walk = async (as: AdminSession, filter: string): Promise<readonly string[]> => {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const after: string = cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`
    const response = await get(as, `/v1/admin/users?limit=2${filter}${after}`)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json<DirectoryPage>()
    ids.push(...body.data.items.map((item) => item.id))
    cursor = body.meta.page.hasMore ? body.meta.page.nextCursor : null
  } while (cursor !== null)
  return ids
}

const allUserIdsNewestFirst = async (): Promise<readonly string[]> =>
  (await stack.pool.query<{ id: string }>("select id from users order by created_at desc, id desc")).rows.map((row) => row.id)

const seedRoleHolderWithoutPassword = async (): Promise<string> => {
  const { id } = await stack.seedUser({ password: false })
  await stack.pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $2 from roles where code = 'support'",
    [id, admin.userId],
  )
  return id
}

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
  admin = await signInRoleAdmin(app, stack, "superadmin")
  support = await signInRoleAdmin(app, stack, "support")
  onboarding = await signInRoleAdmin(app, stack, "onboarding")
  finance = await signInRoleAdmin(app, stack, "finance")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("the admin user directory segment filter", () => {
  test("clients leaves out every account holding a role, and the unfiltered directory is unchanged", async () => {
    const active = await stack.seedUser({ password: true })
    const unset = await stack.seedUser({ password: false })
    const suspended = await stack.seedUser({ password: true, state: "suspended" })
    const closed = await stack.seedUser({ password: true, state: "closed" })
    const roleHolder = await seedRoleHolderWithoutPassword()
    const clientIds = [active.id, unset.id, suspended.id, closed.id]
    const adminIds = [admin.userId, support.userId, onboarding.userId, finance.userId, roleHolder]

    const everyone = await walk(admin, "")
    expect(everyone).toEqual(await allUserIdsNewestFirst())
    expect(everyone).toEqual(expect.arrayContaining([...clientIds, ...adminIds]))

    const clients = await walk(admin, "&segment=clients")
    expect(clients).toEqual(everyone.filter((id) => !adminIds.includes(id)))
    expect(clients).toEqual(expect.arrayContaining(clientIds))
    for (const id of adminIds) expect(clients).not.toContain(id)

    expect(await walk(support, "&segment=clients")).toEqual(clients)
    expect(await walk(admin, "&segment=clients&status=suspended")).toEqual([suspended.id])
  })

  test("pending_invites lists exactly the clients the overview tile counts", async () => {
    const pendingActive = await stack.seedUser({ password: false })
    const pendingInvited = await stack.seedUser({ password: false })
    await stack.pool.query("update users set account_state = 'invited', activated_at = null where id = $1", [pendingInvited.id])
    const hasPassword = await stack.seedUser({ password: true })
    const suspended = await stack.seedUser({ password: false, state: "suspended" })
    const closed = await stack.seedUser({ password: false, state: "closed" })
    const tombstoned = await stack.seedUser({ password: false })
    await stack.pool.query("update users set pii_tombstoned_at = now() where id = $1", [tombstoned.id])
    const roleHolder = await seedRoleHolderWithoutPassword()

    const pending = await walk(admin, "&segment=pending_invites")
    expect(pending).toEqual(expect.arrayContaining([pendingActive.id, pendingInvited.id]))
    for (const id of [hasPassword.id, suspended.id, closed.id, tombstoned.id, roleHolder, admin.userId]) {
      expect(pending).not.toContain(id)
    }
    const counted = await createClientReturnsRepository().countPendingInvites(stack.database)
    expect(pending).toHaveLength(counted.count)
  })

  test("a cursor stays bound to its segment and unknown segments or missing permissions are refused", async () => {
    await stack.seedUser({ password: true })
    await stack.seedUser({ password: true })
    await stack.seedUser({ password: true })
    const first = (await get(admin, "/v1/admin/users?limit=1&segment=clients")).json<DirectoryPage>()
    expect(first.meta.page.hasMore).toBe(true)
    const crossed = await get(admin, `/v1/admin/users?limit=1&after=${encodeURIComponent(first.meta.page.nextCursor ?? "")}`)
    expect(crossed.statusCode).toBe(400)
    expect(crossed.json<{ error: { code: string } }>().error.code).toBe("CURSOR_INVALID")

    const unknown = await get(admin, "/v1/admin/users?segment=admins")
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_FAILED")

    const refused = await get(finance, "/v1/admin/users?segment=clients")
    expect(refused.statusCode).toBe(403)
    expect(refused.json<{ error: { code: string } }>().error.code).toBe("AUTHORIZATION_DENIED")
  })
})
