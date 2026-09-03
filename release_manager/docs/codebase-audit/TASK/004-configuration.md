# 004 — Configuration

The rule for this pass, from the brief:

> Do not retain settings that give operators the illusion of controlling behaviour when the value is
> never actually consumed.

Two findings were exact inverses of each other, and the pairing is the interesting part.

## The setting that did nothing

The root `.env.example` published `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME` and
`SEED_ADMIN_PHONE`. `scripts/seedAuth.ts` read `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME`, `ADMIN_PHONE`.

Setting the documented names did nothing. The administrator silently seeded as `"BeOnEdge Admin"`.

What hid it for so long is that the neighbours work: `SEED_CLIENT_FIRST_NAME` and
`SEED_CLIENT_LAST_NAME` *are* read, and so are `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. Only the
admin's name and phone had the mismatch, in a file where everything around them behaved.

Fixed in the **code**, not the example: `resolveSeedAuthConfig` now reads
`SEED_ADMIN_FIRST_NAME ?? ADMIN_FIRST_NAME` and so on. That direction because `SEED_*` is the
consistent spelling every sibling uses, the same function **already** does exactly this for
`SEED_ADMIN_EMAIL ?? ADMIN_LOGIN_ID`, and `.env.production.example` publishes the bare `ADMIN_*`
names, so both spellings have to keep working.

## The setting nobody could find

`TRUST_PROXY` decides whether `X-Forwarded-For` is believed, and therefore whether the IP addresses
in `auth_login_events.ip_address` and `auth_sessions.ip_address` are the real client's or the proxy's.
`environment.ts` carries a long rationale comment about it.

It appeared in **no env example**. Every deployment ran on the built-in default and no operator could
discover the knob from any committed file. A forensic-integrity setting hidden by omission.

Now documented, along with `DB_STATEMENT_TIMEOUT_MS` and `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` — which
were equally invisible despite `db/config.ts` carrying a paragraph about connection starvation.

## What was removed

The **root `.env.example`, entirely.** There is no root compose file; nothing reads a root `.env`
(every consumer uses `--env-file-if-exists=.env` from inside `backend_controller/`); and its port and
Postgres keys appear nowhere outside `release_manager/stacks/`, which uses different names. It was
an artefact of the pre-`release_manager` layout, and six of its keys were already retired.

From `backend_controller/.env.production.example`: `DATABASE_SSL` (`db/config.ts` has no SSL key at
all — TLS is not configurable), the pre-rewrite symmetric `ACCESS_TOKEN_SECRET` and
`REFRESH_TOKEN_SECRET` (the scheme is asymmetric ES256), `ALLOW_DEV_AUTH` and `MOCK_WEBHOOK_ENABLED`
(no implementation). `ALLOW_DEV_AUTH` is the one worth naming: a dead flag that reads as though an
auth bypass exists and can be switched on.

From the production stack example: `PROVIDER_MODE=live`, no reader. Note the asymmetry that hid it —
declared in the production template only, not dev.

From both compose files: a six-line block passed into the backend container that nothing reads —
`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`,
`DATABASE_SSL`. The `DATABASE_URL` on the line above already contains all of it. `MIGRATIONS_DIR`
**is** read (`scripts/migrate.ts:109`) and stays.

## Why the existing guard could not have caught any of this

`envPassthrough.test.ts` asserted one direction: every key that is *both* in a stack `.env.example`
*and* in the backend schema must be `${…}`-substituted into that stack's compose file.

An intersection has two blind spots, and both were live:

- a schema key **missing** from the example is filtered out and can never fail — which is exactly how
  `TRUST_PROXY` and the three SNS keys escaped;
- a key the schema does **not** declare is invisible — which is how `PROVIDER_MODE` survived in a
  production template.

Added: **"no environment example offers a setting nothing consumes"**, across four example files.

Building the consumed set correctly took one correction. A schema-only scan reports
`PASSWORD_BREACH_CHECK_MODE` dead, because `auth/breachCheck.ts` reads it as
`env.PASSWORD_BREACH_CHECK_MODE` rather than through Zod. So the set is three Zod schemas **plus**
every `process.env.X` / `source.X` / `env.X` read across `src` and `scripts`.

Infrastructure keys — compose ports, Postgres credentials, APK bind mounts, the three shell-read
worker intervals, `REDIS_MAXMEMORY`, `BOE_VERSION` — are an explicit allowlist. Inferring them by
naming convention was rejected: `PROVIDER_MODE` and `DATABASE_SSL` would have passed any such
heuristic.

A sanity assertion guards the scan itself, so a regex that silently stops matching fails loudly
instead of passing vacuously.

**Proven both ways before being trusted.** Appending `PROVIDER_MODE=development` to
`backend_controller/.env.example` produced
`expected [ 'PROVIDER_MODE' ] to strictly equal []`; removing it passed.

## Reported, not changed

**The SES/SNS inbox is dead in deployment.** `AWS_REGION`, `SNS_TOPIC_ARN` and
`SES_CONFIGURATION_SET` are in the schema and in `backend_controller/.env.example` but in **neither**
stack example. Because `composition.ts` registers the SNS inbox only when region and topic are both
present, in every deployed stack `routes/providerEventRoutes.ts` is never mounted, three email
modules are unreachable, `email_provider_events` is never written, and `sesConfigurationSet` is
permanently the literal `"unconfigured"` — which is what gets stored into
`email_deliveries.ses_configuration_set`.

Live, correct code that configuration switches off. Not changed: adding the keys needs a compose
passthrough (the guard asserts it) and would switch on a path that has never run. A-004 records the
refusal to add them merely to satisfy a test.

**`PAYMENT_PROVIDER` is `z.literal("phonepe")`** — a provider switch that cannot switch. Removing it
changes a public config surface and the `ServerConfig` shape.

**`worker:payments:watch` is byte-identical to `worker:payments:dev`** — the payments entrypoint
loops internally, so the `:watch` variant is a duplicate script.

## What to check next

The SNS decision is the only substantive one here: either wire those three keys into both stacks
(accepting that a never-run code path goes live), or delete the SES/SNS inbox as unshipped. Leaving
it is the current state and it is the least honest of the three.
