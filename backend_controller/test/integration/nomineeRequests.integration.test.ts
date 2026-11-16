import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createNomineeRequestDecidedGuard } from "../../src/domain/email/nomineeRequestDecidedGuard.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createNomineeRequestRepository } from "../../src/repositories/nomineeRequestRepository.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { bearer, registerNomineeTestSurface, seedNomineeClient, type NomineeClient } from "./nomineeSupport.js"
import { PASSWORD, PasswordMailStack, type Row } from "./passwordMailSupport.js"

const REQUESTED = { name: "Lakshmi Iyer", relation: "Mother" }
const DECLINE_REASON = "Please send the nominee's full name <as on their ID>."
const WRONG_PASSWORD = "not the client's real password"

interface RequestBody {
  readonly id: string
  readonly nominee: { readonly name: string; readonly relation: string }
  readonly state: string
  readonly declineReason: string | null
  readonly version: number
}

interface Decision {
  readonly request: RequestBody & { readonly userId: string; readonly decidedByName: string | null }
}

let stack: PasswordMailStack
let app: FastifyInstance
let webAuth: WebAuthDeps
let admin: AdminSession
let onboarding: AdminSession
let support: AdminSession
let finance: AdminSession

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const codeOf = (response: { json: () => unknown }): string => (response.json() as { error: { code: string } }).error.code

const seedClient = (): Promise<NomineeClient> => seedNomineeClient(stack, webAuth)

const send = (client: NomineeClient, payload: object = REQUESTED, key = randomUUID(), currentPassword = PASSWORD) =>
  app.inject({
    method: "POST",
    url: "/v1/client/nominee-requests",
    headers: bearer(client, key),
    payload: { ...payload, currentPassword },
  })

const latest = (client: NomineeClient) =>
  app.inject({ method: "GET", url: "/v1/client/nominee-requests/latest", headers: bearer(client) })

const withdraw = (client: NomineeClient, requestId: string, expectedVersion: number, key = randomUUID()) =>
  app.inject({
    method: "POST",
    url: `/v1/client/nominee-requests/${requestId}/withdraw`,
    headers: bearer(client, key),
    payload: { expectedVersion },
  })

const decide = (verb: "accept" | "decline", requestId: string, payload: object, as: AdminSession = admin, key = randomUUID()) =>
  app.inject({ method: "POST", url: `/v1/admin/nominee-requests/${requestId}/${verb}`, headers: adminHeaders(as, key), payload })

