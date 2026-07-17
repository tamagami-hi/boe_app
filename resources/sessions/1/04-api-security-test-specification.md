# First-Slice API, Security, Email, and Test Specification

## 1. Purpose and binding decisions

This document is the implementation contract for the first vertical slice:
public learner application, email verification, admin review, approval or
rejection, activation invitation delivery, Android account activation, native
sign-in, browser-admin sign-in, refresh, logout, and delivery inspection.

The public experience continues to say **learner signup** and **join
BeOnEdge**. It must not expose internal approval, KYC, risk, or investing
eligibility terminology. Persistence deliberately records an application, not
an authenticated learner. Approval creates the learner identity; activation
creates the credential.

The following decisions are fixed:

- All 18 first-slice business/API routes remain under `/v1` and use the
  envelope in this document. Operational health endpoints are unversioned and
  outside the first-slice route inventory.
- Zod schemas are the only authored HTTP contract. Database types and UI types
  do not substitute for boundary validation.
- PostgreSQL bigint and numeric business values are JSON strings.
- Web admin auth uses cookies and a synchronizer CSRF token. Native auth uses a
  bearer access token and an opaque refresh token in native secure storage.
- Email is sent only by a backend outbox worker through Amazon SES v2.
- Amazon SNS notifications are accepted only after signature and topic
  validation.
- First-slice mutations named below use database-backed idempotency.
- No token, password, cookie, authorization header, raw email address, full
  phone number, or provider signature is logged.

## 2. Shared wire contract

### 2.1 Scalar schemas

Define these once in the shared contract package:

| Name | Zod-compatible definition | Wire representation |
|---|---|---|
| Uuid | z.string().uuid() | UUID string |
| IsoDateTime | z.string().datetime({ offset: true }) | UTC ISO-8601 with Z suffix on output |
| EmailInput | z.string().trim().email().max(254) | Input only; backend normalizes domain and case-folds the full address for lookup |
| MaskedEmail | z.string().max(254) plus canonical-output refinement | First Unicode scalar of normalized local part, then exactly `***@`, then lowercase normalized domain |
| PhoneInput | z.string().trim().min(8).max(32) | Input only; backend parses and persists normalized E.164 |
| FullName | trimmed string, 2 to 120 Unicode code points, no C0/C1 control characters | UTF-8 string; maps directly to applications.full_name without first/last-name inference |
| ReasonCode | z.string().trim().regex(/^[a-z][a-z0-9_]{2,63}$/) | Stable internal reason code |
| ReasonDetail | trimmed string, 1 to 2000 Unicode code points | Optional admin explanation |
| VersionTag | z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/) | Version string |
| IdempotencyKey | z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/) | Idempotency-Key header |
| Cursor | z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/) | Opaque base64url server cursor |
| Paise | z.string().regex(/^(0|[1-9][0-9]*)$/) | Non-negative integer paise; never JSON number |
| Decimal24x8 | z.string().regex(/^-?(0|[1-9][0-9]*)([.][0-9]{1,8})?$/) | PostgreSQL numeric(24,8), canonical output with eight fractional digits |
| Decimal30x12 | z.string().regex(/^-?(0|[1-9][0-9]*)([.][0-9]{1,12})?$/) | PostgreSQL numeric(30,12), canonical output with twelve fractional digits |

Zod objects are strict. Unknown request keys produce VALIDATION_FAILED. Output
schemas also parse every handler result before it is serialized. Passwords are
not trimmed, normalized, or logged; PasswordInput is a string of 12 to 128
Unicode code points, rejects NUL/control characters, and requires a breached
password check during activation and password changes.

`MaskedEmail` is output-only and is derived before any ciphertext purge from
the normalized address: reveal exactly the first Unicode scalar of the local
part, append `***@`, and append the complete lowercase IDNA-ASCII domain. For
example, the local part is never otherwise exposed, including when it has one
scalar. The persisted value must equal this deterministic derivation; callers
cannot submit it. Output fixtures cover ASCII/Unicode local parts and reject
values that reveal any additional local-part scalar.

### 2.2 Envelope

Every JSON endpoint except the SNS webhook returns exactly one of:

~~~ts
type EnvelopeMeta = {
  requestId: string
  timestamp: string
  idempotencyReplay?: boolean
}

type SuccessEnvelope<T, M extends object = {}> = {
  ok: true
  data: T
  error: null
  meta: EnvelopeMeta & Omit<M, keyof EnvelopeMeta>
}

type ErrorEnvelope = {
  ok: false
  data: null
  error: {
    code: ErrorCode
    message: string
    fields?: Record<string, string[]>
    retryable: boolean
  }
  meta: EnvelopeMeta
}
~~~

Rules:

- requestId is a UUID generated at ingress or a valid incoming X-Request-Id.
- timestamp is server time.
- fields is present only for request validation and uses public field paths.
- Messages are user-safe and contain no SQL, stack, provider response, account
  existence, token, or internal identifier not already returned by the route.
- 204 is not used; logout returns a normal success envelope.
- The SNS endpoint returns an empty 200 response after durable insertion and an
  empty 4xx/5xx response on rejection so AWS does not parse an application
  envelope.

### 2.3 Numeric and temporal serialization

- PostgreSQL bigint, numeric, money-like values, NAV, units, tax, and rates are
  read through string parsers and returned as JSON strings.
- JavaScript Number is allowed only for bounded counters and versions validated
  as safe integers, such as page limit, attempt count, and row version.
- Clients use a decimal library for arithmetic and keep the source string for
  display or submission. parseFloat, Number, unary plus, and implicit numeric
  coercion are forbidden for business values.
- Timestamps are timestamptz in PostgreSQL and UTC ISO strings on the wire.
  Date-only business values use YYYY-MM-DD and PostgreSQL date.

### 2.4 Stable errors

| HTTP | Code | Retryable | Meaning |
|---:|---|:---:|---|
| 400 | VALIDATION_FAILED | no | Body, query, path, or header failed its schema |
| 400 | CURSOR_INVALID | no | Cursor is malformed, expired, or does not match filters |
| 400 | TOKEN_INVALID | no | Verification or activation token is malformed or unknown |
| 401 | AUTHENTICATION_REQUIRED | no | Required web or native auth is absent |
| 401 | INVALID_CREDENTIALS | no | Login identifier or password is invalid; never reveal which |
| 401 | SESSION_INVALID | no | Refresh token is invalid, expired, revoked, or reused |
| 401 | SNS_SIGNATURE_INVALID | no | SNS signature, certificate, topic, or message provenance failed |
| 403 | AUTHORIZATION_DENIED | no | Principal lacks a required permission |
| 403 | ACCOUNT_NOT_ACTIVE | no | The authenticated account is not active |
| 403 | CSRF_INVALID | no | CSRF token, Origin, Referer, or Fetch Metadata check failed |
| 404 | RESOURCE_NOT_FOUND | no | Authorized caller cannot access the resource |
| 409 | ACTIVE_APPLICATION_EXISTS | no | Normalized email or phone already has an active application/account |
| 409 | STATE_CONFLICT | yes | Expected version or lifecycle guard no longer matches |
| 409 | IDEMPOTENCY_KEY_REUSED | no | Same scope/key was used with a different canonical request hash |
| 409 | IDEMPOTENCY_IN_PROGRESS | yes | Equivalent request is still executing; Retry-After: 1 |
| 409 | TOKEN_ALREADY_USED | no | Single-use token was consumed or revoked |
| 410 | TOKEN_EXPIRED | no | Validly formed token is past expiresAt |
| 413 | PAYLOAD_TOO_LARGE | no | Body exceeds route limit |
| 415 | UNSUPPORTED_MEDIA_TYPE | no | Expected application/json or SNS text/plain body was not supplied |
| 429 | RATE_LIMITED | yes | Caller exceeded a route policy; include Retry-After |
| 500 | INTERNAL_ERROR | yes | Unexpected server failure |
| 503 | DEPENDENCY_UNAVAILABLE | yes | Required database, deployment-injected key/configuration, or provider dependency is unavailable |

Unique-constraint, serialization, and guarded-update failures must be translated
to the stable code above. They must never leak PostgreSQL error text.

The enum in this section is the canonical public ErrorCode. Domain and
repository results map explicitly as follows; handlers must not serialize their
internal names:

| Internal outcome | Public code |
|---|---|
| VALIDATION_ERROR | VALIDATION_FAILED |
| APPLICATION_ACTIVE_DUPLICATE | successful generic 202 accepted response; never an error |
| TOKEN_INVALID_OR_EXPIRED | TOKEN_INVALID when unknown/malformed, TOKEN_EXPIRED when a matching token is expired, TOKEN_ALREADY_USED when consumed/revoked |
| UNAUTHENTICATED | AUTHENTICATION_REQUIRED |
| BAD_CREDENTIALS | INVALID_CREDENTIALS |
| SESSION_REVOKED, REFRESH_REUSE, SESSION_EXPIRED | SESSION_INVALID |
| FORBIDDEN | AUTHORIZATION_DENIED |
| CSRF_MISMATCH, ORIGIN_DENIED, FETCH_SITE_DENIED | CSRF_INVALID |
| NOT_FOUND, WRONG_OWNER | RESOURCE_NOT_FOUND |
| INVALID_STATE_TRANSITION, VERSION_CONFLICT, RESOURCE_BUSY, PRECONDITION_FAILED | STATE_CONFLICT |
| IDEMPOTENCY_HASH_MISMATCH | IDEMPOTENCY_KEY_REUSED |
| IDEMPOTENCY_LOCK_BUSY | IDEMPOTENCY_IN_PROGRESS |
| SNS_PROVENANCE_FAILED | SNS_SIGNATURE_INVALID |
| RATE_LIMIT_EXCEEDED | RATE_LIMITED |
| DATABASE_UNAVAILABLE, KEY_CONFIGURATION_UNAVAILABLE, PROVIDER_UNAVAILABLE | DEPENDENCY_UNAVAILABLE |

ACTIVE_APPLICATION_EXISTS remains reserved in the enum for authenticated
future workflows but is forbidden on public learner signup. Unexpected
constraint names, provider codes, and exceptions map to INTERNAL_ERROR after
redacted logging.

## 3. Exact first-slice routes

All request body definitions below are strict. Optional means the key may be
absent, not null. Responses show data only; the common envelope wraps them.
Every ordinary JSON route has a hard `MAX_JSON_BODY_BYTES = 65_536` limit on
raw received bytes, enforced before JSON parsing; an oversized body returns
`413 PAYLOAD_TOO_LARGE`. The signed SNS route keeps its separate 256 KiB raw
body limit.

The OpenAPI route inventory is:

