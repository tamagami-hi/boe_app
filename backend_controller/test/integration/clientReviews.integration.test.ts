import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { AccessTokenService } from "../../src/auth/accessToken.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminReviewRoutes } from "../../src/routes/adminReviewRoutes.js"
import { registerClientReviewRoutes } from "../../src/routes/clientReviewRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Client {
  readonly userId: string
  readonly token: string
}

interface Review {
  readonly id: string
  readonly userId?: string
  readonly clientName?: string
  readonly rating: number
  readonly comment: string | null
  readonly state?: string
  readonly version?: number
  readonly moderationNote?: string | null
  readonly moderatorName?: string | null
  readonly moderatedAt?: string | null
}

interface ReviewList {
  readonly items: readonly Review[]
  readonly canSubmit?: boolean
  readonly nextSubmissionOn?: string | null
}

interface Injected {
  readonly statusCode: number
  readonly json: () => unknown
}

const MAX_WALKED_PAGES = 200
const IST_OFFSET_MS = 330 * 60_000
const BELL = String.fromCodePoint(0x07)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d)
const HANGUL_FILLER = String.fromCodePoint(0x3164)
const HANGUL_CHOSEONG_FILLER = String.fromCodePoint(0x115f)
const HANGUL_JUNGSEONG_FILLER = String.fromCodePoint(0x1160)
const BRAILLE_BLANK = String.fromCodePoint(0x2800)
const GRAPHEME_JOINER = String.fromCodePoint(0x034f)
const COMBINING_ACUTE = String.fromCodePoint(0x0301)
const EMOJI_PRESENTATION = String.fromCodePoint(0xfe0f)
const HEART = String.fromCodePoint(0x2764)
const CLIENT_REVIEW_KEYS = ["comment", "id", "rating", "submittedAt"]

let stack: PasswordMailStack
let app: FastifyInstance
let tokens: AccessTokenService
let support: AdminSession
let reader: AdminSession
let finance: AdminSession

const dataOf = <T>(response: Injected): T => (response.json() as { data: T }).data
const metaOf = (response: Injected) =>
  (response.json() as { meta: { idempotencyReplay?: boolean; page?: { nextCursor: string | null } } }).meta
const codeOf = (response: Injected): string => (response.json() as { error: { code: string } }).error.code

const firstOfNextIstMonth = (): string => {
  const ist = new Date(Date.now() + IST_OFFSET_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

const seedClient = async (): Promise<Client> => {
  const user = await stack.seedUser({ password: true })
  const session = await stack.pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [user.id],
  )
  return { userId: user.id, token: await tokens.sign({ sub: user.id, sid: session.rows[0]?.id ?? "" }) }
}

const submit = (client: Client, payload: object) =>
  app.inject({ method: "POST", url: "/v1/client/reviews", headers: { authorization: `Bearer ${client.token}` }, payload })

const submitted = async (client: Client, payload: object): Promise<Review> => {
  const response = await submit(client, payload)
  expect(response.statusCode).toBe(201)
  return dataOf<Review>(response)
}

const clientGet = (client: Client, url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${client.token}` } })

const adminGet = (session: AdminSession, url: string) => app.inject({ method: "GET", url, headers: adminHeaders(session) })

const moderate = (session: AdminSession, reviewId: string, payload: object, key: string) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/reviews/${reviewId}/moderation`,
    headers: adminHeaders(session, key),
    payload,
  })

const insertReviewAt = async (userId: string, createdAt: string, rating: number, comment: string | null): Promise<string> => {
  const inserted = await stack.pool.query<{ id: string }>(
    "insert into client_reviews (user_id, rating, comment, created_at, updated_at) values ($1, $2, $3, $4::timestamptz, $4::timestamptz) returning id",
    [userId, rating, comment, createdAt],
  )
  return inserted.rows[0]?.id ?? ""
}

const reviewsOf = (userId: string): Promise<number> => stack.count("client_reviews", "user_id = $1", [userId])

const footprint = async (reviewId: string) => ({
  review: await stack.first(
    "select state, moderation_note, moderated_by_user_id, comment, version::int as version from client_reviews where id = $1",
    [reviewId],
  ),
  audits: await stack.count("audit_events", "entity_id = $1 and command = 'client_review.moderated'", [reviewId]),
  receipts: await stack.count("idempotency_records"),
})

