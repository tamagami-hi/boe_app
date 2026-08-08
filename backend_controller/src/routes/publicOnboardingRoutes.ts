/**
 * Public onboarding routes (spec 04 §3.1). Unauthenticated signup surface:
 * `POST /newuser` and `POST /newuser/verify-email`.
 *
 * ── /newuser ────────────────────────────────────────────────────────────────
 * The marketing site is a separate application on separate infrastructure
 * (beonedge.in on AWS) and posts new signups straight here, reachable publicly
 * as `https://dev-app.beonedge.in/api/newuser`. It is the only signup door: the
 * former `/v1/applications` pair demanded an `Idempotency-Key` header and the
 * exact current version string of both consent documents, which would force
 * that site to make two calls and track a contract it has no other reason to
 * know. `/newuser` resolves the live consent versions itself and derives its
 * own idempotency key, so the caller sends one flat body once.
 *
 * That site is the ONLY caller permitted to create signups, and it proves this
 * with a shared secret in `x-signup-key` (see `assertSignupCaller`). The call is
 * server-to-server: no browser is involved, so CORS is irrelevant to it and this
 * API is deliberately absent from the marketing site's origin allowlist.
 *
 * It stays a thin adapter over the `submitApplication` command rather than a
 * second implementation — validation, consent recording, verification-email
 * dispatch and audit all live in one place, and the admin approvals queue sees
 * identical rows regardless of how a signup arrived.
 *
 * The path is deliberately unversioned: it is a cross-team integration point,
 * whereas `/v1` is an internal contract free to evolve.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import { bytesEqual } from "../crypto/primitives.js"
import type { BreachChecker } from "../auth/breachCheck.js"
import { hashPassword, passwordInputSchema } from "../auth/passwordHasher.js"
import type { UnitOfWork } from "../db/database.js"
import type {
  ConsentKind,
  IdempotencyRepository,
  IdempotencyScope,
} from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { ApplicationWriteRepository } from "../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { ConsentRepositoryImpl } from "../repositories/consentRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { VerificationTokenWriteRepository } from "../repositories/verificationTokenRepository.js"
import { submitApplication, type SubmitApplicationOutcome } from "../domain/onboarding/submitApplication.js"
import { verifyApplicationEmail } from "../domain/onboarding/verifyApplicationEmail.js"

export interface PublicOnboardingConfig {
  readonly verificationTokenTtlMs: number
  readonly idempotencyTtlMs: number
  readonly sesConfigurationSet: string
  /** Cooldown between verification mails for one application. See submitApplication. */
  readonly verificationResendCooldownMs: number
  /**
   * The secret the marketing site presents in `x-signup-key`. `null` means the
   * deployment was never given one, and every `/newuser` call is refused.
   */
  readonly signupSharedSecret: string | null
}

export interface PublicOnboardingDeps {
  readonly database: Kysely<Database>
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly crypto: CryptoContext
  /**
   * Same breached-password check the activation command uses. Applied here
   * because this is now where the password is chosen, and the check has to
   * happen while the applicant is still on the form and able to pick another
   * one — refusing at approval time would strand them.
   */
  readonly breachChecker: BreachChecker
  readonly config: PublicOnboardingConfig
  readonly applicationRepository: ApplicationWriteRepository
  readonly consentRepository: ConsentRepositoryImpl
  readonly verificationTokenRepository: VerificationTokenWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const CONSENT_KINDS: readonly ConsentKind[] = ["terms", "privacy"]

/**
 * The `/newuser` gate. Only the marketing site may create signups, and it is a
 * server-to-server caller with no browser involved, so the only thing that can
 * actually identify it is a secret it holds. `Origin`/`Referer` are not used:
 * a non-browser client sets them to anything it likes, so treating them as
 * proof of caller identity would be authentication theatre.
 *
 * Fails closed in both directions — an unconfigured secret refuses everyone
 * rather than admitting everyone, and the comparison is constant-time so a
 * caller cannot learn the secret byte-by-byte from response timing.
 */
const assertSignupCaller = (deps: PublicOnboardingDeps, request: FastifyRequest): void => {
  const expected = deps.config.signupSharedSecret
  if (expected === null) {
    // Deliberately not AUTHENTICATION_REQUIRED: nothing the caller sends could
    // succeed, and an operator reading the logs needs to see a misconfiguration
    // rather than a stream of apparently-bad credentials.
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }

  const header = request.headers["x-signup-key"]
  const presented = Array.isArray(header) ? header[0] : header
  if (typeof presented !== "string") throw new AppError("AUTHENTICATION_REQUIRED")

  // bytesEqual is length-checked before the constant-time compare, so a wrong
  // length is rejected without timingSafeEqual throwing on mismatched buffers.
  if (!bytesEqual(Buffer.from(presented, "utf8"), Buffer.from(expected, "utf8"))) {
    throw new AppError("AUTHENTICATION_REQUIRED")
  }
}

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u)

const verifyEmailBodySchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict()

/**
 * What the external marketing site posts. Same person-level fields as
 * `/v1/applications`, but consent is a single boolean: the versions in force are
 * the backend's own business, and a remote site echoing a version string back is
 * a chance for those two to drift.
 *
 * `acceptedConsents` is `z.literal(true)` for the same reason the per-document
 * flag is — a refusal is not a submission to record, it is a form that was never
 * completed.
 *
 * `password` is the password the applicant will later sign in to the app with.
 * It is validated by the same `passwordInputSchema` the activation command uses,
 * so the rule the form must satisfy and the rule the credential must satisfy
 * cannot drift apart. There is no `confirmPassword` here: re-entry is a typo
 * guard for the person filling the form, so it is checked where the two boxes
 * exist and never travels over the wire.
 */
const newUserBodySchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .refine((value) => [...value].length >= 2 && [...value].length <= 120, "must be 2 to 120 characters")
      .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "must not contain control characters"),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(8).max(32),
    password: passwordInputSchema,
    acceptedConsents: z.literal(true),
    /**
     * Optional caller-supplied key. When the site can generate one it gets true
     * retry safety across differing payloads; when it cannot, the derived key
     * below still collapses duplicate submissions of the *same* details.
     */
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()

const normalizePhone = (raw: string): string => {
  const candidate = raw.replace(/[\s()-]/gu, "")
  if (!/^\+[1-9][0-9]{7,14}$/u.test(candidate)) {
    throw new AppError("VALIDATION_FAILED", { fields: { phone: ["must be a valid E.164 phone number"] } })
  }
  return candidate
}

const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

/**
 * What `/newuser` answers, derived from the submission's outcome.
 *
 * `accepted` keeps its original meaning — a new application was created — so a
 * caller that only ever read that field is not silently given a new one.
 * `outcome` is the field to branch on, and `verificationEmailQueued` is the one
 * that decides whether to tell the visitor to check their inbox.
 *
 * "Queued", not "sent": this call writes an `email_deliveries` row and the outbox
 * worker delivers it seconds later. Promising a send here would be the same lie
 * the old unconditional `accepted: true` told.
 */
interface NewUserResponse {
  readonly status: number
  readonly body: {
    readonly accepted: boolean
    readonly outcome: SubmitApplicationOutcome["kind"]
    readonly verificationEmailQueued: boolean
  }
}

/*
 * 202 when work was taken on (a row written, a mail queued); 200 when the request
 * was understood and deliberately produced nothing. Both are 2xx, so a caller
 * that only checks the status class is unaffected.
 */
const responseFor = (outcome: SubmitApplicationOutcome): NewUserResponse => {
  switch (outcome.kind) {
    case "created":
      return { status: 202, body: { accepted: true, outcome: "created", verificationEmailQueued: true } }
    case "verification_resent":
      return {
        status: 202,
        body: { accepted: false, outcome: "verification_resent", verificationEmailQueued: true },
      }
    case "duplicate_pending":
      return {
        status: 200,
        body: { accepted: false, outcome: "duplicate_pending", verificationEmailQueued: false },
      }
    case "duplicate_account":
      return {
        status: 200,
        body: { accepted: false, outcome: "duplicate_account", verificationEmailQueued: false },
      }
  }
}