| Method and path | Transport | Idempotency |
|---|---|---|
| GET /v1/public/consent-documents | Public | No |
| POST /v1/applications | Public | Required |
| POST /v1/applications/verify-email | Public token | Token is single-use boundary |
| GET /v1/admin/applications | Web cookie | No |
| GET /v1/admin/applications/:applicationId | Web cookie | No |
| POST /v1/admin/applications/:applicationId/review | Web cookie + CSRF | Required |
| POST /v1/admin/applications/:applicationId/decision | Web cookie + CSRF | Required |
| POST /v1/admin/users/:userId/activation-invites/resend | Web cookie + CSRF | Required |
| GET /v1/admin/email-deliveries | Web cookie | No |
| POST /v1/activations/complete | Installed Capacitor Android client plus activation token | Native-only single-use boundary; browser/web requests are rejected |
| POST /v1/auth/native/login | Native | No secret response persistence |
| POST /v1/auth/native/refresh | Native refresh token + rotationId | Deterministic rotation protocol |
| POST /v1/auth/native/logout | Native bearer | Naturally idempotent |
| POST /v1/auth/web/login | Web | No secret response persistence |
| GET /v1/auth/web/csrf | Web access or refresh cookie; no prior CSRF | No |
| POST /v1/auth/web/refresh | Web refresh cookie + CSRF + rotationId | Deterministic rotation protocol |
| POST /v1/auth/web/logout | Web cookie + CSRF | Naturally idempotent |
| POST /v1/provider-events/aws-sns | Signed AWS SNS raw body | SNS MessageId inbox uniqueness |

This inventory is exhaustive for the first slice. There is no public
withdrawal route: `withdrawApplication` is an authenticated
onboarding/internal-support application command only, accepts applicant-request
evidence and a reason, permits only `pending_email_verification` or `submitted`,
revokes outstanding verification tokens, and conflicts after review begins.
Courses, membership plans, FAQs, general content authoring, and financial
routes remain later slices; only immutable terms/privacy consent documents are
first-slice content.

### 3.1 Public learner signup

#### GET /v1/public/consent-documents

No authentication. Returns the current published terms and privacy documents:

~~~ts
{
  items: [{
    kind: z.enum(["terms", "privacy"]),
    version: VersionTag,
    publicPath: z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/),
    contentMarkdown: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }]
}
~~~

The consent_documents table is authoritative. Exactly one current published
document per kind is returned. `publicPath` is the immutable normalized
same-origin site path stored by that row, `contentMarkdown` is its exact
authoritative UTF-8 Markdown, and `sha256` is the digest of those bytes. The
landing form renders that content at the returned path and submits its displayed
version. Configuration, an external URL, or client constants cannot define
consent content, path, digest, or version.

Consent publication and rendering use a fixed safe Markdown profile. Raw HTML,
embedded images, iframes, SVG, CSS, script, event-handler syntax, and data/blob/
javascript/vbscript/file URL schemes are rejected at publication. Links may be
same-origin absolute paths, `https:`, or `mailto:` only; the renderer adds
`rel="noopener noreferrer"` to external links. The landing renderer parses with
raw HTML disabled, escapes all text/attribute output, and sanitizes the produced
tree against the same element/attribute/scheme allowlist before insertion; it
never uses unsanitized `innerHTML` or a framework HTML escape hatch.

Every landing/admin HTML response uses a per-response nonce and this exact CSP
shape, substituting only the configured HTTPS API origin and nonce:
`default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; script-src 'self' 'nonce-<nonce>' 'strict-dynamic'; style-src
'self' 'nonce-<nonce>'; img-src 'self' data:; font-src 'self'; connect-src 'self'
<https-api-origin>; upgrade-insecure-requests`. It also sends
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, and
`Cross-Origin-Opener-Policy: same-origin`. Email HTML templates use contextual
escaping for every substituted value, construct links with the URL API and an
allowlisted HTTPS origin, and never interpolate raw HTML supplied by a user.

#### POST /v1/applications

Headers: Content-Type: application/json and required Idempotency-Key.

Request:

~~~ts
{
  fullName: FullName,
  email: EmailInput,
  phone: PhoneInput,
  consents: [
    {
      kind: z.enum(["terms", "privacy"]),
      version: VersionTag,
      accepted: z.literal(true)
    }
  ]
}
~~~

There must be exactly one terms and one privacy item. In the submission
transaction the server locks and resolves the corresponding current published
consent_documents rows and rejects stale or unknown versions. It copies the
authoritative consent_document_id into application_consents; the immutable
consent_documents row carries its version and content SHA-256. The request is
evidence of what the user saw, never the authority. Server time,
an HMAC-SHA-256 of the canonical client IP using the current dedicated
consent-IP HMAC key and its persisted version, and a truncated user-agent are recorded; raw IP is not retained in
application consent evidence and client timestamps are not accepted.

fullName maps unchanged after trimming and validation to applications.full_name.
The server must not split, infer, or require first and last names.

Success: 202.

~~~ts
{ accepted: z.literal(true) }
~~~

The response never contains an application ID, state, expiry, duplicate flag,
or identifier-specific outcome. A new submission and every duplicate active
email/phone combination return the same status, body shape, and comparable
work. Internally, unique constraints deterministically identify a duplicate:

- A new identifier pair creates the application, authoritative consent
  evidence, verification token, delivery, outbox, and audit rows atomically.
- A duplicate still pending email verification may enqueue a new verification
  delivery only when the last verification delivery is at least 15 minutes old.
  The transaction revokes the prior pending verification token and creates one
  successor. Inside the cooldown it makes no email change.
- A duplicate active record in submitted, in_review, or approved state creates
  no token or delivery. Rejected and withdrawn records are inactive and do not
  block a later new signup; their retained/tombstoned PII still cannot be used
  to reveal the prior outcome. An email matching one active record and a phone
  matching another creates no delivery and emits a redacted security metric.
- Database uniqueness races are caught and passed through this same duplicate
  branch; ACTIVE_APPLICATION_EXISTS is an internal domain outcome and is never
  returned from this public route.

The public CTA is exactly “Join BeOnEdge”. Success copy is “If these details can
be used to continue signup, check your email.” Public pages, native client copy,
analytics names visible to users, and email-verification copy must not say
application, applicant, approval, KYC, risk, or investing eligibility.

#### POST /v1/applications/verify-email

Headers: Content-Type: application/json. No idempotency header; token use is the
idempotency key.

Request:

~~~ts
{ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }
~~~

Success: 200.

~~~ts
{ verified: z.literal(true) }
~~~

First valid use consumes the token and moves the application to submitted in
one transaction, but the public response exposes no application ID or internal
state. Exact replay returns 409 TOKEN_ALREADY_USED. An expired token returns
410 TOKEN_EXPIRED. Public success copy is “Email verified.” and contains no
application/approval wording.

### 3.2 Admin application and delivery operations

All admin routes require the web-cookie transport and the permissions shown in
section 4.5. Unsafe methods additionally require X-CSRF-Token.

#### GET /v1/admin/applications

Query:

~~~ts
{
  status?: z.enum([
    "submitted", "in_review", "approved", "rejected", "withdrawn"
  ]),
  createdFrom?: IsoDateTime,
  createdTo?: IsoDateTime,
  after?: Cursor,
  limit?: z.coerce.number().int().min(1).max(100).default(25)
}
~~~

createdFrom must be earlier than createdTo and the interval may not exceed 366
days. There is no free-text search in the first slice. Sort is createdAt DESC,
applicationId DESC. The named item schema is:

~~~ts
const ApplicationListItem = z.object({
    applicationId: Uuid,
    fullName: FullName,
    email: EmailInput,
    phone: z.union([
      z.string().regex(/^[+][1-9][0-9]{7,14}$/),
      z.string().regex(/^tombstone:[0-9a-f-]{36}$/)
    ]),
    isPiiTombstoned: z.boolean(),
    status: z.enum([
      "submitted", "in_review", "approved", "rejected", "withdrawn"
    ]),
    emailVerifiedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
    version: z.number().int().positive()
})

{ items: z.array(ApplicationListItem) }
~~~

The output schema adds a strict cross-field refinement. When
`isPiiTombstoned` is false, phone must be E.164 and the ordinary validated
name/email rules apply. When true, `fullName` is exactly `Tombstoned`, email is
exactly `tombstone+<applicationId-without-hyphens>@invalid.example`, and phone
is exactly `tombstone:<applicationId>`. `emailVerifiedAt` may be null only for
a retained `withdrawn` application that never passed verification. This lets
authorized history reads serialize retained rows without weakening public
input validation.

Envelope meta adds page: { nextCursor: Cursor.nullable(), limit, hasMore }.
The cursor is an authenticated, opaque encoding of sort values, route, filter
hash, and a 24-hour expiry. A cursor cannot be reused with changed filters.

#### GET /v1/admin/applications/:applicationId

Path applicationId is Uuid. Query is bounded independently for the nested
delivery page:

~~~ts
{
  deliveryAfter?: Cursor,
  deliveryLimit?: z.coerce.number().int().min(1).max(100).default(25)
}
~~~

The embedded application-scoped delivery projection is always strict-safe:

~~~ts
const ApplicationDeliverySummary = z.object({
  emailDeliveryId: Uuid,
  templateKey: z.enum([
    "verify_email", "activation_invite", "application_rejected"
  ]),
  recipientMasked: MaskedEmail,
  state: z.enum([
    "queued", "sending", "sent", "delivered",
    "retryable_failed", "permanent_failed", "cancelled"
  ]),
  attemptCount: z.number().int().min(0).max(8),
  lastErrorCode: z.string().max(80).nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime
})
~~~

It excludes every subject/token/invite/outbox ID except its own delivery ID,
all SES/provider fields, ciphertext, nonce, HMAC, key version, and raw failure
detail. Path applicationId is Uuid. Success includes:

~~~ts
{
  application: ApplicationListItem,
  consents: [{
    kind: z.enum(["terms", "privacy"]),
    version: VersionTag,
    acceptedAt: IsoDateTime
  }],
  reviews: [{
    reviewId: Uuid,
    decision: z.enum(["approved", "rejected"]),
    reasonCode: ReasonCode,
    reasonDetail: ReasonDetail.nullable(),
    reviewerUserId: Uuid,
    decidedAt: IsoDateTime
  }],
  deliveries: {
    items: z.array(ApplicationDeliverySummary),
    page: {
      nextCursor: Cursor.nullable(),
      limit: z.number().int().min(1).max(100),
      hasMore: z.boolean()
    }
  }
}
~~~

This route requires `applications.read` plus either `email_deliveries.read` or
`email_deliveries.read_masked`; both permission paths receive only this embedded
strict-safe projection. Repository rows are mapped explicitly and are never
serialized as wire data.

#### POST /v1/admin/applications/:applicationId/review

Headers: required Idempotency-Key and X-CSRF-Token.

~~~ts
{ expectedVersion: z.number().int().positive() }
~~~

Success: 200.

~~~ts
{
  applicationId: Uuid,
  status: z.literal("in_review"),
  version: z.number().int().positive(),
  reviewStartedAt: IsoDateTime
}
~~~

Only submitted may enter in_review. The command requires
applications.review, locks the application, records reviewer identity and
reviewStartedAt, increments version, and appends audit evidence atomically. A
second or stale review claim returns STATE_CONFLICT. Starting review does not
create an application_reviews decision row.

#### POST /v1/admin/applications/:applicationId/decision

Headers: required Idempotency-Key and X-CSRF-Token.