const setNominee = (userId: string, expectedVersion: number) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/users/${userId}/nominee`,
    headers: adminHeaders(admin, randomUUID()),
    payload: { name: "Kiran Rao", relation: "Son", expectedVersion },
  })

const sentRequest = async (client: NomineeClient): Promise<RequestBody> => {
  const response = await send(client)
  expect(response.statusCode).toBe(201)
  return dataOf<{ request: RequestBody }>(response).request
}

const requestRow = (id: string): Promise<Row> =>
  stack.first("select state, decline_reason, decided_by_user_id, version from client_nominee_requests where id = $1", [id])

const nomineeOf = (userId: string): Promise<Row> =>
  stack.first("select nominee_name, nominee_relation, nominee_version, version from users where id = $1", [userId])

const decisionTrail = async (userId: string, requestId: string) => ({
  audits: (
    await stack.pool.query<Row>(
      "select command, actor_type from audit_events where entity_id = any($1::uuid[]) and command <> 'nominee_request.sent' order by command, occurred_at",
      [[userId, requestId]],
    )
  ).rows,
  notifications: await stack.count("notifications", "user_id = $1", [userId]),
  mail: await stack.count("email_deliveries", "user_id = $1 and template_key = 'nominee_request_decided'", [userId]),
})

const deliverDecisionMail = async (userId: string) => {
  const transport = stack.transport()
  const guard = createNomineeRequestDecidedGuard({
    nomineeRequestRepository: createNomineeRequestRepository(),
    userRepository: stack.userRepository,
  })
  await stack.dispatch(transport, stack.clock, stack.crypto, [["nominee_request_decided", guard]])
  const email = (await stack.first("select email_normalized from users where id = $1", [userId])).email_normalized
  return transport.messages.filter((message) => message.to === email)
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerNomineeTestSurface(instance, stack, webAuth)
    },
  })
  admin = await signInRoleAdmin(app, stack, "superadmin")
  onboarding = await signInRoleAdmin(app, stack, "onboarding")
  support = await signInRoleAdmin(app, stack, "support")
  finance = await signInRoleAdmin(app, stack, "finance")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("a client's nominee request", () => {
  test("is sent with the password re-checked, read and withdrawn only by its own client, and audited without the name", async () => {
    const asha = await seedClient()
    const ravi = await seedClient()
    const key = randomUUID()

    const sent = await send(asha, REQUESTED, key)
    expect(sent.statusCode).toBe(201)
    const request = dataOf<{ request: RequestBody }>(sent).request
    expect(request).toMatchObject({ nominee: REQUESTED, state: "pending", declineReason: null, version: 1 })
    const replay = await send(asha, REQUESTED, key)
    expect(dataOf<{ request: RequestBody }>(replay).request).toEqual(request)
    expect(replay.json()).toMatchObject({ meta: { idempotencyReplay: true } })
    expect(dataOf<{ request: RequestBody | null }>(await latest(asha)).request).toEqual(request)
    expect(dataOf<{ request: RequestBody | null }>(await latest(ravi)).request).toBeNull()

    expect(codeOf(await withdraw(ravi, request.id, 1))).toBe("RESOURCE_NOT_FOUND")
    expect(await requestRow(request.id)).toMatchObject({ state: "pending", version: "1" })
    expect(codeOf(await withdraw(asha, request.id, 2))).toBe("STATE_CONFLICT")
    const withdrawn = await withdraw(asha, request.id, 1)
    expect(withdrawn.statusCode).toBe(200)
    expect(dataOf<{ request: RequestBody }>(withdrawn).request).toMatchObject({ state: "withdrawn", version: 2 })
    expect(codeOf(await withdraw(asha, request.id, 2))).toBe("STATE_CONFLICT")

    const audits = await stack.pool.query<Row>(
      "select actor_type, actor_user_id, command, metadata from audit_events where entity_id = $1 order by occurred_at, id",
      [request.id],
    )
    expect(audits.rows).toEqual([
      {
        actor_type: "user",
        actor_user_id: asha.id,
        command: "nominee_request.sent",
        metadata: { userId: asha.id, requestedName: "L***", replacesNominee: false },
      },
      { actor_type: "user", actor_user_id: asha.id, command: "nominee_request.withdrawn", metadata: { userId: asha.id } },
    ])
    expect(await stack.count("audit_events", "metadata::text like $1", ["%Lakshmi%"])).toBe(0)
  })

  test("refuses a wrong password, then the shared limit, and needs a signed-in client", async () => {
    const client = await seedClient()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(codeOf(await send(client, REQUESTED, randomUUID(), WRONG_PASSWORD))).toBe("INVALID_CREDENTIALS")
    }
    expect(codeOf(await send(client))).toBe("RATE_LIMITED")
    expect(await stack.count("client_nominee_requests", "user_id = $1", [client.id])).toBe(0)

    const anonymous = [
      app.inject({ method: "GET", url: "/v1/client/nominee-requests/latest" }),
      app.inject({ method: "POST", url: "/v1/client/nominee-requests", payload: { ...REQUESTED, currentPassword: PASSWORD } }),
      app.inject({ method: "POST", url: `/v1/client/nominee-requests/${randomUUID()}/withdraw`, payload: { expectedVersion: 1 } }),
    ]
    for (const response of await Promise.all(anonymous)) expect(response.statusCode).toBe(401)
  })

  test("allows one pending request per client, also when sends race", async () => {
    const client = await seedClient()
    const names = ["Asha Menon", "Bala Menon", "Chitra Menon", "Dev Menon", "Esha Menon"]
    const responses = await Promise.all(names.map((name) => send(client, { name, relation: "Sister" })))

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409, 409, 409, 409])
    for (const refused of responses.filter((response) => response.statusCode === 409)) {
      expect(codeOf(refused)).toBe("STATE_CONFLICT")
    }
    expect(await stack.count("client_nominee_requests", "user_id = $1 and state = 'pending'", [client.id])).toBe(1)
    await expect(
      stack.pool.query("insert into client_nominee_requests (user_id, nominee_name, nominee_relation) values ($1, 'Farah Menon', 'Sister')", [
        client.id,
      ]),
    ).rejects.toThrow(/client_nominee_requests_one_pending_uk/u)
  })
})

describe("the admin nominee request commands", () => {
  test("need users.read to read and clients.create to decide", async () => {
    const client = await seedClient()
    const request = await sentRequest(client)

    for (const outsider of [support, finance]) {
      for (const url of ["/v1/admin/nominee-requests", "/v1/admin/overview/nominee-requests", `/v1/admin/users/${client.id}/nominee-requests`]) {
        expect((await app.inject({ method: "GET", url, headers: adminHeaders(outsider) })).statusCode, url).toBe(403)
      }
      expect((await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 0 }, outsider)).statusCode).toBe(403)
      expect((await decide("decline", request.id, { expectedVersion: 1, reason: null }, outsider)).statusCode).toBe(403)
    }
    expect(await requestRow(request.id)).toMatchObject({ state: "pending", version: "1" })

    const queue = await app.inject({ method: "GET", url: "/v1/admin/nominee-requests?state=pending", headers: adminHeaders(onboarding) })
    expect(dataOf<{ items: readonly RequestBody[] }>(queue).items.map((item) => item.id)).toContain(request.id)
    const summary = await app.inject({ method: "GET", url: "/v1/admin/overview/nominee-requests", headers: adminHeaders(onboarding) })
    expect(dataOf<{ pendingCount: number }>(summary).pendingCount).toBe(
      await stack.count("client_nominee_requests", "state = 'pending'"),
    )
    const declined = await decide("decline", request.id, { expectedVersion: 1, reason: DECLINE_REASON }, onboarding)
    expect(declined.statusCode).toBe(200)
    expect(dataOf<Decision>(declined).request).toMatchObject({ state: "declined", declineReason: DECLINE_REASON })
    expect(dataOf<{ request: RequestBody }>(await latest(client)).request).toMatchObject({
      state: "declined",
      declineReason: DECLINE_REASON,
    })
    const [mail] = await deliverDecisionMail(client.id)
    expect(mail?.text).toContain(`The reason the team gave: ${DECLINE_REASON}`)
    expect(mail?.html).toContain("full name &lt;as on their ID&gt;.")
    expect(codeOf(await decide("decline", randomUUID(), { expectedVersion: 1, reason: null }))).toBe("RESOURCE_NOT_FOUND")
  })

  test("accept sets the nominee and closes the request together, or changes neither", async () => {
    const client = await seedClient()
    const request = await sentRequest(client)
    expect((await setNominee(client.id, 0)).statusCode).toBe(200)

    expect(codeOf(await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 0 }))).toBe("STATE_CONFLICT")
    expect(await requestRow(request.id)).toMatchObject({ state: "pending", version: "1" })
    expect(await nomineeOf(client.id)).toMatchObject({ nominee_name: "Kiran Rao", nominee_version: 1 })

    await stack.pool.query(
      "create function refuse_test_acceptance() returns trigger language plpgsql as $$ begin raise exception 'refused for the test'; end; $$",
    )
    await stack.pool.query(
      `create trigger refuse_test_acceptance before update on client_nominee_requests for each row ` +
        `when (new.id = '${request.id}' and new.state = 'accepted') execute function refuse_test_acceptance()`,
    )
    try {
      expect((await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 1 })).statusCode).toBe(500)
    } finally {
      await stack.pool.query("drop trigger refuse_test_acceptance on client_nominee_requests")
      await stack.pool.query("drop function refuse_test_acceptance()")
    }
    expect(await requestRow(request.id)).toMatchObject({ state: "pending", version: "1" })
    expect(await nomineeOf(client.id)).toMatchObject({ nominee_name: "Kiran Rao", nominee_version: 1, version: "1" })
    expect(await decisionTrail(client.id, request.id)).toEqual({
      audits: [{ command: "user.nominee_changed", actor_type: "admin" }],
      notifications: 0,
      mail: 0,
    })

    const key = randomUUID()
    const accepted = await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 1 }, admin, key)
    expect(accepted.statusCode).toBe(200)
    expect(Object.keys(dataOf<Decision>(accepted))).toEqual(["request"])
    expect(dataOf<Decision>(accepted).request).toMatchObject({ id: request.id, userId: client.id, state: "accepted", version: 2 })
    expect(typeof dataOf<Decision>(accepted).request.decidedByName).toBe("string")
    const replay = await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 1 }, admin, key)
    expect(dataOf<Decision>(replay)).toEqual(dataOf<Decision>(accepted))
    expect(codeOf(await decide("accept", request.id, { expectedVersion: 1, expectedNomineeVersion: 2 }))).toBe("STATE_CONFLICT")

    expect(await nomineeOf(client.id)).toMatchObject({
      nominee_name: REQUESTED.name,
      nominee_relation: REQUESTED.relation,
      nominee_version: 2,
      version: "1",
    })
    expect(await decisionTrail(client.id, request.id)).toEqual({
      audits: [
        { command: "nominee_request.accepted", actor_type: "admin" },
        { command: "user.nominee_changed", actor_type: "admin" },
        { command: "user.nominee_changed", actor_type: "admin" },
      ],
      notifications: 1,
      mail: 1,
    })
    expect(
      await stack.first("select kind, payload from notifications where user_id = $1", [client.id]),
    ).toEqual({ kind: "nominee_request_decided", payload: { nomineeRequestId: request.id, decision: "accepted", deepLink: "/profile" } })

    expect((await deliverDecisionMail(client.id)).map((message) => message.subject)).toEqual(["Your nominee request was accepted"])
  })

  test("lets exactly one of two concurrent decisions win", async () => {
    for (const [first, second] of [
      ["accept", "decline"],
      ["accept", "accept"],
    ] as const) {
      const client = await seedClient()
      const request = await sentRequest(client)
      const bodyOf = (verb: "accept" | "decline") =>
        verb === "accept" ? { expectedVersion: 1, expectedNomineeVersion: 0 } : { expectedVersion: 1, reason: null }
      const responses = await Promise.all([
        decide(first, request.id, bodyOf(first), admin),
        decide(second, request.id, bodyOf(second), onboarding),
      ])

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
      const winner = responses.find((response) => response.statusCode === 200)
      const state = winner === undefined ? null : dataOf<Decision>(winner).request.state
      expect(await requestRow(request.id)).toMatchObject({ state, version: "2" })
      expect((await nomineeOf(client.id)).nominee_name).toBe(state === "accepted" ? REQUESTED.name : null)
      expect(
        await stack.count("audit_events", "entity_id = $1 and command in ('nominee_request.accepted', 'nominee_request.declined')", [
          request.id,
        ]),
      ).toBe(1)
      expect(await stack.count("notifications", "user_id = $1", [client.id])).toBe(1)
    }
  })
})
