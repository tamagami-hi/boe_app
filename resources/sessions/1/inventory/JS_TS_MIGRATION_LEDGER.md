# Authored JavaScript/TypeScript Migration Inventory

Snapshot: immediately after code checkpoint `9e884ad`. This inventory excludes
dependencies, build output, ignored generated Android bundles, reference
material, and `resources/sessions/Legacy`.

## Global Backlog

| Class | Production/config | Tests | Total |
|---|---:|---:|---:|
| Literal `.js`/`.jsx` | 272 files / 32,433 lines | 5 files / 647 lines | 277 files / 33,080 lines |
| Active `.mjs` tooling/config | 4 files / 96 lines | 0 | 4 files / 96 lines |
| **JS-family active total** | **276 files / 32,529 lines** | **5 files / 647 lines** | **281 files / 33,176 lines** |

The four MJS files are the backend and contracts ESLint configs, the Android
asset check, and landing Next config. They are not application runtime fallback
code. Each owning tooling task must either replace them where the platform
supports TypeScript or record a narrow non-production config exception. Zero
authored application `.js/.jsx` remains the unconditional final gate.

Ignored generated Android web output is separate: six JS artifacts, 365
physical lines, 481,427 bytes. Regenerate or remove it after the TS source
cutover; never port minified/generated output by hand.

## Backend: Complete Partition Of 89 Remaining Files

| Closure | Production | Tests | Replacement/deletion rule |
|---|---:|---:|---|
| Runtime config/logging | DONE (was 3 / 219) | 0 | BE-003 deleted `src/config/env.js`, `src/config/dotenv.js`, `src/shared/logger.js`; typed `runtime/*` boundary authoritative |
| Persistence core + DB scripts | 3 / ~490 (was 5 / 700) | 0 | BE-004 added typed pool/Kysely/tx; BE-005 deleted `scripts/migrate.js`, `check-db.js`. Remaining: `src/db/client.js`, `pgAdapter.js`, `store.js` (whole-store adapter; deleted at consumer cutover, never ported) |
| Identity/auth/onboarding | 6 / ~1,077 + 1 test (was 7) | 1 / 70 | BE-005 deleted `scripts/seed-auth.js`; typed bootstrap seed lands with BE-007. Canonical repositories/security/Fastify auth replace the rest (BE-007..BE-010) |
| Public content/catalog | 9 / 1,473 | 2 / 411 | Canonical content/catalog routes/repositories; monolithic public route deletes last |
| Money/events/shared read models | 17 / 1,720 | 1 / 39 | Contract/domain types and provider boundaries; do not bless legacy hardcoded behavior |
| Client API/domain | 16 / 2,573 | 0 | Descriptor-backed client route groups; 436-line route monolith deletes after all imports move |
| Admin API/domain | 12 / 3,220 | 0 | Typed admin domains/routes; 590-line route monolith deletes after all imports move |
| Legacy transport/guards | 16 / 1,028 | 0 | Delete after canonical Fastify/typed inventory/authz guards exist |
| **Total (after BE-005)** | **~79 / ~11,690** | **4 / 520** | **83 files / ~12,210 lines** |

BE-003 (branch `ts-migration/backend`) deleted the 3-file / ~208-line runtime
config/logging closure, moving the backend authored backlog from 89 files /
12,600 lines to 86 files / 12,392 lines. The `eslint.config.mjs` files (backend
and contracts) are classified tooling exceptions among the four active MJS
files, not authored application backlog.

Raw backend ownership totals: 78 production source files / 11,636 lines, seven
operational scripts / 444 lines, and four tests / 520 lines.

## Frontend: Complete Partition

Literal authored JS/JSX totals are 187 production/config files plus one test:
188 files and 20,480 lines. Active MJS adds the 12-line Android check and
34-line landing Next config.

| Closure | Files/lines | Dependency/delete rule |
|---|---:|---|
| Dead design-token/UI-kit code | 6 / 1,266 | Prove no runtime imports, then delete rather than translate; preserve required CSS/assets |
| Shared foundation | 23 / 1,522 | Convert before client/admin consumers |
| Client platform/API/data/math | 35 prod / 2,247 + 1 test / 127 | Generated contract client replaces hand-rolled types/API; platform security first |
| Client React foundation | 14 / 994 | App lock, charts, layouts, session stores |
| Client auth/onboarding pages | 7 / 1,043 | After typed session/auth boundary |
| Client investing pages | 6 / 2,254 | After catalog/order contracts |
| Client servicing pages | 11 / 1,411 | Portfolio/activity/payment/profile/support closures |
| Client root/index | 2 / 147 | Final client export cutover |
| Admin legacy deletion | 4 / 500 | Delete context/tab/redirect/legacy routes; do not port legacy names |
| Admin foundation | 28 / 1,343 | Components/helpers/hooks/navigation/layout |
| Admin site CMS | 19 / 1,916 | Typed content schemas/editors |
| Admin identity/control | 9 / 1,601 | Approval/KYC/user/permissions |
| Admin financial control | 6 / 1,087 | Payments/mandates/SIP/transactions |
| Admin AUM | 5 / 1,987 | Typed snapshot/control workflow |
| Admin app builder | 1 / 493 | Replace only against approved content/config model |
| Admin stub deletion | 1 / 41 | Delete; do not translate |
| Admin pages/root | 4 / 244 | Final admin exports/cutover |
| Vite app shell/config | 7 / 269 | Last after shared/client/admin; includes 12-line Android MJS check |
| Landing config | 1 MJS / 34 | Source is already TS; disable `allowJs`, validate platform config support |

Landing source baseline: 55 production TS/TSX files / 3,345 lines and three TS
tests / 222 lines. It has no authored JS/JSX source.

## Dependency Order

1. Contracts generator and consumer package wiring.
2. Backend lifecycle/config/persistence/HTTP foundations.
3. Identity/onboarding/auth, then content/providers/finance/admin domains.
4. Backend route/guard inventory and zero-JS proof.
5. Dead frontend package cleanup, shared foundation, client platform/services.
6. Client React/pages/root, then admin foundation/features/root.
7. App shell and regenerated Android assets.
8. Landing strict config/BFF, repository-root builds, release/CI gates.
9. Repository-wide authored zero-JS/JSX and final schema contraction.

Execution status and commit evidence live in [TASKS.md](../TASKS.md); this file
is the count/ownership authority and must remain a non-overlapping partition.


## Related notes (Obsidian graph)

- Execution status: [[TASKS|Task ledger]] · Operating rules: [[WORKING_MODEL|Working model]]
- Counts rollup: [[status/METRICS|Metrics]]
- Home: [[README|Session 1 home]]