Query contains outcome=z.enum(["approved", "rejected"]). The strict body is:

~~~ts
{
  reasonCode: ReasonCode,
  reasonDetail: ReasonDetail.optional()
}
~~~

The current application version is carried in required If-Match as a quoted
positive integer, for example If-Match: "3". This keeps the decision body
exactly the reason evidence persisted by application_reviews.

Success: 200.

~~~ts
{
  applicationId: Uuid,
  status: z.enum(["approved", "rejected"]),
  version: z.number().int().positive(),
  userId: Uuid.optional(),
  activationInviteId: Uuid.optional(),
  emailDeliveryId: Uuid,
  decidedAt: IsoDateTime
}
~~~

Both outcomes require in_review, verified email, the If-Match version, and no
prior decision. Approval atomically creates exactly one user, invite, review,
audit event, activation outbox event, and activation delivery. Rejection
atomically creates the review, audit event, rejection-email outbox event, and
rejection delivery; it creates no user, credential, session, or invite.
userId and activationInviteId are present only on approval; emailDeliveryId is
required for both outcomes. A decision never transitions directly from
submitted. Concurrent or stale decisions return 409 STATE_CONFLICT. Replaying
the same idempotent decision returns its committed result.

The rejection template is required and token-free. Its user-facing subject is
“Update on joining BeOnEdge” and its body is “We can’t continue your BeOnEdge
signup at this time.” It does not expose reasonCode/reasonDetail or use
application, approval, KYC, risk, or eligibility language.

#### POST /v1/admin/users/:userId/activation-invites/resend

Headers: required Idempotency-Key and X-CSRF-Token.

~~~ts
{
  reasonCode: ReasonCode,
  reasonDetail: ReasonDetail.optional(),
  expectedInviteId: Uuid
}
~~~

Success: 202.

~~~ts
{
  userId: Uuid,
  revokedInviteId: Uuid,
  activationInviteId: Uuid,
  emailDeliveryId: Uuid,
  status: z.literal("queued"),
  expiresAt: IsoDateTime
}
~~~

The transaction locks the user and current invite, verifies expectedInviteId,
revokes only a pending invite, creates one replacement, and queues one
delivery. A concurrent resend loses the expected-invite comparison and returns
409 STATE_CONFLICT. A replay with the same idempotency scope returns the first
replacement instead of revoking it again.

#### GET /v1/admin/email-deliveries

Query:

~~~ts
{
  state?: z.enum([
    "queued", "sending", "sent", "delivered",
    "retryable_failed", "permanent_failed", "cancelled"
  ]),
  templateKey?: z.enum([
    "verify_email", "activation_invite", "application_rejected"
  ]),
  applicationId?: Uuid,
  userId?: Uuid,
  after?: Cursor,
  limit?: z.coerce.number().int().min(1).max(100).default(25)
}
~~~

Sort is createdAt DESC, emailDeliveryId DESC and uses the same cursor rules.
`EmailDeliveryAdminSummary` for callers with `email_deliveries.read` is:

~~~ts
{
  emailDeliveryId: Uuid,
  outboxEventId: Uuid.nullable(),
  applicationId: Uuid.nullable(),
  userId: Uuid.nullable(),
  verificationTokenId: Uuid.nullable(),
  activationInviteId: Uuid.nullable(),
  templateKey: z.enum([
    "verify_email", "activation_invite", "application_rejected"
  ]),
  templateVersion: VersionTag,
  recipientMasked: MaskedEmail,
  sesConfigurationSet: z.string().min(1).max(128),
  sesMessageId: z.string().max(512).nullable(),
  sesRequestId: z.string().max(512).nullable(),
  state: z.enum([
    "queued", "sending", "sent", "delivered",
    "retryable_failed", "permanent_failed", "cancelled"
  ]),
  attemptCount: z.number().int().min(0).max(8),
  lastAttemptAt: IsoDateTime.nullable(),
  lastErrorCode: z.string().max(80).nullable(),
  sentAt: IsoDateTime.nullable(),
  deliveredAt: IsoDateTime.nullable(),
  bouncedAt: IsoDateTime.nullable(),
  complainedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  erasedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int().positive()
}
~~~

`EmailDeliveryMaskedSummary` for callers with only
`email_deliveries.read_masked` is strictly smaller:

~~~ts
{
  emailDeliveryId: Uuid,
  templateKey: z.enum([
    "verify_email", "activation_invite", "application_rejected"
  ]),
  recipientMasked: MaskedEmail,
  state: z.enum([
    "queued", "sending", "sent", "delivered",
    "retryable_failed", "permanent_failed", "cancelled"
  ]),
  attemptCount: z.number().int().min(0).max(8),
  lastErrorCode: z.string().max(80).nullable(),
  lastAttemptAt: IsoDateTime.nullable(),
  sentAt: IsoDateTime.nullable(),
  deliveredAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime
}
~~~

The server selects the projection after authorization; the client cannot request
the broader shape. The masked projection omits application/user/token/invite/
outbox identifiers, SES IDs/configuration, provider payloads, raw failure detail,
ciphertext, HMACs, and key material. The full safe projection maps directly to first-slice email_deliveries columns.
Recipient/failure ciphertext, nonce, key version, recipient/suppression HMAC,
and provider failure detail never cross the API. Admin receives only the mask,
stable `lastErrorCode`, and safe timestamps. `outboxEventId` may be null only
after the shorter-lived terminal outbox record has been retained then deleted.

### 3.3 Activation and native authentication

Native routes reject cookie authentication. The Android client supplies
X-Client-Platform: android and its semantic X-App-Version. These headers are
boundary/compatibility signals, not proof of an installed app and never an
authorization factor. The high-entropy single-use activation bearer is the
actual authority. “Native-only” is an approved client/UX and response-transport
contract; device attestation is not claimed in this release.

#### POST /v1/activations/complete

~~~ts
{
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: PasswordInput,
  device: {
    installationId: Uuid,
    name: z.string().trim().min(1).max(80),
    platform: z.literal("android"),
    appVersion: z.string().regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/)
  }
}
~~~

Success: 200.

~~~ts
{
  user: NativeUser,
  accessToken: z.string().min(100).max(4096),
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  refreshTokenExpiresAt: IsoDateTime,
  sessionId: Uuid
}
~~~

Activation is not request-idempotent: the activation token itself is
single-use. Credential creation, invite consumption, user activation, session
creation, refresh-token hash insertion, and audit append commit atomically. If
the response is lost after commit, retry returns TOKEN_ALREADY_USED and the user
signs in normally. Only the installed Capacitor client may call this route; the
HTTPS fallback page never exchanges the token, collects a password/device, or
receives native credentials.

NativeUser is:

~~~ts
{
  userId: Uuid,
  fullName: FullName,
  email: EmailInput,
  phoneMasked: z.string(),
  accountStatus: z.literal("active")
}
~~~

#### POST /v1/auth/native/login

~~~ts
{
  email: EmailInput,
  password: PasswordInput,
  device: {
    installationId: Uuid,
    name: z.string().trim().min(1).max(80),
    platform: z.literal("android"),
    appVersion: z.string().regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/)
  }
}
~~~

Success has the same data as activation. Invalid email and password both return
401 INVALID_CREDENTIALS with the same message and comparable work. An invited,
suspended, closed, rejected, or unknown principal cannot obtain a session.
After credential verification, lock the user and any active native session with
the same deviceIdHash in deterministic ID order. Atomically revoke that prior
session and its current refresh token with reason device_reauthenticated, then
create the replacement session/token. The partial unique active-device
constraint is the final race guard; a conflict retries this transaction once.
Protected native requests validate that sid is still active, so the replaced
session stops authorizing immediately rather than surviving the access-JWT TTL.

#### POST /v1/auth/native/refresh

~~~ts
{
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  rotationId: Uuid
}
~~~

Success:

~~~ts
{
  accessToken: z.string().min(100).max(4096),
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  refreshTokenExpiresAt: IsoDateTime,
  sessionId: Uuid
}
~~~

Every success locks the presented token and session, consumes generation N, and
inserts generation N+1 in one transaction. The successor raw token is
base64url(HMAC-SHA-256(refresh key version,
"boe-refresh-v1" || sessionId || N+1 || rotationId)); only its SHA-256 hash,
the refresh-key version, generation, and used rotationId are persisted. The
response exposes the derived raw successor once.

The immediately previous token has a 30-second ambiguity grace. Re-presenting
that token with the identical rotationId re-derives and returns the same
generation N+1 token and expiries without another rotation. Presenting it with
a different rotationId, or presenting any older/used token, atomically revokes
the family and returns SESSION_INVALID. After the grace, even the same
rotationId is reuse and revokes the family.

The client creates one UUID rotationId per logical refresh, collapses callers
onto one refreshPromise, and retries an ambiguous connection/timeout failure
exactly once with the same refresh token and rotationId. It never creates a new
rotationId for that retry. A received HTTP response is not retried.

#### POST /v1/auth/native/logout

Requires Authorization: Bearer access JWT.

~~~ts
{ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }
~~~

Returns 200 { loggedOut: true }. It revokes the session family. Repeated logout
also returns 200. The client awaits the request and always removes local tokens
in finally.

### 3.4 Browser-admin authentication and CSRF

Web routes reject refresh tokens in JSON and ignore Authorization headers.

#### POST /v1/auth/web/login

~~~ts
{ email: EmailInput, password: PasswordInput }
~~~

Success: 200 with cookies and:

~~~ts
{
  user: {
    userId: Uuid,
    fullName: FullName,
    email: EmailInput,
    roles: z.array(z.enum([
      "superadmin", "onboarding", "finance", "content", "support"
    ])).min(1),
    permissions: z.array(z.string()).min(1)
  },
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  accessTokenExpiresAt: IsoDateTime,
  refreshTokenExpiresAt: IsoDateTime
}
~~~

#### GET /v1/auth/web/csrf

Requires either a valid web access cookie or a valid **current** web refresh cookie and an
allowed Origin/Referer; it does not require an existing CSRF token. This is the
only authenticated cookie route exempt from X-CSRF-Token so a reload can
recover. It locks the session. While a prior refresh pair remains inside its
30-second ambiguity grace, a current refresh cookie deterministically
reproduces the current CSRF token from the persisted rotation ID/key version
without a write. Otherwise it generates a new 32-byte synchronizer token,
stores its SHA-256 hash and rotation timestamp, and invalidates the prior CSRF
token. It returns 200 { csrfToken, expiresAt }. If authenticated by
refresh cookie because access expired, expiresAt is the earlier of 10 minutes
and the refresh/session expiry. It does not rotate refresh credentials, extend
session life, or issue an access token. A consumed previous refresh cookie is
rejected: this GET has no rotationId and cannot turn previous-token grace into a
general bypass. It also must not overwrite the saved previous refresh/CSRF pair
for an in-flight ambiguous retry. After reload, a browser with a persisted
pending rotationId repeats refresh instead of using CSRF recovery.
Origin/Referer, Sec-Fetch-Site, request rate, channel=web, and active-session
checks still apply.