/**
 * Run a submission through the idempotency protocol and `submitApplication`.
 *
 * Shared by both doors so there is exactly one place that decides what a signup
 * writes. `routeTemplate` differs per door on purpose: the two are separate
 * idempotency namespaces, so a key reused across them cannot collide.
 */
const submitThroughIdempotency = async (
  deps: PublicOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  input: Readonly<{
    routeTemplate: string
    idempotencyKey: string
    fullName: string
    emailNormalized: string
    phoneE164: string
    passwordHash: string | null
    consents: readonly Readonly<{ kind: ConsentKind; version: string }>[]
  }>,
): Promise<FastifyReply> => {
  const scope: IdempotencyScope = {
    actorScope: "public",
    actorScopeKeyVersion: null,
    candidateActorScopes: ["public"],
    method: "POST",
    routeTemplate: input.routeTemplate,
    key: input.idempotencyKey,
  }
  /*
   * The password is deliberately absent from the request hash. Argon2id salts
   * every hash, so including it would make two identical retries look like two
   * different requests and turn an ordinary retry into IDEMPOTENCY_KEY_REUSED.
   * Hashing the plaintext instead would put a second, unsalted digest of the
   * password in the idempotency table, which is exactly the artefact this design
   * avoids elsewhere. The identity fields already distinguish one signup from
   * another; a retry that changes only the password replays the first answer,
   * which is the correct behaviour for a duplicate submission.
   */
  const requestHash = hashRequest({
    fullName: input.fullName,
    email: input.emailNormalized,
    phone: input.phoneE164,
    consents: input.consents,
  })
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<NewUserResponse["body"]>({
      repository: deps.idempotencyRepository,
      tx,
      scope,
      requestHash,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const submitted = await submitApplication(
          tx,
          {
            applicationRepository: deps.applicationRepository,
            consentRepository: deps.consentRepository,
            verificationTokenRepository: deps.verificationTokenRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            outboxRepository: deps.outboxRepository,
            auditRepository: deps.auditRepository,
            crypto: deps.crypto,
            clock: deps.clock,
            config: {
              verificationTokenTtlMs: deps.config.verificationTokenTtlMs,
              sesConfigurationSet: deps.config.sesConfigurationSet,
              verificationResendCooldownMs: deps.config.verificationResendCooldownMs,
            },
          },
          {
            fullName: input.fullName,
            emailNormalized: input.emailNormalized,
            phoneE164: input.phoneE164,
            passwordHash: input.passwordHash,
            consents: input.consents.map((consent) => ({ ...consent })),
            requestId: request.requestId,
            clientIp: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
        )
        return responseFor(submitted)
      },
    }),
  )

  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

/**
 * `POST /newuser` — the door the external marketing site uses.
 *
 * Unversioned path on purpose: it is a stable integration point for a system
 * outside this repository, and the `/v1` prefix is an internal contract that
 * evolves with the app. Changing this path means coordinating a deploy with
 * another team's infrastructure, so it should not move.
 */
