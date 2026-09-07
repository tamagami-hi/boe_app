# 05 — Configuration audit

The governing rule for this pass, from the audit brief:

> Do not retain settings that give operators the illusion of controlling behaviour when the value
> is never actually consumed.

Two findings were the inverse of each other: settings that did nothing, and a setting that did
something important while being documented nowhere.

## 1. Method

The consumed-key set is the union of:

- the Zod schemas in `runtime/environment.ts` (both `RuntimeEnvironmentSchema` and
  `ServerConfigSchema`), `db/config.ts` and `crypto/context.ts`;
- every `process.env.X`, `source.X` and `env.X` read across `backend_controller/src` and
  `backend_controller/scripts`.

That last clause matters: `PASSWORD_BREACH_CHECK_MODE` is read as `env.PASSWORD_BREACH_CHECK_MODE`
in `auth/breachCheck.ts:34`, not through a schema, and a schema-only scan reports it dead.

Compared against the declared keys of four example files in **both** directions.

## 2. Settings removed

### The root `.env.example` — deleted entirely

There is **no root compose file**. Nothing reads a root `.env`: every consumer uses
`--env-file-if-exists=.env` from within `backend_controller/`, and the one root script points at
`backend_controller/.env`. Its infrastructure keys — `FRONTEND_PORT`, `POSTGRES_HOST_BIND`,
`PUBLIC_API_BASE_URL` — appear nowhere outside `release_manager/stacks/`, which uses different
names (`APP_FRONTEND_PORT`, `ADMIN_FRONTEND_PORT`).

It was an artefact of the pre-`release_manager` single-compose layout, and six of its keys were
already retired or dead: `PROVIDER_MODE`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ALLOW_DEV_AUTH`, `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME`.

`CLAUDE.md:98` referenced it ("Two `.env` files: project root and `backend_controller/`") and was
corrected in [07](07-tooling-deployment-docs.md).

### `backend_controller/.env.production.example`

| Removed | Why |
| ------- | --- |
| `DATABASE_SSL` | `db/config.ts` has **no SSL key at all**. TLS is not configurable; setting this does nothing |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | Pre-rewrite symmetric names. The real scheme is asymmetric ES256: `ACCESS_TOKEN_SIGNING_KEY` + `ACCESS_TOKEN_VERIFICATION_KEYS`, with `REFRESH_HMAC_KEY` for deterministic refresh derivation |
| `ALLOW_DEV_AUTH` | No implementation. Dangerous residue: reads as though an auth bypass exists and can be switched |
| `MOCK_WEBHOOK_ENABLED` | No implementation |

After this file has **zero** unread keys.

### `release_manager/stacks/prod_release/.env.example`

`PROVIDER_MODE=live` removed — no reader anywhere. Note the asymmetry that hid it: it was declared
in the **production** example only, not dev.

### Both stack compose files

A six-line block passed into the backend container that nothing reads:

```
DATABASE_HOST: postgres
DATABASE_PORT: "5432"
DATABASE_NAME: ${POSTGRES_DB}
DATABASE_USER: ${POSTGRES_USER}
DATABASE_PASSWORD: ${POSTGRES_PASSWORD}
DATABASE_SSL: "false"
```

`DATABASE_URL` on the preceding line is the only value consumed, and it already contains all of
this. `MIGRATIONS_DIR` **is** read (`scripts/migrate.ts:109`) and stays.

## 3. `SEED_ADMIN_*` — a setting that silently did nothing

The clearest instance of the illusion-of-control class.

The root `.env.example` published `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME` and
`SEED_ADMIN_PHONE`. `scripts/seedAuth.ts` read `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` and
`ADMIN_PHONE`. Setting the documented names had no effect; the administrator silently seeded as
`"BeOnEdge Admin"`.

What hid it: the **sibling keys work**. `SEED_CLIENT_FIRST_NAME` and `SEED_CLIENT_LAST_NAME` *are*
read, and so are `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. Only the admin's name and phone had
the mismatch.

**Fixed in the code, not the example.** `resolveSeedAuthConfig` now reads `SEED_ADMIN_FIRST_NAME ??
ADMIN_FIRST_NAME`, and likewise for last name and phone. That direction was chosen because:

- `SEED_*` is the consistent spelling every sibling key uses;
- the function **already** uses exactly this fallback shape for
  `SEED_ADMIN_EMAIL ?? ADMIN_LOGIN_ID`;
- `.env.production.example` publishes the bare `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` /
  `ADMIN_PHONE`, so both spellings must keep working.

**TESTED** — `seedAuth.test.ts`, 16 tests, pass.

## 4. `TRUST_PROXY` — the inverse problem