#### POST /v1/auth/web/refresh

~~~ts
{ rotationId: Uuid }
~~~

Requires refresh cookie, X-CSRF-Token, allowed Origin/Referer, and Fetch
Metadata validation. After origin/fetch checks, session logic recognizes either
the current refresh/current CSRF pair or immediately previous refresh/previous
CSRF pair before issuing a generic CSRF failure. During the same 30-second grace,
current refresh + previous CSRF + the persisted identical rotationId is the
partial-response recovery case: it reproduces current CSRF/access output without
another rotation. No other mixed pair is accepted. It rotates the refresh token and CSRF token atomically,
resets both cookies, and returns the same data shape as web login. The raw
successor refresh token is derived by the native rule. The raw successor CSRF
token is independently domain-separated but reproducible:
`base64url(HMAC-SHA-256(refresh key version, "boe-csrf-v1" || sessionId ||
N+1 || rotationId))`; only its SHA-256 hash is stored. Re-presenting the
immediately previous cookie and previous CSRF token with the identical
client-generated `rotationId` inside the 30-second
ambiguity window returns byte-identical successor refresh-cookie value,
expiries, and CSRF token without another write. A different ID or an expired
window is refresh reuse and revokes the family.

#### POST /v1/auth/web/logout

Empty body; requires access or refresh cookie plus X-CSRF-Token. It revokes the
session family, expires both cookies, and returns 200 { loggedOut: true }.
Repeated logout with already-expired cookies returns the same response only
when Origin/Referer checks pass.

## 4. Authentication and transport security

### 4.1 Token lifetimes and claims

| Secret | Lifetime | Storage |
|---|---:|---|
| Email verification token | 24 hours, single use | SHA-256 hash in PostgreSQL |
| Activation invitation token | 48 hours, single use | SHA-256 hash in PostgreSQL |
| Access JWT | 10 minutes | Web HttpOnly cookie or native memory only |
| Refresh token idle lifetime | 30 days from each rotation | Hash in PostgreSQL; raw value only in cookie/native secure storage |
| Refresh family absolute lifetime | 90 days from login/activation | PostgreSQL session |
| Synchronizer CSRF token | Until access refresh/logout; rotate on login, CSRF recovery, and refresh | SHA-256 hash in session; raw value in browser memory |

Access JWTs use `jose` with `ES256` only. The current signing key is a PKCS#8
private PEM and every current/retired verification key is an SPKI public PEM,
indexed by a versioned protected-header `kid`. Signing uses only the configured
current `kid`; verification rejects missing/unknown `kid`, selects that public
key, and pins issuer, audience, `ES256`, `typ=access`, and at most 30 seconds of
clock skew. Claims are iss, aud, sub, sid, jti, iat, nbf, exp, and typ. Retired
public keys remain available for at least the maximum 10-minute access-token TTL
plus accepted clock skew after the final token was signed. No refresh token is a JWT.

Every protected native and admin request resolves `sid` in PostgreSQL and
rechecks active session, expected channel, active user/account state, and current
permissions before authorization. JWT/cookie claims are not a revocation cache:
logout, suspension, closure, or permission revocation takes effect immediately.

Passwords use Argon2id with a per-password 16-byte random salt, 64 MiB memory,
three iterations, parallelism one, and 32-byte output. Parameters are stored in
the encoded hash. Login may transparently rehash only after successful
verification if policy increases.

Login locks `user_credentials` before updating its counter. The first wrong
password starts a 15-minute failure window; failures inside it increment the
counter and failure five sets `locked_until` to database time plus 15 minutes.
An expired failure window resets before the new failure becomes count one.
While locked, requests perform the bounded dummy
Argon2id work but do not extend the lock or change the counter, and return the
same `401 INVALID_CREDENTIALS` message/timing class as an unknown identifier.
Successful login clears lock/count/window atomically with session creation. The
first failure after lock expiry clears the old lock/count/window, then starts a
new window at failure one. Unknown, locked, and wrong-password cases use the
same envelope/timing class; only a PII-redacted internal log records the reason.

Activation and password-change commands check the candidate against Have I Been
Pwned Passwords using the k-anonymity range API before opening the credential
transaction:

- Compute SHA-1 locally, send only the uppercase first five hexadecimal
  characters to the HTTPS range endpoint, request padded responses, and compare
  the suffix locally in constant time. Never send, persist, or log the password,
  full SHA-1, suffix, or returned matching line.
- Connect and total timeout are two seconds. Cache a successful prefix response
  by prefix for 24 hours in a bounded cache; cache neither candidate hashes nor
  match decisions.
- Any positive occurrence count rejects with VALIDATION_FAILED on password and
  generic copy asking for another password.
- In production, timeout, malformed response, TLS failure, or non-2xx fails
  closed with DEPENDENCY_UNAVAILABLE and no credential/session commit.
  PASSWORD_BREACH_CHECK_MODE=bypass is accepted only when NODE_ENV is test or
  development; production startup rejects it. Login never calls HIBP.

### 4.2 Deployment key management

Secrets use the deployment mechanism that exists today: Docker Compose loads
environment variables from access-restricted deployment secret/.env files.
This plan does not introduce or assume a cloud secret manager. No secret file,
expanded environment value, or keyring is committed, exported into frontend
bundles, printed by status scripts, or included in support diagnostics.

Configuration contains a current key ID and versioned keyring for each purpose:
JWT signing, email-token HMAC, refresh/CSRF-token HMAC, consent-IP HMAC,
rate-limit HMAC, email-suppression HMAC, cursor HMAC, and
idempotency-scope HMAC, and PII/provider-payload encryption. These are distinct purpose-separated keyrings;
consent, rate, and suppression never share key material. Use purpose-specific
variables such as `CONSENT_IP_HMAC_CURRENT_KID`,
`RATE_LIMIT_HMAC_CURRENT_KID`, and `SUPPRESSION_HMAC_CURRENT_KID` plus their
`IDEMPOTENCY_SCOPE_HMAC_CURRENT_KID` plus their `*_KEYS_JSON` maps.
`application_consents.ip_hmac_key_version` and
`email_suppressions.suppression_hmac_key_version` persist the non-secret ID;
the rate-limit bucket includes its key ID because the short-lived window row has
no separate version column. Startup validates algorithms, lengths, unique IDs,
presence of every current key, and continued presence of all key IDs referenced
by unexpired/retained rows.

The JWT keyring specifically maps versioned `kid` values to ES256 SPKI public
PEMs and provides one current matching PKCS#8 private PEM. Startup proves the
private/public pair matches, rejects any non-ES256 key, signs only with the
current `kid`, and retains retired public keys through access TTL plus clock
skew. Private signing material is never accepted as a frontend/export artifact.

New signatures, tokens, HMACs, and ciphertext always use the configured current
key ID and persist that non-secret ID. Reads verify/decrypt older data by its
recorded ID; old keys are verify/decrypt-only and are removed only after no
unexpired/retained row references them. Rotation is deploy new key plus old
keys, switch current ID, migrate or age out references, then remove the old key
in a later release. An unknown referenced ID fails closed with
DEPENDENCY_UNAVAILABLE and a redacted operational alert.

### 4.3 Web cookies and synchronizer CSRF

The cookie contract is exact:

- __Host-boe_access: HttpOnly; Secure; SameSite=Lax; Path=/; no Domain;
  Max-Age=600.
- __Host-boe_refresh: HttpOnly; Secure; SameSite=Lax; Path=/; no Domain;
  Max-Age no greater than the remaining 30-day idle and 90-day absolute life.
- Cache-Control: no-store on every auth response.
- Secure may be disabled only in NODE_ENV=test by explicit test configuration.
  Development, staging, and production use HTTPS; startup rejects insecure
  cookie configuration outside tests.

The synchronizer token is returned only in successful web login, web refresh,
and GET /v1/auth/web/csrf response bodies. The admin app holds it in memory and
sends X-CSRF-Token on every POST, PUT, PATCH, and DELETE authenticated by
cookie. The server hashes the supplied token, compares it in constant time with
the current session hash, verifies Origin against the exact admin allowlist,
falls back to exact Referer only when Origin is absent, and rejects
Sec-Fetch-Site: cross-site. Missing metadata is allowed only for known test or
non-browser clients that do not use cookie auth. CORS is an exact-origin
allowlist with credentials; wildcard origin is forbidden.

All tabs use one same-origin auth coordinator: `navigator.locks` serializes
refresh/CSRF recovery and `BroadcastChannel` distributes the non-cookie result
(`rotationId`, CSRF token, and expiries) to waiting tabs. The leader records the
non-secret pending `rotationId`, start time, and one-retry count in
`sessionStorage` before POSTing; after an ambiguous connection failure or tab
reload it retries once with the same ID. Followers wait and never create a
second ID for the same cookie generation. A successful refresh or CSRF recovery
broadcast replaces every tab's in-memory CSRF token; cookies remain HttpOnly and
are never broadcast or persisted. If Web Locks or BroadcastChannel is absent,
the admin fails closed to one active tab instead of risking family revocation.

### 4.4 Native storage and request behavior

The existing asynchronous platformStorage.secure adapter is the sole native
refresh-token store. Use key boe.auth.native.refresh.v1 for an immutable object
containing refreshToken, refreshTokenExpiresAt, sessionId, userId, and optional
pendingRotation { rotationId, startedAt, retryCount }.

- Before native login, activation, or refresh, require
  await platformStorage.secure.available(); absence is a blocking,
  user-friendly error. Do not fall back to platformStorage.local,
  localStorage, sessionStorage, IndexedDB, or a plaintext file.
- Keep accessToken and the current user in memory only.
- On app start, read the secure refresh record, call native refresh, then
  populate memory. Never copy the refresh token into application state,
  analytics, crash reports, URLs, or logs.
- Implement one shared refreshPromise. All 401 responses wait for it, then
  replay the original request at most once. Auth endpoints are never
  recursively refreshed.
- Before sending refresh, persist pendingRotation with a new rotationId and
  retryCount=0. On an ambiguous transport failure atomically persist
  retryCount=1 and retry once with the same values. A process restart resumes
  that one retry; it does not mint a different rotationId. On success replace
  the secure object with the successor token and no pendingRotation.
- A refresh 401 clears secure storage. A network/5xx failure keeps an unexpired
  refresh token and surfaces a retryable offline state.
- Logout awaits server revocation; finally always removes the secure record and
  in-memory access token.
- Android backup and device-transfer rules exclude the plugin storage and all
  auth, activation, PIN, biometric, and installation identifiers.
- `appRestoredResult` handles only operating-system restoration of an
  interrupted Capacitor plugin call. Normal application, payment, or mandate
  workflow recovery persists only a non-sensitive local workflow ID and
  refetches authoritative server state; it does not treat `appRestoredResult`
  as a general app-resume callback.

### 4.5 Authorization

Permissions are evaluated server-side on every admin request. UI hiding is not
authorization. The initial MVP administrator has superadmin plus all
permissions; other roles are least-privilege.

