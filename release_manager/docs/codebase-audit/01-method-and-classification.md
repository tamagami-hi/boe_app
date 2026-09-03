# 01 — Method and classification

## How reachability was established

Grep alone was rejected as evidence. For every candidate, reachability was checked through:

| Path | How it was checked |
| ---- | ------------------ |
| Direct imports | Full import graph over 212 frontend files resolving `~/*` aliases, relative specifiers, and `import()` calls |
| Route registration | `runtime/composition.ts` read end to end; every `register*Routes` call enumerated with its line and its config gate |
| Framework startup | The four worker entrypoints plus `server.ts`, and the compose files that run them |
| Callbacks and handlers | Provider webhook routes, `subscribe*` helpers, Capacitor `registerPlugin` bridging by name |
| Background workers | Each `compose*Worker` factory traced from entrypoint to repository call |
| Dynamic / lazy loading | `React.lazy` route manifests, and `buildRouter`'s `lazyElement` wrapper |
| Config-driven behaviour | Every `PHONEPE_*` / relay / SNS gate, because four route registrations are conditional |
| Generated code | The generator (`generate-api-client.mjs`) rather than its output |
| Persistence | Kysely types *and* raw `sql` template usage — `fund_stock_disclosures` is only reachable through raw SQL and a type-only audit would have wrongly called it dead |
| Tests as contracts | Negative assertions (`assert.doesNotMatch`) and security assertions treated as evidence *for* retention |
| Deployment | `deploy.sh` / `export.sh` / `rollback.sh` / `verify.sh` / `status.sh` call graph, and `lib/*.sh` per-function reference counts |

Two mechanical checks did the bulk of the work:

**Frontend dead exports.** A script requiring both *zero references in any other file* and
*exactly one occurrence in the declaring file* (i.e. the declaration itself). The second
condition is what separates genuinely dead from merely over-exported. It reduced 237
unreferenced exports to 26 real candidates, of which 24 were removed and 2 turned out to be
generator output.

**Configuration.** The union of three Zod schemas (`runtime/environment.ts`, `db/config.ts`,
`crypto/context.ts`) plus every `process.env.X` / `source.X` / `env.X` read across `src/` and
`scripts/`, compared against the declared keys of four example files in both directions.

## The traps that produced false results

Recorded because the next tool will hit them.

1. **Dynamically rendered links.** `OverviewScreen.tsx:80-84` filters `ADMIN_ROUTES` and renders
   `<Link to={route.path}>`. A literal-path scan sees nothing and reports four route edges as
   unreachable. All four are reachable.
2. **Two naming systems in generated code.** The operation registry was keyed by `operationId`
   while the export block uses `exportName`, so `logoutNativeSession: nativeLogout` looks like a
   duplicate alias and is not.
3. **Glyph maps.** `navGlyphs.tsx` exports `HomeGlyph`…`ProfileGlyph` which are consumed only
   through a `NAV_GLYPHS` record. Export-reachability tooling reports five false positives here.
4. **Tailwind v4 `@theme inline`.** Custom properties in `theme.css` generate *utility classes*;
   they are consumed by class name, never by `var()`. 180 of 357 properties have no `var()`
   reference and that is not evidence of disuse. Only the plain `:root` variables in
   `tokens-core.css` are `var()`-consumed and therefore analysable this way.
5. **Mocks cast through `as unknown as`.** Two `vi.fn()` stubs for removed repository methods
   survived the type-checker silently. Only the symbol sweep found them.
6. **Raw SQL.** Tables reached only through `sql\`…\`` templates are invisible to a Kysely-type
   audit.

## Classification

Every candidate was assigned exactly one class before being touched.

**DEAD** — no valid runtime, build, deployment or compatibility path exists.
*Removed.* Examples: the 14 unconsumed port interfaces, `createLogEmailSender`,
`pushSystemChrome` and the entire push/subscribe machinery it alone drove.

**STALE** — belongs to a superseded implementation.
*Removed, or corrected where it was documentation.* Examples: `lockByEmailWithCredential`
(superseded by the non-locking login lookup, and both its doc comments said "used to"),
`test_e2e/frontend-ts-shots.mjs` (hand-maintained 20-path list versus the manifest-derived
45-route audit tool), `DEPLOY.md` in its entirety, the `x-worker-health` file probe.

**DUPLICATE** — several implementations of one responsibility.
*Consolidated onto the authoritative one, after establishing which that was.* Examples: three
ad-hoc `Intl.NumberFormat` constructions versus `domain/money.ts`; `AsyncBoundary`'s
`isSessionEndingError` versus `api/errors.ts:isSessionEnded` (verbatim identical logic — and
the reason `isSessionEnded` had no importers); `ApplicationQueueQuery`, `UserWithCredential` and
`RevokeSessionsResult` each declared twice.

**BROKEN / STUCK** — reachable, but the lifecycle is invalid.
*Fixed, or reported with the product question stated.* The five paths in
[02](02-lifecycle-and-state-machines.md).

**LATENT / INTENTIONALLY RETAINED** — not normally executed but required.
*Untouched, with the reason recorded.* [08](08-retained-and-uncertain.md).

**ACTIVE** — current supported behaviour. *Untouched.*

**UNCERTAIN** — possibly obsolete, evidence insufficient.
*Untouched and reported.* [08](08-retained-and-uncertain.md) §3.

## The rules that governed removal

1. Only `DEAD`, `STALE` and proven-safe `DUPLICATE` were removed.
2. `BROKEN / STUCK` was fixed or reported, never deleted.
3. `UNCERTAIN` was left alone.
4. A test asserting a security, compatibility or data-integrity contract counted as evidence
   **for** retention — but a test asserting only that a string exists did not. That distinction
   decided two cases in opposite directions: `mandatesRepository.findMandateForOwner` was
   **kept** because an integration test asserts owner-scoping, while
   `mandatesRepository.findCollectionAttemptForOwner` — its structural sibling, equally dead, with
   no test — was **removed**.
5. After each removal, the cascade was re-checked. This is what turned one export into a
   subsystem: removing `pushSystemChrome` left `notify` unreachable and
   `subscribeToSystemChrome` unable ever to emit, so the whole stack/subscriber layer went.
6. Database structures were never dropped.
7. No source comments were added, per the root `README.md`. Where an existing comment referenced
   a removed symbol it was rewritten, since it was directly involved in the change.

## Verification vocabulary

Used throughout these documents, matching the convention in
`release_manager/docs/frontend-typescript-redesign-architecture/`:

- **TESTED** — a command was run here and passed; the command is named.
- **STATIC** — read or type-checked only.
- **VPS** — observed read-only on the deployed stack. *Nothing in this audit carries this mark.*
- **UNVERIFIED** — needs a device, emulator, database or deploy. The exact command is given.