const walk = async (fetchPage: (cursor: string) => Promise<Injected>): Promise<string[]> => {
  const seen: string[] = []
  let after: string | null = null
  do {
    const page = await fetchPage(after === null ? "" : `&after=${encodeURIComponent(after)}`)
    expect(page.statusCode).toBe(200)
    seen.push(...dataOf<ReviewList>(page).items.map((item) => item.id))
    after = metaOf(page).page?.nextCursor ?? null
  } while (after !== null && new Set(seen).size === seen.length && seen.length < MAX_WALKED_PAGES)
  return seen
}

const refusedByDatabase = async (text: string, values: readonly unknown[]): Promise<boolean> => {
  try {
    await stack.pool.query(text, [...values])
    return false
  } catch {
    return true
  }
}

const signInWithPermissions = async (role: string, permissions: readonly string[]): Promise<AdminSession> => {
  await stack.pool.query("insert into roles (code, name) values ($1, $1) on conflict do nothing", [role])
  const session = await signInRoleAdmin(app, stack, role)
  for (const permission of permissions) {
    await stack.pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 on conflict do nothing",
      [session.userId, role, permission],
    )
  }
  return session
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  tokens = webAuth.accessTokenService
  const cursorKey = randomBytes(32)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminReviewRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
      })
      registerClientReviewRoutes(instance, {
        accessTokenService: tokens,
        database: stack.database,
        clientWeb: { originAllowlist: [] },
        unitOfWork: stack.unitOfWork,
        auditRepository: stack.auditRepository,
        clock: stack.clock,
        config: { cursorKey },
      })
    },
  })
  support = await signInRoleAdmin(app, stack, "support")
  finance = await signInRoleAdmin(app, stack, "finance")
  reader = await signInWithPermissions("review_reader", ["support.read"])
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("client reviews", () => {
  test("a client reads only their own reviews and shares at most one per calendar month", async () => {
    const alice = await seedClient()
    const bob = await seedClient()
    const comment = "Clear statements and quick replies.\nThank you."
    const first = await submitted(alice, { rating: 5, comment })
    expect(Object.keys(first).sort()).toEqual(CLIENT_REVIEW_KEYS)
    expect(first).toMatchObject({ rating: 5, comment })
    const bobs = await submitted(bob, { rating: 2, comment: null })

    const aliceList = dataOf<ReviewList>(await clientGet(alice, "/v1/client/reviews"))
    expect(aliceList.items.map((item) => item.id)).toEqual([first.id])
    expect(aliceList).toMatchObject({ canSubmit: false, nextSubmissionOn: firstOfNextIstMonth() })
    expect(dataOf<ReviewList>(await clientGet(bob, "/v1/client/reviews")).items.map((item) => item.id)).toEqual([bobs.id])

    const repeated = await submit(alice, { rating: 1, comment: "Changed my mind." })
    expect(repeated.statusCode).toBe(409)
    expect(codeOf(repeated)).toBe("STATE_CONFLICT")
    expect(await reviewsOf(alice.userId)).toBe(1)

    await stack.pool.query("update client_reviews set created_at = created_at - interval '40 days' where id = $1", [first.id])
    const fresh = dataOf<ReviewList>(await clientGet(alice, "/v1/client/reviews"))
    expect(fresh).toMatchObject({ canSubmit: true, nextSubmissionOn: null })
    const second = await submitted(alice, { rating: 4, comment: null })
    expect(dataOf<ReviewList>(await clientGet(alice, "/v1/client/reviews")).items.map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ])

    const carol = await seedClient()
    const raced = await Promise.all([submit(carol, { rating: 3, comment: null }), submit(carol, { rating: 3, comment: null })])
    expect(raced.map((response) => response.statusCode).sort()).toEqual([201, 409])
    expect(await reviewsOf(carol.userId)).toBe(1)

    const audit = await stack.first(
      "select metadata::text as metadata from audit_events where entity_id = $1 and command = 'client_review.submitted'",
      [first.id],
    )
    expect(audit.metadata).not.toContain("Clear statements")
  })

  test("refuses ratings and comments outside the rules in the API and in the database, and limits repeated posts", async () => {
    const refusedBodies: readonly object[] = [
      { rating: 0, comment: null },
      { rating: 6, comment: null },
      { rating: 4.5, comment: null },
      { rating: "5", comment: null },
      { rating: 5 },
      { rating: 5, comment: "   " },
      { rating: 5, comment: "x".repeat(1_001) },
      { rating: 5, comment: `Good${BELL}` },
      { rating: 5, comment: `Good${ZERO_WIDTH_SPACE}service` },
      { rating: 5, comment: `Fine${RIGHT_TO_LEFT_OVERRIDE}` },
      { rating: 5, comment: `${ZERO_WIDTH_JOINER}Good service` },
      { rating: 5, comment: HANGUL_FILLER },
      { rating: 5, comment: `${HANGUL_CHOSEONG_FILLER}Good` },
      { rating: 5, comment: `Good${HANGUL_JUNGSEONG_FILLER}service` },
      { rating: 5, comment: `Good${BRAILLE_BLANK}` },
      { rating: 5, comment: `Go${GRAPHEME_JOINER}od` },
      { rating: 5, comment: COMBINING_ACUTE },
      { rating: 5, comment: EMOJI_PRESENTATION },
      { rating: 5, comment: null, state: "hidden" },
    ]
    for (const body of refusedBodies) {
      const client = await seedClient()
      const refused = await submit(client, body)
      expect(refused.statusCode, JSON.stringify(body)).toBe(400)
      expect(codeOf(refused)).toBe("VALIDATION_FAILED")
      expect(await reviewsOf(client.userId)).toBe(0)
    }

    const trimmed = await submitted(await seedClient(), { rating: 3, comment: "  Helpful team  " })
    expect(trimmed.comment).toBe("Helpful team")
    const joined = `Gopal${ZERO_WIDTH_JOINER} helped me`
    expect((await submitted(await seedClient(), { rating: 4, comment: joined })).comment).toBe(joined)
    const emoji = `Thanks ${HEART}${EMOJI_PRESENTATION}`
    expect((await submitted(await seedClient(), { rating: 5, comment: emoji })).comment).toBe(emoji)

    const owner = (await stack.seedUser()).id
    const insert = "insert into client_reviews (user_id, rating, comment, state, created_at) values ($1, $2, $3, $4, $5::timestamptz)"
    expect(await refusedByDatabase(insert, [owner, 6, null, "new", "2021-01-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, `Fine${RIGHT_TO_LEFT_OVERRIDE}`, "new", "2021-02-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, " leading space", "new", "2021-03-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, "x".repeat(1_001), "new", "2021-04-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, null, "published", "2021-05-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, `edge${ZERO_WIDTH_JOINER}`, "new", "2021-05-12T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, "Two lines\nare fine", "new", "2021-06-10T00:00:00Z"])).toBe(false)
    expect(await refusedByDatabase(insert, [owner, 4, null, "new", "2021-06-20T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, `Fine${HANGUL_FILLER}`, "new", "2021-08-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, 4, `Fine${BRAILLE_BLANK}`, "new", "2021-09-10T00:00:00Z"])).toBe(true)
    const noted = "insert into client_reviews (user_id, rating, moderation_note, created_at) values ($1, 4, $2, $3::timestamptz)"
    expect(await refusedByDatabase(noted, [owner, `Se${GRAPHEME_JOINER}en`, "2021-10-10T00:00:00Z"])).toBe(true)
    expect(await refusedByDatabase(noted, [owner, "Seen by the team.", "2021-10-11T00:00:00Z"])).toBe(false)

    const eager = await seedClient()
    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await submit(eager, { rating: 5, comment: null })).statusCode)
    expect(statuses).toEqual([201, 409, 409, 409, 409, 429])
  })

  test("pages the inbox, the client page list and the client's own list without repeating or skipping a review", async () => {
    const client = await seedClient()
    const other = await stack.seedUser()
    const january = await insertReviewAt(client.userId, "2020-01-31T18:29:59.999999Z", 3, null)
    const february = await insertReviewAt(client.userId, "2020-01-31T18:30:00.000002Z", 3, null)
    const sameMillisecond = await insertReviewAt(other.id, "2020-01-31T18:30:00.000001Z", 3, null)

    const inbox = await walk((cursor) => adminGet(support, `/v1/admin/reviews?rating=3&limit=1${cursor}`))
    expect(new Set(inbox).size).toBe(inbox.length)
    const tail = inbox.filter((id) => [january, february, sameMillisecond].includes(id))
    expect(tail).toEqual([february, sameMillisecond, january])

    expect(await walk((cursor) => adminGet(support, `/v1/admin/users/${client.userId}/reviews?limit=1${cursor}`))).toEqual([
      february,
      january,
    ])
    expect(await walk((cursor) => clientGet(client, `/v1/client/reviews?limit=1${cursor}`))).toEqual([february, january])
    expect((await adminGet(support, `/v1/admin/users/${randomUUID()}/reviews`)).statusCode).toBe(404)
  })

  test("a repeated moderation key replays without writing twice and a stale version changes nothing", async () => {
    const client = await seedClient()
    const review = await submitted(client, { rating: 2, comment: "The statement page was slow." })
    const key = `review-${randomUUID()}`
    const body = { state: "read", moderationNote: "Shared with the team.", expectedVersion: 1 }

    const raced = await Promise.all([moderate(support, review.id, body, key), moderate(support, review.id, body, key)])
    const outcomes = raced.map((response) => response.statusCode).sort()
    expect(outcomes[0]).toBe(200)
    expect([200, 409]).toContain(outcomes[1])

    const replayed = await moderate(support, review.id, body, key)
    expect(replayed.statusCode).toBe(200)
    expect(metaOf(replayed).idempotencyReplay).toBe(true)
    expect(dataOf<Review>(replayed)).toMatchObject({ state: "read", version: 2, moderatorName: "Admin User" })

    const reused = await moderate(support, review.id, { ...body, moderationNote: "Another note." }, key)
    expect(reused.statusCode).toBe(409)
    expect(codeOf(reused)).toBe("IDEMPOTENCY_KEY_REUSED")

    const before = await footprint(review.id)
    expect(before).toMatchObject({ review: { state: "read", moderation_note: body.moderationNote, version: 2 }, audits: 1 })

    const stale = await moderate(support, review.id, { state: "hidden", moderationNote: null, expectedVersion: 1 }, `review-${randomUUID()}`)
    expect(stale.statusCode).toBe(409)
    expect(codeOf(stale)).toBe("STATE_CONFLICT")
    const unchanged = await moderate(support, review.id, { ...body, expectedVersion: 2 }, `review-${randomUUID()}`)
    expect(unchanged.statusCode).toBe(400)
    const blankNote = await moderate(support, review.id, { state: "hidden", moderationNote: HANGUL_FILLER, expectedVersion: 2 }, `review-${randomUUID()}`)
    expect(blankNote.statusCode).toBe(400)
    expect(await footprint(review.id)).toEqual(before)

    const missing = await moderate(support, randomUUID(), body, `review-${randomUUID()}`)
    expect(missing.statusCode).toBe(404)

    const hidden = await moderate(support, review.id, { state: "hidden", moderationNote: null, expectedVersion: 2 }, `review-${randomUUID()}`)
    expect(hidden.statusCode).toBe(200)
    const detail = dataOf<Review>(await adminGet(support, `/v1/admin/reviews/${review.id}`))
    expect(detail).toMatchObject({ clientName: "Ada Lovelace", state: "hidden", moderationNote: null, version: 3 })
    expect(typeof detail.moderatedAt).toBe("string")
    const hiddenOnly = dataOf<ReviewList>(await adminGet(support, "/v1/admin/reviews?state=hidden"))
    expect(hiddenOnly.items.map((item) => item.id)).toContain(review.id)
    expect(hiddenOnly.items.every((item) => item.state === "hidden")).toBe(true)
  })

  test("reads need support.read and moderation needs support.write", async () => {
    const client = await seedClient()
    const review = await submitted(client, { rating: 4, comment: null })
    const before = await footprint(review.id)
    const reads = ["/v1/admin/reviews", `/v1/admin/reviews/${review.id}`, `/v1/admin/users/${client.userId}/reviews`]
    const body = { state: "hidden", moderationNote: null, expectedVersion: 1 }

    for (const url of reads) {
      const denied = await adminGet(finance, url)
      expect(denied.statusCode, url).toBe(403)
      expect(codeOf(denied)).toBe("AUTHORIZATION_DENIED")
      expect((await adminGet(reader, url)).statusCode, url).toBe(200)
      expect([401, 403], url).toContain((await app.inject({ method: "GET", url })).statusCode)
      expect((await clientGet(client, url)).statusCode, url).toBe(401)
    }

    for (const session of [finance, reader]) {
      const refused = await moderate(session, review.id, body, `review-${randomUUID()}`)
      expect(refused.statusCode).toBe(403)
      expect(codeOf(refused)).toBe("AUTHORIZATION_DENIED")
    }
    const clientAttempt = await app.inject({
      method: "POST",
      url: `/v1/admin/reviews/${review.id}/moderation`,
      headers: { authorization: `Bearer ${client.token}`, "idempotency-key": `review-${randomUUID()}` },
      payload: body,
    })
    expect(clientAttempt.statusCode).toBe(401)
    expect(await footprint(review.id)).toEqual(before)
  })

  test("erases a tombstoned client's comments and moderation notes, keeps them erased and leaves other clients alone", async () => {
    const client = await seedClient()
    const neighbour = await seedClient()
    const review = await submitted(client, { rating: 1, comment: "Please call me on my mobile." })
    const kept = await submitted(neighbour, { rating: 5, comment: "Helpful and polite." })
    const quoted = "Client asked for a call on their mobile."
    const noted = await moderate(support, review.id, { state: "read", moderationNote: quoted, expectedVersion: 1 }, `review-${randomUUID()}`)
    expect(noted.statusCode).toBe(200)
    const keptNote = await moderate(support, kept.id, { state: "read", moderationNote: "Shared with the team.", expectedVersion: 1 }, `review-${randomUUID()}`)
    expect(keptNote.statusCode).toBe(200)

    await stack.pool.query("update users set pii_tombstoned_at = now() where id = $1", [client.userId])
    expect(
      await stack.first("select comment, moderation_note, rating, version::int as version from client_reviews where id = $1", [review.id]),
    ).toEqual({ comment: null, moderation_note: null, rating: 1, version: 3 })
    expect(dataOf<Review>(await adminGet(support, `/v1/admin/reviews/${review.id}`))).toMatchObject({
      clientName: "Tombstoned",
      comment: null,
      moderationNote: null,
    })

    const afterErasure = await moderate(
      support,
      review.id,
      { state: "hidden", moderationNote: quoted, expectedVersion: 3 },
      `review-${randomUUID()}`,
    )
    expect(afterErasure.statusCode).toBe(200)
    expect(dataOf<Review>(afterErasure)).toMatchObject({ state: "hidden", moderationNote: null })
    expect(await stack.first("select moderation_note from client_reviews where id = $1", [review.id])).toEqual({ moderation_note: null })

    const later = await insertReviewAt(client.userId, "2021-07-15T00:00:00Z", 2, "Written after erasure.")
    expect(await stack.first("select comment from client_reviews where id = $1", [later])).toEqual({ comment: null })
    expect(await stack.first("select comment, moderation_note from client_reviews where id = $1", [kept.id])).toEqual({
      comment: "Helpful and polite.",
      moderation_note: "Shared with the team.",
    })
  })

  test("counts the review month in IST, so a review at 23:59:59 IST on the last day and one at midnight are different months", async () => {
    const owner = (await stack.seedUser()).id
    const july = await insertReviewAt(owner, "2021-07-31T18:29:59Z", 4, null)
    const august = await insertReviewAt(owner, "2021-07-31T18:30:00Z", 4, null)
    const months = await stack.pool.query<{ id: string; month: string }>(
      "select id, review_month::text as month from client_reviews where user_id = $1 order by created_at",
      [owner],
    )
    expect(months.rows).toEqual([
      { id: july, month: "2021-07-01" },
      { id: august, month: "2021-08-01" },
    ])
    const insert = "insert into client_reviews (user_id, rating, created_at) values ($1, 4, $2::timestamptz)"
    expect(await refusedByDatabase(insert, [owner, "2021-08-31T18:29:59.999999Z"])).toBe(true)
    expect(await refusedByDatabase(insert, [owner, "2021-08-31T18:30:00Z"])).toBe(false)
  })
})