Every admin cookie request also resolves `sid` and rechecks the web session,
user account state, and current permissions in PostgreSQL. Every native bearer
request performs the equivalent native-channel check. Logout, suspension,
closure, session replacement, and permission revocation therefore invalidate
authorization immediately even while an access JWT/cookie has remaining TTL.

| Role | Permissions |
|---|---|
| superadmin | all permissions; role assignment; account suspension/closure |
| onboarding | applications.read, applications.review, applications.decide, invitations.manage, email_deliveries.read, users.read |
| finance | funds.read, finance.read, finance.operate, approvals.request, approvals.check |
| content | content.read, content.publish, funds.read |
| support | users.read_limited, email_deliveries.read_masked, support.read, support.write |

First-slice route mapping:

| Route | Permission |
|---|---|
| GET admin applications | applications.read |
| GET admin application detail | applications.read plus (`email_deliveries.read` OR `email_deliveries.read_masked`) for the embedded strict-safe delivery page |
| POST application review | applications.review |
| POST application decision | applications.decide |
| POST invitation resend | invitations.manage |
| GET email deliveries | `email_deliveries.read` for the full administrative projection OR `email_deliveries.read_masked` for the strict support projection; if both are present, return the full safe projection |
| POST web login | public credential exchange; resulting principal must have an active admin role |
| GET web CSRF | active web session authenticated by access or refresh cookie; no domain permission and no prior CSRF token |
| POST web refresh/logout | active web session; no domain permission; CSRF required |

No onboarding decision uses maker-checker. Later slices use only the closed six
categories/eight action codes from `03`: every investable fund/term
publication; resume/archive after publication; published NAV/AUM correction;
booked-order reversal; above-threshold redemption; and runtime RBAC
grant/revocation/mapping changes. Every fund term publication requires dual
control—there is no sensitivity flag. Current-date first NAV/AUM, position
correction, refunds/provider transitions, ordinary content, account actions,
and emergency pause do not. A principal can never approve its own action, and
superadmin does not bypass separation. Booked reversal appends one linked exact
inverse execution and `holding_lot_movements`; originals are immutable. Later
money logic follows `03` scale-8, single round-half-to-even, FIFO residual,
order/refund, and atomic projection rules rather than defining a second API
policy here.

### 4.6 PostgreSQL rate limiting and proxy trust

Rate limiting uses a PostgreSQL atomic fixed-window table so every backend
replica shares one decision:

~~~text
rate_limit_windows(
  bucket text,
  key_hash bytea,
  window_start timestamptz,
  count integer,
  expires_at timestamptz,
  PRIMARY KEY(bucket, key_hash, window_start)
)
~~~

For each applicable subject, calculate the UTC window boundary in application
code, then `INSERT ... ON CONFLICT ... DO UPDATE SET count =
rate_limit_windows.count + 1 RETURNING count` in one statement. The decision
uses the returned count. `key_hash` is HMAC-SHA-256 of a type-prefixed canonical
value using the dedicated current rate-limit key; `bucket` includes that
non-secret key version so rotations cannot combine unrelated hashes. Raw IP,
email, phone, token, and session secrets are never stored. Delete expired rows
in bounded batches. Successful responses include
RateLimit-Limit/Remaining/Reset; 429 also includes Retry-After.

Proxy trust is route-aware, not one global hop count:

- On every internet-facing server block nginx removes any incoming
  `Forwarded`, `X-Forwarded-For`, and internal-client-IP headers, then sets one
  canonical `X-Forwarded-For` value from nginx's socket peer. It overwrites; it
  never appends `$proxy_add_x_forwarded_for`.
- Direct nginx-to-API routes require the socket peer to match the configured
  nginx address/range and accept exactly that single canonical value. Local
  test traffic with no proxy uses `socket.remoteAddress`; extra/malformed hops
  fail closed on public/auth/mutation/SNS routes.
- Landing BFF calls arrive from the configured internal landing service. The
  landing receives nginx's overwritten client IP, then sends a canonical
  `X-Boe-Original-Client-IP`, timestamp, request ID, and HMAC over those values
  plus method, normalized path, and body digest. The API requires the configured
  landing socket source, validates the purpose-specific BFF key/version and a
  30-second timestamp window, and ignores `Forwarded`/`X-Forwarded-For` on this
  route class. A browser cannot select the internal source or signed IP.

Startup validates both source policies and keys. A topology change requires a
configuration and deployment-test change; there is no permissive fallback.

Every first-slice endpoint belongs to these route classes and all listed
dimensions must pass:

| Route class and endpoints | Fixed-window limits |
|---|---|
| public_read: GET consent documents | 120/IP/minute |
| public_signup: POST applications | 20/IP/hour, 5/email-HMAC/hour, 5/phone-HMAC/hour |
| public_verify: POST verify email | 10/IP/15 minutes, 5/token-hash/hour |
| native_activation: POST activation complete | 10/IP/15 minutes, 5/token-hash/hour |
| native_login: POST native login | 20/IP/15 minutes, 5/identifier-HMAC/15 minutes |
| native_refresh: POST native refresh | 60/session/5 minutes, 120/IP/hour |
| native_logout: POST native logout | 30/session/minute |
| web_login: POST web login | 20/IP/15 minutes, 5/identifier-HMAC/15 minutes |
| web_csrf: GET web CSRF | 30/session/5 minutes, 120/IP/hour |
| web_refresh: POST web refresh | 30/session/5 minutes, 120/IP/hour |
| web_logout: POST web logout | 30/session/minute |
| admin_read: both application GETs and delivery GET | 300/admin/minute, 600/IP/minute |
| admin_mutation: review, decision, invite resend | 60/admin/minute, 120/IP/minute |
| sns_ingress: POST AWS SNS | 3000/configured-topic/minute, 3000/source-IP/minute |

Limiter database failure is fail closed with DEPENDENCY_UNAVAILABLE for every
public/auth endpoint, SNS ingress, and every mutation, because bypass would
weaken abuse or credential controls. It is fail open only for an already
authenticated GET admin_read request; emit a high-priority metric/log once per
outage window and attach no sensitive subject value. Rate-limit checks happen
before password hashing/provider calls, but identifier dimensions are
calculated only after boundary validation.

For SNS, enforce the source-IP window before signature work and the configured
topic window after signature/topic validation but before inbox insertion; an
untrusted payload never selects its own trusted-topic limiter bucket.

### 4.7 Exact first-slice retention

Retention uses database time, bounded daily jobs, legal-hold exclusion, and an
audit event containing counts and policy version but no removed PII:

An encrypted-field purge nulls the ciphertext/nonce/key-version envelope in the
primary database; it is not called cryptographic erasure. Encrypted backups and
WAL remain restricted recovery material for no more than 35 days, then expire.
Every restore reruns retention reconciliation before application access.

| Record/evidence | Retention and terminal action |
|---|---|
| Applications | Seven years after decision/withdrawal, or after submittedAt if never decided; rejected/withdrawn direct name/email/phone becomes non-reversible unique tombstones at 180 days; unverified signup direct PII is tombstoned 30 days after creation; linked approved-application PII is tombstoned with a closed user at closedAt+180 days, including normalized identifiers so the originals become reusable |
| Application consents and reviews | Seven years after decision, withdrawal, submittedAt when never decided, or createdAt for an unverified signup; append-only; IP HMAC is evidence and raw IP is never stored |
| Consent documents referenced by evidence | Indefinite while referenced; published versions are immutable |
| Verification tokens | Delete 90 days after consumed, revoked, or expired |
| Users and credentials | No physical deletion while financial/compliance/consent/audit evidence requires the identity; closure atomically revokes sessions/invites and erases the password hash; absent a hold, direct user and linked approved-application name/email/phone become unique non-reversible tombstones 180 days after closedAt while the stable pseudonymous user ID remains |
| Activation invites | Seven years as activation evidence; raw token never exists in storage |
| Terminal auth sessions and refresh-token generations | 180 days, then delete session and cascading token rows |
| First-slice idempotency responses | 24 hours for public/auth commands; seven days for onboarding-admin commands |
| Delivered/cancelled outbox events | 90 days from deliveredAt/cancelledAt; dead-letter events one year from terminal updatedAt |
| Email deliveries | Seven years after latest delivery/bounce/complaint/permanent failure/cancellation/creation; then erase recipient/failure ciphertext, nonce, and encryption-key-version columns while retaining suppression HMAC/key version, masked address, state, and evidence |
| Matched SES/SNS inbox event | Same seven-year retention as its delivery, then purge encrypted payload fields from the primary database and retain digest/IDs/outcome |
| Unmatched valid SES/SNS inbox event | Seven days after receipt, then delete encrypted payload and row after reconciliation audit |
| SNS subscription confirmation/unsubscribe event | One year after receipt |
| Onboarding/security audit events | Seven years, append-only |
| Rate-limit windows | Window end plus 24 hours, then delete |
| Operational application logs | 30 days, already redacted |
| HIBP prefix cache | 24 hours maximum |

A legal hold uses the typed allowlist `application`, `user`, `email_delivery`,
`email_provider_event`, `audit_event`, `investor_profile`, `kyc_case`,
`risk_assessment`, `marketing_lead`, `investment_order`, `payment`, or
`mandate`.
The provider-event value directly protects unmatched reconciliation evidence.
Application holds propagate to
details/consents/reviews/tokens/pre-user deliveries; user holds propagate to
credentials/sessions/invites/user deliveries/notifications, the linked
approved application, investor profile, KYC cases/documents/reviews, risk
assessments, orders, payments, mandates, and their retention children. KYC-case
holds propagate to documents/reviews; order holds propagate to executions,
holding/lot movements, payment/provider/audit/generated evidence; payment holds
propagate to attempts/refunds/provider/audit evidence; mandate holds propagate
to attempts/provider events. Investor-profile and risk-assessment holds protect
their exact rows. Provider events resolve their typed payment, mandate, or user
retention parent and protect a source-linked suppression row. An unconverted
marketing lead is its own lock/hold target; a converted lead resolves through
its linked application. It
suspends anonymization/deletion for the exact named record or its declared
retention parent without silently extending unrelated data. Every bounded
cleanup transaction anti-joins the active hold and rechecks it under the row
lock before mutation. Retention jobs use a dedicated database role; the runtime
application role cannot delete evidence.

## 5. Idempotency and pagination

### 5.1 Required idempotency

Idempotency-Key is required for POST /v1/applications, application review,
application decision, and invitation resend. Later order creation, provider-operation requests,
refund, reversal, and financial exception endpoints inherit this requirement.
Login, refresh, activation, verification, CSRF, and logout do not store
idempotency responses because they contain or rotate secrets.

The PostgreSQL uniqueness scope is actorScope, HTTP method, normalized route
template, and key:

- Public application actorScope is HMAC(normalized email) after validation.
- Admin actorScope is authenticated user ID.
- Later native actorScope is authenticated user ID.