`TRUST_PROXY` is the **only** control over whether `X-Forwarded-For` is believed, and therefore
whether the IP addresses recorded in `auth_login_events.ip_address` and `auth_sessions.ip_address`
are the real client's or the proxy's. `environment.ts` carries a long rationale comment about it.

It appeared in **no** env example. Every deployment ran on the built-in default, and no operator
could discover the knob from any committed file. That is a forensic-integrity setting hidden by
omission.

Now documented in `backend_controller/.env.example`, along with two more that were equally
invisible despite `db/config.ts` carrying a paragraph on connection starvation:
`DB_STATEMENT_TIMEOUT_MS` and `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`.

Documenting in `backend_controller/.env.example` has no deployment effect and no
`envPassthrough` consequence — see §6.

## 5. Reported, not changed

**`PAYMENT_PROVIDER` is single-valued.** `z.literal("phonepe").default("phonepe")`, surfaced as
`readonly provider: "phonepe"`. A provider switch that cannot switch. Any branch on it is
structurally unreachable in its non-`phonepe` arm. Removing it changes a public config surface and
the `ServerConfig` shape; a decision, not a cleanup.

**`APK_DOWNLOAD_BASE_URL` is a two-value enum of hard-coded hostnames.** Deployment hostnames are
compiled into the schema, so any new environment fails to boot until the schema is edited. A config
smell, not dead code.

**The SES/SNS inbox is dead in deployment.** `AWS_REGION`, `SNS_TOPIC_ARN` and
`SES_CONFIGURATION_SET` are declared in the schema and present in `backend_controller/.env.example`,
but appear in **neither** stack `.env.example`. Because `composition.ts` registers the SNS inbox
only when region and topic ARN are both non-null, in both deployed stacks:

- `routes/providerEventRoutes.ts` is never mounted;
- `email/certificateFetcher.ts`, `email/snsMessages.ts`, `email/snsProvenance.ts` are unreachable;
- the `email_provider_events` table is never written;
- `emailConfigured` is permanently `false` and `sesConfigurationSet` is permanently the literal
  `"unconfigured"`, which is what gets stored into `email_deliveries.ses_configuration_set`;
- `PROVIDER_EVENT_TTL_MS` computes an `expires_at` on a route that is not mounted.

Classification: **BROKEN-STUCK / dead-in-deployment** — live, correct code that configuration makes
unreachable. **Not changed**, because adding those keys to a stack example would require a compose
passthrough (`envPassthrough` asserts this) and would switch on a code path that has never run in
that stack. That is a maintainer's decision.

**Keys read only by shell, not TypeScript.** `EMAIL_WORKER_INTERVAL_SECONDS`,
`SIP_WORKER_INTERVAL_SECONDS` and `COLLECTION_WORKER_INTERVAL_SECONDS` are consumed as
`${VAR:-default}` inside the compose worker commands. They are not dead but are invisible to any
`src/`-level scan, which is why they are in the guard's allowlist. Related observation:
`worker:payments:watch` in `backend_controller/package.json` is byte-identical to
`worker:payments:dev` — a duplicate script, since the payments entrypoint loops internally.

## 6. The new guard

`envPassthrough.test.ts` previously asserted one direction only: every key that is *both* in a
stack `.env.example` *and* in the backend schema must be `${…}`-substituted in that stack's compose
file. Two structural blind spots follow:

- a schema key **missing** from the example is filtered out and can never fail — which is exactly
  how `AWS_REGION`, `SNS_TOPIC_ARN`, `SES_CONFIGURATION_SET` and `TRUST_PROXY` escaped;
- a key the schema does **not** declare is invisible — which is how every dead setting in §2
  survived, including `PROVIDER_MODE` in a production template.

Added: **"no environment example offers a setting nothing consumes"**, across
`backend_controller/.env.example`, `backend_controller/.env.production.example` and both stack
examples. It builds the consumed set as described in §1 and subtracts an explicit
`INFRASTRUCTURE_KEYS` allowlist — compose ports, Postgres credentials, APK bind-mount directories,
the three shell-read worker intervals, `REDIS_MAXMEMORY`, `BOE_VERSION`.

A sanity assertion guards the scan itself (`consumed.size > 80`, and `TRUST_PROXY`,
`DB_STATEMENT_TIMEOUT_MS` and `PASSWORD_BREACH_CHECK_MODE` must all be present), so a regex that
silently stops matching fails loudly instead of passing vacuously.

**Proven both ways.** Appending `PROVIDER_MODE=development` to `backend_controller/.env.example`
made the test fail with `expected [ 'PROVIDER_MODE' ] to strictly equal []`; removing it made it
pass. The file now has 10 tests.

The allowlist is the honest weak point: an infrastructure key added there is exempt forever. It is
short, explicit, and every entry is justified above.