const handleNewUser = async (
  deps: PublicOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  // Before validation: an unauthenticated caller learns nothing about the body
  // contract, and a rejected request never touches the database.
  assertSignupCaller(deps, request)

  const body = parseOrThrow(newUserBodySchema, request.body)
  const emailNormalized = body.email.toLowerCase()
  const phoneE164 = normalizePhone(body.phone)

  // Whatever is in force right now, read inside the request rather than cached:
  // a consent version that changed between publication and signup must be the
  // version actually recorded against this person.
  const documents = await deps.consentRepository.findCurrentDocuments(deps.database, CONSENT_KINDS)
  const consents = CONSENT_KINDS.map((kind) => {
    const document = documents.find((candidate) => candidate.kind === kind)
    if (document === undefined) {
      // No published consent document means nobody can lawfully be onboarded.
      // Fail loudly rather than recording a signup with no consent trail.
      throw new AppError("DEPENDENCY_UNAVAILABLE")
    }
    return { kind, version: document.version }
  })

  /*
   * Derived key when the caller supplies none: the same details submitted twice
   * (double-tapped button, a retry after a timed-out response) collapse into one
   * application instead of two, and the second call replays the first answer.
   * Scoped by consent versions too, so a genuine re-signup after new terms is a
   * distinct submission. The password is excluded for the reason given on
   * `requestHash`.
   *
   * ── WHY THE GENERATION IS IN HERE ─────────────────────────────────────────
   * The key used to cover the identity alone, and the idempotency record lives
   * for 24 hours — longer than it takes an admin to reject an application. So a
   * rejected applicant who reapplied the same day hashed to the record written by
   * the submission that had just been rejected, and got a replayed `202` with no
   * row created, no mail sent, and nothing to show them why.
   *
   * The password's absence from the key made it a trap rather than a delay: the
   * breach screen refuses a compromised password, so the natural response is to
   * try another one — which changes nothing the key covers, and lands straight
   * back on the replay. There was no input the applicant could vary to escape it.
   *
   * `countTerminalSubmissions` advances on every decision, so a post-rejection
   * attempt derives a different key and executes properly. It counts terminal
   * rows only, so it cannot move while a submission is in flight, which is
   * exactly when the collapsing behaviour is wanted.
   *
   * Read outside the transaction, like the consent lookup above. Two concurrent
   * submissions therefore read the same generation and collapse into one — the
   * intended outcome.
   */
  const submissionGeneration = await deps.applicationRepository.countTerminalSubmissions(deps.database, {
    emailNormalized,
    phoneE164,
  })

  const derivedKey = createHash("sha256")
    .update(
      JSON.stringify({
        emailNormalized,
        phoneE164,
        fullName: body.fullName,
        consents,
        submissionGeneration,
      }),
    )
    .digest("hex")
    .slice(0, 64)

  /*
   * Both of these run before the transaction opens. The breach check is a network
   * call to a third party and Argon2id is deliberately expensive; doing either
   * while holding a write transaction would put that latency inside the lock. A
   * breached password fails here, so nothing is written and the applicant is
   * still on the form and able to choose another.
   */
  await deps.breachChecker.check(body.password)
  const passwordHash = await hashPassword(body.password)

  return submitThroughIdempotency(deps, request, reply, {
    routeTemplate: "/newuser",
    idempotencyKey: body.idempotencyKey ?? derivedKey,
    fullName: body.fullName,
    emailNormalized,
    phoneE164,
    passwordHash,
    consents,
  })
}

export const registerPublicOnboardingRoutes = (
  application: FastifyInstance,
  deps: PublicOnboardingDeps,
): void => {
  application.post("/newuser", async (request, reply) => handleNewUser(deps, request, reply))

  /*
   * The token emailed to a new signup. The marketing site hosts the page the
   * link opens and calls this to redeem the token, so it lives under the same
   * unversioned external prefix as /newuser rather than under /v1.
   *
   * Deliberately NOT behind the x-signup-key gate that /newuser uses. The
   * difference is what authenticates the request. /newuser accepts entirely
   * attacker-chosen input, so it needs to know who is calling. Here the token
   * IS the credential: 43 random characters, single-use, expiring, and issued by
   * this backend to one mailbox. Requiring a shared secret on top would buy no
   * security and would force the marketing site to redeem tokens server-side —
   * meaning if it ever chose to redeem from the browser instead, the secret
   * would have to ship in client JavaScript, which is strictly worse than not
   * having one.
   */
  application.post("/newuser/verify-email", async (request, reply) => {
    const body = parseOrThrow(verifyEmailBodySchema, request.body)
    await deps.unitOfWork.execute((tx) =>
      verifyApplicationEmail(
        tx,
        {
          applicationRepository: deps.applicationRepository,
          verificationTokenRepository: deps.verificationTokenRepository,
          auditRepository: deps.auditRepository,
          crypto: deps.crypto,
          clock: deps.clock,
        },
        { token: body.token, requestId: request.requestId },
      ),
    )
    return reply.sendData({ verified: true }, { status: 200 })
  })
}