The request hash is SHA-256 of one length-prefixed canonical byte sequence that
binds, in order: uppercase HTTP method, normalized route template, normalized
concrete path, canonical sorted/percent-encoded query pairs, normalized
`If-Match` or an explicit null marker, and the RFC 8785 canonical JSON body or
an explicit empty-body marker. It excludes `requestId` but does not omit the
route/path/query/concurrency precondition. Changing any bound value with the
same key yields `IDEMPOTENCY_KEY_REUSED`. The implementation uses a
transaction-scoped advisory lock, not a processing row or lease:

1. Build canonicalScope by length-prefixing actor scope, uppercase method,
   normalized route template, and Idempotency-Key, then derive PostgreSQL's
   signed bigint with hashtextextended(canonicalScope, 0).
2. Begin the domain transaction and call
   pg_try_advisory_xact_lock(hashtextextended(canonicalScope, 0)). A false result immediately returns
   409 IDEMPOTENCY_IN_PROGRESS with Retry-After: 1. It does not wait, insert a
   processing marker, or create a stale lease.
3. After acquiring the lock, select the completed idempotency row by scope/key.
   A row with a different request hash returns 409 IDEMPOTENCY_KEY_REUSED.
4. A row with the same hash replays stored HTTP status and parsed data or error.
   The new envelope gets the current requestId and idempotencyReplay=true.
5. If no row exists, execute the mutation and insert the completed response row
   in the same transaction. Domain writes, outbox/audit writes, and that
   completed row commit together. Rollback releases the transaction lock and
   leaves neither a domain mutation nor idempotency row.

Advisory-key collisions can only cause a transient IDEMPOTENCY_IN_PROGRESS,
never replay another scope: completed-row lookup and uniqueness still use the
full scope and key. There is no processing state, lockedUntil, background lease
recovery, or failed idempotency row.

Retention is 24 hours for first-slice public/auth keys and seven days for
onboarding-admin and later financial keys. Cleanup runs in bounded batches.
Stored replay bodies must not
contain tokens, cookies, passwords, unmasked provider data, or raw PII beyond
what the original authorized response already returned.

### 5.2 Cursor pagination

All collections use keyset pagination, never offset. The cursor is base64url of
an authenticated payload containing route ID, sort timestamp, sort UUID,
SHA-256 filter hash, issuedAt, and expiresAt. It is signed with a dedicated
HMAC key. Default limit is 25 and maximum is 100. Queries fetch limit + 1,
return at most limit, and set hasMore and nextCursor. Stable ordering always
ends in the unique primary key. Invalid, expired, cross-route, or filter-mismatched
cursors return CURSOR_INVALID.

## 6. Amazon SES and SNS

### 6.1 DNS and environment readiness

Production email is not ready until all checks pass:

- SES identity verifies the exact From domain and production sending is enabled
  in the chosen AWS region.
- Easy DKIM CNAME records report SUCCESS.
- The From domain SPF policy authorizes SES; a custom MAIL FROM subdomain has
  its SES MX and SPF records.
- DMARC exists at _dmarc with aligned From/DKIM domains. p=none is allowed only
  in pre-production monitoring; production cutover requires at least
  p=quarantine and an aggregate-report mailbox. Move to p=reject after monitored
  alignment is clean.
- The configuration set publishes Delivery, Bounce, Complaint, Reject,
  Rendering Failure, and Delivery Delay events to one allowlisted SNS topic.
- The SNS HTTPS subscription is confirmed, the endpoint is publicly reachable
  over trusted TLS, and topic ARN, AWS account, region, From address, Reply-To,
  configuration-set name, public base URL, and download URL are startup-validated
  environment values.
- A readiness probe reports emailConfigured=false without exposing values and
  blocks first-slice production cutover.

### 6.2 Delivery persistence and sending

Each `email_deliveries` row uses the exact `03` schema, including the complete
recipient and failure AES-GCM envelopes (`ciphertext`, 12-byte `nonce`, and
encryption key version), dedicated `recipient_hmac` plus
`suppression_hmac_key_version`, SES IDs, evidence timestamps, nullable
`cancelled_at`/`erased_at`, and state `queued | sending | sent | delivered |
retryable_failed | permanent_failed | cancelled`. It has no `next_attempt_at`,
lease, due-time, or delivery-owned retry column. At least one application/user
subject is present and the template-specific composite token/invite ownership
FKs from `03` are enforced. API responses expose only the safe projection.

Every outbox row contains the full exact envelope: `id`/internal `eventId`, `topic`, `event_type`,
`event_version`, `aggregate_type`, `aggregate_id`, `occurred_at`, `request_id`,
nullable `causation_id`, nullable workflow `correlation_id`, unique
`deduplication_key`, and typed `payload`. Email payloads contain only delivery,
subject, invite/token record IDs, and template version—not raw PII, rendered
links, or tokens. The worker decrypts the recipient only
while sending. Verification and activation secrets are
deterministically derived as base64url(HMAC-SHA-256(token key version,
"boe-email-token-v1" || purpose || tokenRecordId)). Each token row records the
non-secret key version and only SHA-256(raw derived token). Retries use that
same version and record ID, so key rotation does not change an already-issued
link. New tokens always use the current token-HMAC key ID. Key bytes come from
deployment-injected environment variables and never PostgreSQL.

Every SES SendEmail request includes the non-secret message tag
`boe_delivery_id=<email-delivery UUID>`. The strict SNS schema accepts that tag
from the signed SES `mail.tags` object and uses it as the primary correlation
even when an event arrives before the SendEmail result transaction records
`sesMessageId`. It must resolve the same existing delivery; a malformed,
unknown, or conflicting tag is retained for bounded reconciliation and alerted,
never trusted as an arbitrary foreign key.

Rendered verification and activation links put the raw bearer only in the URL
fragment, for example `/verify-email#token=...` or `/activate#token=...`; query
parameters and paths never contain it. The same-origin verification page may
read/remove its fragment and POST only to `/v1/applications/verify-email`.
The activation fallback never calls `/v1/activations/complete`. It offers the
signed APK download and an “Open BeOnEdge” verified App Link while preserving
the fragment for the installed Capacitor client. Only that client reads and
exchanges the activation token, supplies password/device data, and stores the
refresh token in native secure storage. Both pages set `Referrer-Policy:
no-referrer`, load no third-party resources, and are excluded/redacted by path
from analytics. nginx logs `$uri` plus safe metadata—not `$request_uri` or
request bodies—so access/error logs never capture the secret.

Workers claim due `outbox_events` rows with `FOR UPDATE SKIP LOCKED` and set an
outbox lease. Before SES, one short transaction locks that outbox row, delivery,
and referenced token/invite, validates lease/current token/suppression, and
either cancels obsolete work or transitions both outbox and delivery to
`sending`. The committed `sending` transition is the point of no return; only
then does the worker call SES outside a transaction. The result
transaction updates outbox state/schedule and email evidence atomically. A
successful SendEmail response records the SES MessageId/sent time and terminal
outbox delivery. If the process loses the response, the outbox lease expires
and a duplicate message with the same still-valid link may be sent; domain
state is not duplicated. `email_deliveries` never owns the claim or retry.

Retry schedule after the initial attempt is 1 minute, 5 minutes, 15 minutes,
1 hour, 4 hours, 12 hours, and 24 hours, with up to 20 percent deterministic
jitter. SES throttling, timeout, connection error, and 5xx are retryable.
Validated SES 4xx configuration/address failures are permanent except explicit
throttling. After eight total attempts, mark permanent_failed, retain the
stable error code, and place the outbox row in the dead-letter state. Never
roll back application approval because delivery failed.

Revocation before committed `sending` cancels both rows with
`VERIFICATION_TOKEN_REVOKED` or `ACTIVATION_INVITE_REVOKED`. Revocation after
that point cannot recall the message; the email may arrive, but the embedded
token is invalid and harmless. Only a pre-acceptance send failure can schedule retry. Once SES accepts a send,
the outbox remains delivered: later Delivery/Delay/Reject/Bounce/Complaint
events, including Delivery Delay, add monotonic evidence or suppression but never perform
`sent → retryable_failed` and never enqueue an automatic resend. Revoked or
obsolete unsent work atomically transitions both delivery and outbox to their
defined terminal `cancelled` states.

### 6.3 SNS validation and event handling

#### POST /v1/provider-events/aws-sns

Consumes the exact raw request bytes with a
256 KiB limit and Content-Type text/plain with optional UTF-8 charset. Parse the
bytes only after retaining them for signature/digest verification. The strict
outer Zod discriminated union has these fields:

~~~ts
type SnsSignedBase = {
  MessageId: z.string().min(1).max(256),
  TopicArn: z.string().min(1).max(2048),
  Message: z.string().max(262144),
  Timestamp: IsoDateTime,
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().min(1).max(4096),
  SigningCertURL: z.string().url().max(2048)
}

type SnsNotification = SnsSignedBase & {
  Type: z.literal("Notification"),
  Subject?: z.string().max(100),
  UnsubscribeURL?: z.string().url().max(2048)
}

