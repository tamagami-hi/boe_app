# Risks And Decisions

## Binding Decisions

1. **Direct replacement:** migrated areas become strict TypeScript/TSX authority;
   superseded JS/JSX production and tests are deleted in the same packet.
2. **No mixed runtime:** unreplaced JavaScript is unreachable backlog, not a
   fallback, compatibility target, or accepted build input.
3. **Data/API safety remains:** PostgreSQL and supported external contracts keep
   their forward-migration, evidence, and compatibility rules.
4. **Fastify is authoritative:** the custom JavaScript router is not preserved
   as a parity target.
5. **Generated code is classified:** generated Android/web assets are rebuilt
   from TypeScript and are not hand-converted or counted as authored backlog.
6. **Legacy session boundary:** `resources/sessions/Legacy/**` is immutable and
   excluded from reorganization and active planning authority.
7. **One active packet:** task state, phase log, metrics, validation, commit, and
   push are updated together for resumability.
8. **Frictionless client KYC = email OTP:** onboarding KYC is a company-emailed
   one-time code that proves the client controls their email; verifying it records
   an approved `kyc_cases` row (`provider = 'email_otp'`) with an expiry. It is an
   MVP eligibility gate, **not** document/identity/regulatory KYC; a
   document/provider KYC can layer onto the same `kyc_cases` table later without
   rework.
9. **No client risk profiling (product decision):** clients are never
   risk-profiled or labelled as risk-takers. Investing eligibility is
   `active account + current approved KYC` only. This is an intentional deviation
   from spec 03 §2.3 (which additionally required an assessed risk profile). Risk
   is a **fund** attribute (`fund_versions.risk_level`: low/moderate/high/
   very_high) surfaced at fund selection so the client freely chooses their
   risk/return tier. `risk_assessments` stays in the schema, dormant and
   unexposed, so this is fully reversible if regulation later requires suitability.
10. **Transport-agnostic `EmailSender` port:** KYC email uses a company-SMTP
    adapter (`nodemailer`) whose mailbox credentials and `KYC_EMAIL_FROM` come from
    `.env`, with a safe local/log fallback when SMTP is unset (dev/test). BE-023's
    Amazon SES sender implements the same port for the at-scale outbox pipeline
    later; the two can coexist or be swapped without domain changes. KYC sends
    happen after the DB transaction commits (never during it).

## Open Risks

| Risk | Severity now | Required closure |
|---|---|---|
| ~~Liveness server has no graceful signal drain~~ | RESOLVED by `BE-002` | Bounded SIGTERM/SIGINT drain (`runtime/shutdown.ts`) wired into `server.ts`; exits 0 clean / 1 on timeout; proven by unit tests and source/dist smoke |
| Incomplete TypeScript runtime could be mistaken for release-ready | HIGH if published | Keep release blocked until readiness/routes/DB/consumers/CI gates pass |
| 12,600 lines of unreachable backend JS remain | Migration risk | Execute `BE-003` through `BE-020`; delete only with real replacements |
| 20,480 lines of authored frontend JS/JSX remain | Migration risk | Execute FE/AD packets with component/E2E and deletion guards |
| Contract declarations are verbose | LOW | Compact only through deterministic generation without widening types |
| Historical handoff contains superseded mixed-runtime text | LOW/controlled | Keep explicit superseded markers; current authority is working model/task/status/specs |
| Generated Android assets can distort JS metrics | MEDIUM reporting risk | Exclude/classify build output and record the exact inventory command |
| Canonical `users`/other tables share names with the legacy `001-008` chain, so a full `migrate up` over legacy+canonical would collide (BE-007b `010` onward) | MEDIUM (latent; no environment runs the mixed chain) | Canonical migrations (`>= 009`) are validated in isolation on empty PG; there is no production data; the legacy chain is archived to non-executable historical reference at `CLEAN-002`. Until then, do not run `migrate up` over a DB carrying the legacy chain (matches `02` §5.3 point 10). |
| KYC OTP email sends directly (post-commit), bypassing the outbox durability + SNS bounce/suppression pipeline | LOW (short-lived OTP; user can resend) | Acceptable for transactional OTP; if KYC email needs durability/bounce handling, move it onto the outbox once BE-023 lands (the shared `EmailSender` port makes this a swap). Rate-limit + attempt-cap the code to bound abuse. |
| Email-OTP KYC is not regulatory identity verification | MEDIUM if a regulator requires real KYC | Uses the canonical `kyc_cases` lifecycle so a document/provider KYC (and re-enabling risk suitability) can be added later without schema rework; recorded as Binding Decisions 8-9. |

## Rollback Shape

- Source packets roll back by reverting the packet commit while additive schema
  remains and is forward-fixed as needed.
- Never roll back provider/financial evidence by deletion.
- Documentation reorganization rolls back as one docs commit; it never touches
  `resources/sessions/Legacy`.


## Related notes (Obsidian graph)

- Operating rules: [[WORKING_MODEL|Working model]]
- Specifications that resolve these decisions: [[specifications/02-product-architecture-decisions|02 · Product & architecture]] · [[specifications/03-schema-lifecycle-specification|03 · Schema & lifecycle]] · [[specifications/04-api-security-test-specification|04 · API/security/email/test]] · [[specifications/05-system-tooling-diagrams|05 · System/tooling/contracts]]
- Plan: [[plans/01-postgresql-typescript-rearchitecture-plan|Master rearchitecture plan]]
- Execution ledger: [[TASKS|Task ledger]]
- Home: [[README|Session 1 home]]