type SnsSubscriptionMessage = SnsSignedBase & {
  Type: z.enum(["SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  Token: z.string().min(1).max(4096),
  SubscribeURL: z.string().url().max(2048)
}
~~~

X-Amz-Sns-Message-Type, X-Amz-Sns-Message-Id, and X-Amz-Sns-Topic-Arn must
exactly match the signed body when present. Notification Message then parses as
the strict SES configuration-set event schema: eventType plus mail.messageId
and the event-type-specific delivery/bounce/complaint/reject/failure/
deliveryDelay object. Raw rendering failures use exactly `eventType: "Rendering
Failure"` and object key `failure`; normalization to internal
`RenderingFailure` happens only after strict parsing. Before parsing event content:

1. Parse the SNS outer document with a strict schema and allow only
   SignatureVersion "1" (RSA-SHA1) or "2" (RSA-SHA256), using the exact AWS
   canonical fields for the outer message type. Any other value is rejected.
2. Require TopicArn to equal the configured ARN and region/account.
3. Require SigningCertURL to be HTTPS, implicit/explicit port 443, have no
   credentials/query/fragment, and use the exact configured regional hostname
   sns.<AWS_REGION>.amazonaws.com with an AWS SNS certificate path. Resolve and
   connect without redirects; private, loopback, link-local, multicast, and
   non-matching resolved addresses are forbidden.
4. Fetch certificates with bounded timeout and size, cache by URL until the
   earlier of certificate expiry or one hour, then verify the signature over
   the AWS canonical string.
5. Require Timestamp within 15 minutes for Notification and
   SubscriptionConfirmation. Persist MessageId under a unique constraint.
6. Parse the inner SES event with a strict schema only after signature
   validation. Match the signed `mail.tags.boe_delivery_id` to its delivery and
   cross-check `mail.messageId` when already recorded. Without a valid tag,
   match by existing delivery `sesMessageId` or retain for reconciliation.

Supported SNS outer types:

- Notification: durably insert once, then return 200. Process SES event types
  Delivery, Bounce, Complaint, Reject, Rendering Failure, and Delivery Delay.
- SubscriptionConfirmation: accept only the configured topic, validate and
  sign-check it, then confirm using SubscribeURL only after an operator-enabled
  bootstrap flag. SubscribeURL must independently pass HTTPS/443, exact
  sns.<AWS_REGION>.amazonaws.com host, no credentials, no redirect, public-IP
  resolution, and token/topic consistency checks; otherwise record and alert
  without fetching.
- UnsubscribeConfirmation: validate, record, alert, and return 200; never
  resubscribe automatically.

Unknown signed notification types are recorded as ignored and return 200.
Once the outer SNS message has valid provenance and signature, an unsupported or
malformed inner SES payload is also durably inserted with its raw encrypted
evidence/digest, classified to `ignored` with a stable redacted
dead-letter/reconciliation audit reason, alerted, and returns 200. It is never
left for endless SNS redelivery and does not invent an
`email_provider_events.dead_lettered` state. A body whose outer fields cannot
establish provenance, or whose topic/certificate/timestamp/signature fails,
returns 401 `SNS_SIGNATURE_INVALID`; content-type/size and dependency failures
retain their generic transport errors. Duplicate MessageId returns 200 without
a second transition.

Delivery is monotonic: delivered cannot regress to sent or failed. A bounce or
complaint on queued/sending/retryable_failed moves to permanent_failed; on sent
or delivered it preserves that delivery state while setting bouncedAt or
complainedAt and a stable lastErrorCode. In every ordering, upsert
`email_suppressions` by `(recipientHmac, suppressionHmacKeyVersion)` across the
active suppression-key versions and alert operations; permanent bounce
cannot be lifted, while complaint lift requires renewed consent plus an audited
authorized action. Delivery Delay is informational and leaves sent status.
Unmatched valid events are retained for seven days for reconciliation without
exposing their raw body to admin.

### 6.4 First-slice SNS inbox and repository

Signature verification occurs before the database transaction. A valid SNS
message is mapped to the first-slice email_provider_events inbox defined in 03:

- sns_message_id is the outer MessageId; sns_topic_arn and sns_type preserve
  the validated outer values.
- ses_event_type is null for subscription messages and otherwise one of
  Delivery, Bounce, Complaint, Reject, RenderingFailure, or DeliveryDelay.
- ses_message_id comes from the validated SES inner mail object.
  delivery_correlation_id comes only from a validated signed
  `mail.tags.boe_delivery_id`. email_delivery_id is populated when that tag
  resolves an existing delivery and does not conflict with a recorded message
  ID, or when the SES message ID independently matches one delivery. Otherwise
  the event commits unmatched for bounded reconciliation.
  `delivery_correlation_id` deliberately has no FK so an authenticated but
  unknown UUID remains durable evidence; only resolved `email_delivery_id`
  references a delivery.
- payload_sha256 is SHA-256 of exact raw HTTP bytes. Before erasure,
  payload_ciphertext, its random 12-byte payload_nonce, and payload_key_version
  form an all-present AES-256-GCM envelope (including its 16-byte tag). AAD is
  exact UTF-8 `boe-email-provider-event-v1|payload|<event-id>|<sns-message-id>|<sns-topic-arn>`.
  New events encrypt with the current key; reads decrypt old events by recorded
  version. At retention expiry those three fields become null together and
  erased_at is set while digest/IDs/redacted outcome remain.
- state starts received, received_at uses database now, processed_at is null,
  and expires_at follows the exact retention class.

The endpoint returns 200 only after insert/ignored-evidence commit. Unique sns_message_id is the
inbox idempotency boundary. A duplicate with the same digest returns 200 and
does not apply twice. The same MessageId with a different digest is a provenance
conflict: alert without altering the original and return 401.

Bounce/complaint processing uses the `03` `email_suppressions` schema exactly:
composite primary key `(recipient_hmac, suppression_hmac_key_version)`, reason
bounce or complaint, source-event FK, creation time, and nullable all-or-none
lift fields. No raw address is stored. Permanent bounce cannot be lifted;
complaint lift requires renewed consent, permission, reason, and audit evidence.

Project repository semantics are:

~~~ts
interface EmailProviderEventRepository {
  insertVerified(
    tx: Transaction,
    event: Readonly<VerifiedSnsInboxInput>,
  ): Promise<Readonly<{ eventId: string; isDuplicate: boolean }>>
  lockReceivedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>,
  ): Promise<readonly EmailProviderEvent[]>
  lockUnmatchedBatch(
    tx: Transaction,
    input: Readonly<{ limit: number; now: string }>,
  ): Promise<readonly EmailProviderEvent[]>
  markProcessed(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markIgnored(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  markUnmatched(
    tx: Transaction,
    input: Readonly<{ eventId: string; processedAt: string }>,
  ): Promise<EmailProviderEvent>
  reconcileUnmatched(
    tx: Transaction,
    input: Readonly<{
      eventId: string
      emailDeliveryId: string
      processedAt: string
    }>,
  ): Promise<EmailProviderEvent>
}
~~~

The worker transaction selects received rows ordered by received_at,id with FOR
UPDATE SKIP LOCKED and keeps the row lock while performing only database work.
For a matched SES event it locks email delivery, applies its monotonic evidence
and any email_suppressions upsert, then marks the inbox row processed in the
same short transaction. A rollback leaves it received for retry; there is no
processing state, network call, attempt lease, or invented dead-letter column.
Valid unknown or malformed inner event semantics become ignored with durable
redacted dead-letter/reconciliation audit evidence. A valid SES event with no unique
delivery match becomes unmatched and alerts reconciliation. A bounded worker
locks unmatched rows with `SKIP LOCKED`, retries correlation by the validated
delivery tag and then by a now-recorded SES message ID, and atomically applies
delivery/suppression evidence plus `unmatched -> processed`. It never guesses by
recipient or template, and leaves unresolved rows unmatched for the next bounded
run until their seven-day reconciliation deadline. Provider identity,
digest, and encrypted evidence are immutable. SubscriptionConfirmation network
confirmation, when operator-enabled, occurs outside this database transaction;
its result is then marked processed or ignored in a separate transaction.

### 6.5 Resend races

Invitation resend locks the current invite and checks expectedInviteId. It
revokes that invite before creating its replacement and new delivery in one
transaction. The send worker re-locks and verifies that its invite is still
pending before committing the `sending` point of no return; an event revoked
before that point becomes cancelled with `ACTIVATION_INVITE_REVOKED` and is not
sent. If revocation races after `sending` commits or SES accepts the send,
the old email may arrive but its link fails TOKEN_ALREADY_USED or TOKEN_INVALID.
Only the newest pending invite can activate. Idempotent replay returns the same
replacement invite and delivery.

## 7. OpenAPI and typed-client pipeline

Zod route schemas are authored in a shared contracts module, registered with
@asteasolutions/zod-to-openapi, and used directly by backend validation. The
build performs:

1. Generate openapi.json deterministically from the route registry, including
   operationId, auth scheme, parameters, request schema, success envelope,
   stable error envelopes, and examples.
2. Validate the document with Redocly CLI and fail on duplicate operation IDs,
   undocumented statuses, or invalid references.
3. Generate TypeScript definitions with openapi-typescript.
4. Use openapi-fetch over the generated paths type in landing, admin, and
   client transport adapters. Domain/UI models map from generated DTOs; they do
   not hand-write competing wire interfaces.
5. Run generation in CI and fail when a clean git diff shows stale generated
   artifacts. Generated files are never edited manually.

The checked-in OpenAPI artifact and generated types are a compatibility
boundary. A breaking /v1 change fails contract snapshots and requires either a
backward-compatible schema or an explicit /v2 decision.

Before selecting or upgrading any third-party package:

1. Search GitHub repositories and code for maintained implementations and
   integration patterns, then inspect licenses and recent security posture.
2. Check npm registry metadata, exact versions, Node/browser support,
   transitive dependencies, deprecations, and audit advisories.
3. Read primary vendor documentation for the exact selected major version.
   Blog posts and generated examples are not API authority.
4. Record the chosen version, license, purpose, rejected alternatives, and
   links in the slice review notes. Pin the lockfile through the main checkout.
5. Copy no third-party source unless its license is compatible and attribution
   requirements are recorded. Wrap SES, SNS, secure storage, password hashing,
   and OpenAPI generators behind narrow adapters; do not let vendor DTOs enter
   domain services.

If the named OpenAPI packages do not support the installed Zod/TypeScript
versions when implementation begins, that slice stops at dependency research;
it does not silently introduce a second contract source or invent an API.

## 8. TDD and acceptance suite

Every behavior follows RED, GREEN, REFACTOR. A test must fail for the intended
reason before implementation. PostgreSQL tests use a real disposable PostgreSQL
instance and migrations, not an in-memory substitute.

### 8.1 Unit tests

- Parse every valid request and reject unknown keys, null optionals, control
  characters, invalid phone/email, missing consents, weak password, malformed
  cursor, numeric JSON number, and out-of-range limit.
- Normalize equivalent email/phone inputs to the same lookup value while
  preserving the validated display input only in command memory until its
  documented encrypted envelope is produced; never persist an accidental
  plaintext display copy.
- Reject consent Markdown containing raw HTML, active/embedded content, unsafe
  schemes, encoded scheme bypasses, or control characters; render hostile text
  as escaped text and allow only the fixed safe subset/links.
- Escape every user-controlled email-template substitution and reject any link
  origin/scheme outside the configured HTTPS origin.
- Serialize bigint, numeric(24,8), and numeric(30,12) exactly as strings.
- Cover every allowed/forbidden application, invite, user, delivery, and
  session transition as immutable functions.
- Verify canonical request hashing is key-order independent and changes on
  semantic input change.
- Verify ES256 JWT issuer, audience, typ, expiry, and skew failures; require the
  current protected-header `kid`, reject missing/unknown/non-ES256 keys, and
  cover PKCS#8 signing plus current/retired SPKI verification-key rotation.
- Verify Argon2id parameters and rehash decision without snapshotting secrets.
- Verify HIBP sends only a five-character SHA-1 prefix, parses padded range
  responses, caches prefixes for 24 hours, enforces two-second timeout, rejects
  matches, and fails closed in production while bypass is rejected there.
- Verify deterministic email/refresh token derivation fixtures by key version,
  decrypt/verify-old plus encrypt/sign-current behavior, and unknown-key
  fail-closed handling without snapshotting key material.
- Verify log redaction for headers, bodies, provider events, PII, and errors.
- Verify SNS canonical-string construction against AWS-published fixtures.
- Parse the exact AWS rendering-failure fixture with raw `eventType: "Rendering
  Failure"` and `failure`, and reject any camel-cased substitute object key.
- Verify SNS AES-GCM normalized AAD, tag/nonce failures, old-key decryption,
  current-key encryption, and nullable-envelope erasure with retained digest.
- Verify retry classification, all backoff slots, jitter bounds, monotonic
  delivery transitions, and masking.
- Verify idempotency hashing changes for method, route template, normalized
  path/query, `If-Match`, or body and is stable for canonical equivalents.
- Verify web refresh derives byte-identical successor refresh/CSRF values for
  one key version/generation/rotationId and rejects cross-purpose derivation.
- Verify current-refresh + previous-CSRF + identical rotationId recovers a
  partially consumed response inside grace without another write; wrong ID,
  another mixed pair, or expired grace follows the reuse failure path.

### 8.2 PostgreSQL integration tests

- Active normalized email and phone uniqueness under concurrent submissions.
- New and duplicate-active signup return identical generic accepted data; a
  pending duplicate outside the 15-minute cooldown creates exactly one
  successor verification delivery, while other active duplicates create none.
- Application, both consents, verification hash, outbox, delivery, and
  idempotency response commit or roll back together.
- Consent evidence references locked current consent_documents rows and stores
  document digest plus IP HMAC, never raw IP.
- Verification consumes once; concurrent verification has one winner.
- Review-start has one submitted-to-in_review winner; decision from submitted
  is impossible and reason code/detail are persisted append-only.
- Concurrent approval creates exactly one user/invite/review/audit/delivery.
- Rejection creates no user/credential/session/invite and atomically creates its
  required rejection-email delivery/outbox.
- Stale expectedVersion and expectedInviteId return STATE_CONFLICT.
- Concurrent resend creates one replacement; replay does not revoke it.
- Activation token has one winner and atomically creates credential/session.
- Repeated native login on one device atomically revokes/replaces the active
  device session; a uniqueness race leaves exactly one active session.
- Five credential failures inside one 15-minute database-time window set one
  15-minute lock; a slow failure outside the window restarts at count one,
  locked attempts do not extend/change it, and success clears count/window/lock.
- Refresh rotation has one winner; after a lost response or reload the same
  previous refresh/CSRF pair and client rotationId inside 30 seconds returns the
  byte-identical successor. Concurrent tabs share it; wrong/missing previous
  CSRF, another ID, or expired grace revokes the family. GET CSRF rejects the
  consumed previous cookie and does not overwrite replay evidence.
- Idempotency same hash replays and different hash conflicts after advisory
  lock acquisition; pg_try_advisory_xact_lock failure returns in-progress,
  rollback leaves no row, and no processing/lease row exists.
- Atomic fixed-window increments enforce every route dimension across
  concurrent connections; expiry cleanup is bounded and limiter-outage
  fail-closed/open policy matches route class.
- Retention fixtures straddle every exact boundary, honor exact/parent legal holds,
  tombstone rejected/withdrawn/unverified PII, purge encrypted
  delivery/provider ciphertext, tombstone linked approved applications with
  closed users, permit identifier reuse, and preserve required evidence. Cover
  released/expired/unrelated holds and both winners of the shared-parent-lock
  hold-placement/cleanup race: hold-first blocks purge; cleanup-first reports
  already-purged and the later hold protects remaining evidence.
- Prove an unconverted marketing-lead hold blocks its 24-month purge, a
  converted lead resolves the linked application hold, and an email-provider
  event hold protects its source-linked suppression evidence.
- Outbox SKIP LOCKED claims are disjoint, leases recover, attempt counters and
  dead-letter/cancel transitions are durable; delivery rows have no independent
  due/lease. Test revoke-before-sending (no SES, exact cancellation code),
  crash-after-sending commit, revoke-after-sending (possible harmless email),
  lost SES response, and Delivery Delay without re-enqueue.
- SNS MessageId and SES sesMessageId uniqueness prevent duplicate effects.
- Signed `boe_delivery_id` correlates bounce/complaint when SNS arrives before
  the SES result commit or after a lost SES response; bounded unmatched
  reconciliation later cross-checks a recorded message ID and applies
  suppression exactly once without recipient/template guessing.
- SNS ingress commits one encrypted/digested received inbox row before 200;
  workers lock with SKIP LOCKED, apply delivery/suppression plus processed
  atomically, rollback to received on failure, classify ignored/unmatched, and
  reject same MessageId/different digest without invented processing/dead-letter
  states.
- A validly signed SNS message with malformed/unsupported inner SES content is
  committed once as `ignored` with redacted dead-letter/reconciliation evidence
  and returns 200; only failed provenance/signature is rejected.
- Client/admin ownership and permission predicates occur in SQL.

### 8.3 API integration tests

- Snapshot every operation's success and every documented error envelope.
- Validate content type, payload limit, request ID, no-store auth headers,
  Retry-After, pagination cursor/filter binding, and output schema enforcement.
- Assert the exact nonce-bearing CSP and companion security headers on every
  landing/admin HTML response, including rendered consent pages.
- Prove public copy/data never exposes KYC, risk, approval internals, or
  investing eligibility.
- Prove new and duplicate signup both return exactly 202 { accepted: true },
  expose no UUID/state/expiry, and render the exact Join BeOnEdge CTA.
- Prove invalid login identifiers and passwords are indistinguishable.
- Prove unknown, wrong-password, and locked login responses share the same
  `INVALID_CREDENTIALS` envelope and comparable Argon2id timing class.
- Prove logout, session replacement, suspension/closure, and permission
  revocation stop protected native/admin requests immediately despite a live JWT.
- Prove native endpoints reject cookies and web endpoints reject bearer/JSON
  refresh tokens.
- Check both cookie Set-Cookie strings exactly, including HttpOnly, Secure,
  SameSite=Lax, Path=/, no Domain, and Max-Age.
- Check CSRF missing, wrong, stale, cross-origin, cross-site, and rotated-token
  cases; GET web CSRF succeeds with valid access or refresh cookie and no prior
  CSRF, rotates the session hash outside replay grace or reproduces current CSRF
  without a write inside replay grace, and changes no refresh/session expiry; it
  rejects a consumed previous cookie and preserves an ambiguous-retry pair.
- Exercise each role/permission mapping and confirm 403 without data leakage.
- Snapshot email delivery results for full-read, masked-read, neither, and both
  permissions; masked support output contains no subject/outbox/SES/provider/
  ciphertext/HMAC/key or raw failure fields, and both permissions select the
  full safe administrative projection.
- Exercise all idempotency replay/conflict/concurrency cases.
- Exhaust every PostgreSQL rate-limit route class, Retry-After/header values,
  nginx overwrite/direct-hop and authenticated landing-BFF source parsing,
  spoofed forwarding/internal headers, fail-closed mutation/auth/SNS, and fail-open+alert
  authenticated-read behavior.
- Feed valid AWS fixtures plus wrong topic, wrong cert host, redirect,
  stale timestamp, invalid signature, duplicate, malformed inner event, and
  unsupported signed event.
- Prove consent responses return immutable `publicPath`, exact Markdown, and
  matching digest; public new/duplicate signup remains identical `202`.

### 8.4 End-to-end tests

- Landing signup shows learner-facing copy, queues verification, verifies, and
  appears in the admin queue.
- Admin explicitly starts review before deciding; direct submitted-to-decision
  returns STATE_CONFLICT.
- Admin approves with a reason; approval email is sent; Android activation link
  activates once; the learner signs in, refreshes, and logs out.
- Verification and activation links contain the bearer only after `#` and send
  `Referrer-Policy: no-referrer`. Verification may POST after removing its
  fragment; activation fallback makes zero activation API calls and preserves
  the fragment for “Open BeOnEdge” App Link handoff. Logs, referrers, and
  analytics contain no token or unredacted activation/verification path.
- Admin rejects; the same transaction queues the required token-free
  application_rejected email, the recipient receives it, and no
  user/credential/session/invite exists or can sign in.
- SES transient failures retry without duplicate user/invite; permanent failure
  is inspectable and safe resend works.
- Two admins approve concurrently; one succeeds and one sees the current state.
- Two admins resend concurrently; one replacement survives and the old emailed
  link cannot activate.
- Browser admin reload obtains a new CSRF token and completes a protected
  action; logout revokes the session.
- Two browser tabs requesting one refresh use one rotationId and both receive
  the same CSRF result without revoking the family; one ambiguous retry after a
  leader reload reproduces that result, while grace expiry or a different ID
  revokes the family.

### 8.5 Android tests

- platformStorage.secure is required on native and no localStorage token keys
  are written.
- Cold start, warm App Link, expired/revoked activation, app restart, process
  death, and offline activation/refresh produce deterministic recovery.
- The HTTPS fallback offers APK download/App Link only; the installed client
  alone supplies password/device data, exchanges activation, and stores refresh.
- Access token disappears on process death; secure refresh restores the session.
- Concurrent 401s cause one refresh and each original request is retried once.
- An ambiguous native refresh retries once with the same rotationId and receives
  the same successor; generating a different rotationId revokes the family.
- Reauthenticating the same installation revokes the old device session before
  installing the replacement secure refresh record.
- Network refresh failure preserves the unexpired refresh token; refresh 401
  clears it.
- Logout awaits revocation and always clears secure storage.
- Release manifest forbids cleartext/mixed content and backup/transfer excludes
  sensitive storage.
- `appRestoredResult` restores a plugin-call fixture only; ordinary workflow
  restart uses a non-sensitive workflow ID and refetches server state.

### 8.6 Performance and resilience

- Load test application submission, web/native login, admin queue paging, SNS
  bursts, and 10-worker outbox claiming.
- Initial targets: p95 below 500 ms for non-provider API calls at 50 requests/s,
  no duplicate domain rows, admin queue query below 100 ms at 100,000
  applications, and 1,000 SNS notifications accepted within 60 seconds.
- EXPLAIN ANALYZE must show bounded index scans for admin queue, idempotency,
  due outbox, delivery list, session token lookup, and SNS deduplication.
- Kill workers after claim and after SES response simulation to prove lease
  recovery and safe duplicate-email behavior.

Coverage must be at least 80 percent for statements, branches, functions, and
lines in each changed package, not merely repository aggregate. Auth, CSRF,
idempotency, authorization, token rotation, state guards, outbox, and SNS
modules require 90 percent branch coverage. Coverage exclusions are limited to
generated OpenAPI types and declarative migration files.

## 9. Per-slice review and release gates

Apply this gate separately to application submission, verification, review,
activation/email, web auth, and native auth:

1. Tests and contract changes are written first and observed failing.
2. Implement the minimum behavior; run unit, PostgreSQL integration, API, type
   check, lint, OpenAPI generation/staleness, and relevant E2E/Android tests.
3. Run a general code review and the language-specific TypeScript review.
   Review the full slice diff for immutability, boundary validation, errors,
   files/functions, duplication, query bounds, and generated drift.
4. A security review is mandatory for every slice because all slices touch user
   input, PII, auth, database queries, external email, or privileged admin
   behavior. It explicitly checks OWASP risks, enumeration, token storage,
   CSRF/CORS, SQL parameterization, authorization, rate limits, redaction,
   cryptographic comparisons, SNS SSRF/signatures, and secrets.
5. CRITICAL and HIGH findings block integration. MEDIUM findings are fixed in
   the slice unless an owner, issue, rationale, and deadline are recorded;
   auth/PII/provider MEDIUM findings also block. LOW findings may be tracked.
6. Re-run the entire affected test matrix and coverage after review fixes.
   Record exact commands and results in the integration note.

No slice is accepted with skipped security tests, stale OpenAPI output,
insecure-cookie exceptions outside tests, raw tokens in logs/fixtures, a
localStorage native fallback, or less than the required coverage.
