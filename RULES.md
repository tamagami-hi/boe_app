# BeOnEdge repository rulebook

This is the authenticated BeOnEdge investing app, admin console, shared API
contracts, and backend. The app is in production: the deployed database holds
customer, financial, consent, and audit records. The public education website is
a separate application. Unlike a private single-operator trading engine, this app
has untrusted callers, multiple account scopes, customer money, and customer
communication.

**This file is the single repository authority for rules, context preparation,
verification, and documentation maintenance.** It consolidates the former
`rules.md` and the maintainer-supplied rulebook, adapted to this TypeScript stack.

## Authority

- Rules and process live here. `README.md` is the entrypoint; `AGENTS.md`,
  `CLAUDE.md`, and `.kiro/steering/` must point here, not maintain competing rules.
- Explicit maintainer decisions govern intended behavior. Record them in the
  active plan; a proposal or conservative default is not an approved decision.
- Source, schema, contracts, and measured execution establish what is built.
  Commit bodies explain why. Check documentation claims against those sources.
- `plans/` holds current proposals and handoffs. `release_manager/docs/` holds
  topic-specific implementation records and operational documentation.
- `release_manager/docs/Completed/` and `.resources.legacy.TLDR/` are historical
  evidence, not current instruction entrypoints. Preserve dated records; old
  quotations of retired rule paths do not restore those files' authority.
- Only the maintainer changes a decision or overrides a rule. Record an explicit
  override with its scope; never infer one from a green test run or a generic skill.

## Rules

### Safety

1. **Real financial activity belongs to the maintainer.** Do not initiate live
   payments, collections, refunds, payouts, or other fund movement as verification.
   Do not enable real-money behavior or weaken a safety/eligibility gate by default.
   Test credentials, fixtures, and environments must stay isolated from customers.

2. **Never deploy.** The maintainer runs deployment and rollback through
   `release_manager/`. Export a bundle or APK only when specifically asked.
   Feature approval is not permission to deploy, publish, connect to the VPS,
   run a deployed migration, or send real customer mail. Read-only VPS diagnosis
   also requires explicit permission.

3. **Configuration and existing services belong to the maintainer.** Never print
   real `.env` values, secrets, keys, or credentials; never change real `.env`
   credentials as incidental setup. Use tracked examples to inspect key names.
   Do not point E2E, seed, or migration commands at deployed/customer data.
   Local reads, typecheck, lint, one-shot builds, and one-shot tests are allowed.
   Long-running servers, workers, containers, watch modes, emulator installs,
   and Gradle runs require explicit permission. Clean up only resources started
   by this session, including on failure; never stop an unfamiliar service.

4. **Unknown remains unknown.** A timeout, lost callback, failed read, missing
   record, or panic does not prove that an account was not created, money did not
   move, a payment failed, or mail was sent. A failed read must never become an
   empty list or an endless skeleton. Render an explicit failure and safe recovery.
   Validate financial commands completely before mutating money/ledger state;
   reject atomically. Security audit/attempt counters may record rejected requests
   where the approved protocol requires it, without applying the refused action.

5. **Keep authority and architecture boundaries intact.** Settlement is
   server-authoritative: authenticate callbacks, then re-read gateway facts before
   applying canonical outcomes. PostgreSQL owns persistent financial truth; Redis
   is a cache. Money is integer paise across the API and integer arithmetic in the
   domain, not floating-point balances. Portfolio values are ledger-derived.
   Payment, recurring, fund-AUM, and client-growth walls remain separate.
   Use existing provider ports/relay adapters; pure calculations have no I/O,
   logging, or asynchronous side effects. Preserve auth/architecture guard tests.

6. **Never replay application writes automatically.** Bounded idempotent GET
   retries are permitted. Financial/state-changing writes require a deliberate
   user action and the same operation's `Idempotency-Key` for a retry; do not
   generate a new key to recover an unknown result. An auth-refresh path must not
   silently replay a financial mutation. Queue retries deliver mail; they do not
   repeat account creation or ledger commands. Define expiry and reconciliation
   behavior instead of assuming an idempotency key protects forever.

7. **Do not invent defaults or evidence.** Reuse established, verified product
   values and configuration; do not invent amounts, rates, recipient addresses,
   provider states, action URLs, token lifetimes, or dependency availability.
   Missing required configuration is an explicit unconfigured/error state, never
   fake data, silently skipped work, or a successful no-op. Do not weaken auth,
   validation, or freshness reporting to hide an outage.

8. **Report evidence; the maintainer decides readiness.** A passing suite or
   healthcheck is not proof that money, mail, native plugins, or button wiring
   works. Do not declare a release gate closed, a proposal approved, or a feature
   runtime-verified without the relevant evidence and maintainer decision.
   Optimization never outranks booting: prove the chunk graph is acyclic and run
   the existing boot guards before accepting bundle/chunk changes.

### Working

9. **No new comments in source code.** This includes TypeScript/TSX, JavaScript,
   CSS, SQL, native code, shell, and configuration: no inline/block comments,
   JSDoc, JSX/HTML comments, TODOs, banners, or commented-out code. There is no
   release-manager shell exception. Names, types, focused functions, and module
   boundaries carry meaning; rationale belongs in documents and commit bodies.
   Preserve unrelated existing comments unless removal is requested or directly
   necessary for the change. Do not strip comments as incidental cleanup.

10. **Test only when silent failure is expensive.** New tests are justified for
    authentication/authorization, tokens/signatures, money/ledger arithmetic,
    duplicate operations, concurrency, irreversible data changes, critical
    configuration, deployment/backup safety, or distinguishing failure/staleness
    from genuine financial absence. Before creating a test file ask whether a
    failure could realistically cause unauthorized access, financial loss,
    corrupted critical data, or severe production impact. If not, do not add it.
    - No dedicated tests for styling, copy, icons, basic rendering, ordinary CRUD,
      simple formatting/helpers, routine refactoring, or minor configuration.
    - Keep critical coverage minimal and behavioral. No placeholders or coverage
      padding. Use independently grounded expected values and malicious/failure
      cases, not fixtures that merely repeat the implementation's assumptions.
    - A migration that backfills, constrains, retypes, or removes existing rows
      gets a populated-upgrade test: migrate a disposable database to the prior
      schema, insert representative rows, apply the migration, and assert that
      nothing is lost. The existing pattern is
      `backend_controller/test/integration/emailVerificationMigration.integration.test.ts`.
      Never use deployed data.
    - Demonstrate a new critical guard rejects the relevant broken behavior using
      a controlled negative case or isolated mutation of your own fix. Never
      discard user changes to obtain that evidence; disclose an unrun control.
    - Never delete, skip, disable, mock away, or weaken a meaningful failing test
      to get green. Determine whether code or expected behavior is wrong. Update
      an existing test only for an intentional relevant behavior change or to
      preserve existing critical coverage; explain the decision in the change log.
    - Keep this repository's layout: colocated `*.test.ts`/`*.test.tsx` suites and
      backend PostgreSQL tests under `backend_controller/test/integration/`.

11. **Protect production data and released software; keep the rest simple.**
    The application is in production. The production database holds customer,
    financial, consent, and audit records, and released clients and the previous
    release (the rollback target) must keep working against whatever a change
    ships. No change may lose, corrupt, or silently rewrite existing data or
    strand a released client. Migration mechanics are in `DEPLOY.md` (Migration
    policy).
    - Expand first. Add tables, nullable or defaulted columns, and indexes or
      constraints that every existing row already satisfies. The new and the
      previous release must both run against the migrated schema: `migrate`
      completes before the new backend and workers start, and an images-only
      rollback runs the previous image against it. Before anything writes a new
      enum or vocabulary value, confirm every reader, including the previous
      release, tolerates it.
    - Destructive or lossy changes are a separate maintainer decision; feature
      approval does not cover them. They are dropping, renaming, retyping,
      truncating, or rewriting existing columns, tables, or rows; tightening a
      NOT NULL, unique, check, or foreign-key constraint over existing data;
      reinterpreting a money, ledger, or identity representation; and bulk
      backfills. Before one is written for release, record in the active plan
      what existing data it touches, a read-only pre-flight check of that data,
      refusal rather than silent deletion when data would be lost, the later
      release that performs the contract step, and its registration as a rollback
      boundary in `release_manager/` with tests.
    - Applied migrations are immutable. The runner stores a checksum but does not
      verify it, so an edit to an applied migration silently diverges
      environments. Correct one with a new migration.
    - Never delete or rewrite ledger, order, payment, audit, consent,
      application, or delivery records to fit a new design; corrections are new
      append-only rows. A backfill is idempotent, touches only the rows it must,
      and never re-triggers mail, payments, or ledger writes for historical rows.
    - A restored snapshot is not a rollback plan. It discards every transaction
      committed since, which is customer data loss. A change that only a snapshot
      restore can undo is destructive under this rule.
    - In-flight state (outstanding links and OTPs, queued mail, idempotency
      receipts, sessions, pending payments, mandates, and SIPs, stored
      configuration) keeps working, is migrated, or is retired deliberately with
      the user impact stated and approved. Never orphan it silently.
    - Released clients can be older than the code. Preserve the routes, request
      and response shapes, token formats, cookie and header names, and error
      codes they use; add rather than change. Remove them in a later release,
      after the maintainer raises `minimumSupportedVersion` in the published app
      configuration or otherwise confirms no supported client depends on them.
    - Compatibility code is temporary. Add only what a safe rollout needs and
      record its removal condition in the active plan, not in source. When no
      released client, in-flight record, or rollback target needs it, remove it
      and any superseded implementation path; keep history in Git, not source.
    - Preserve legitimate historical business/audit records, not obsolete code.
      Reuse concrete existing patterns before inventing abstractions or
      dependencies. Do not harden for imaginary threats, but do not borrow a
      private-engine assumption to ignore this app's actual authentication and
      public-input boundaries.

12. **Keep source files focused.** Prefer roughly 200–400 lines where the unit
    warrants it; small files need no padding. New or edited human-maintained source
    files must not exceed 800 lines. Split an oversized touched file along real
    responsibility boundaries while preserving behavior/imports; do not sweep
    unrelated files. Generated contracts/build artifacts stay generator-owned;
    do not hand-edit or split them merely to meet a source-file size target.
    Use the existing `frontend_stack_ts/src/ui/` tokens, primitives, patterns,
    recipes, and styles. Do not introduce a foreign `ui/src/` or a second design
    system. Keep presentational `ui/` free of `features/`, `shells/`, and `app/`.

13. **Do not silence checks; wire fields end to end.** No new lint/type suppressions,
    ignored assertions, disabled guards, or weakened thresholds to bypass a defect.
    Every new persisted/API/view field has a real producer and consumer in the same
    change: schema, repository/domain, route validation, shared contracts,
    generated OpenAPI/operation exports, query/state, and UI as applicable.
    Frontend requests go through contract operations and `src/api/http.ts`, not
    direct fetches or literal API paths. Preserve this stack's strict TypeScript,
    ESLint, Vitest, export, contract-drift, and boot checks.

14. **Git work is explicit and uses one identity.** Do not commit, push, tag,
    change branches, or create a worktree without authorization. `main` is the
    integration/release checkout; use only maintainer-approved development
    worktrees and the process in `WORKFLOW.md`. One coherent task per requested
    commit; each code commit compiles and passes its relevant checks on its own.
    - Subject: `type(scope): imperative summary`, at most about 70 characters.
    - Body: 150–200 words, never over about 250, explaining why, real tradeoffs,
      exact verification evidence, and corrections to earlier beliefs. Do not
      restate the diff or pad with invented numbers; trim quoted output.
    - Maintainer identity supplied with this rulebook:
      `tamagami-hi <193059379+tamagami-hi@users.noreply.github.com>`.
      Verify effective author/committer identity before committing. If a local
      override differs, stop the commit and report it; do not change local/global
      Git identity, impersonate another author, or override it with command flags.
    - Never add agent/tool attribution, `Co-Authored-By:`, `Signed-off-by:`, or
      "generated by" trailers naming an agent/tool to commits or pull requests.

15. **Fix the class when the task warrants it.** Trace the complete interaction
    and state sequence, decide whether a bug is an instance or a recurring shape,
    and inspect sibling callers/handlers. Correct directly related instances;
    record unrelated findings rather than expanding scope silently.

16. **Collect nonblocking questions and preserve approval gates.** Use the
    conservative reading for reversible, low-risk details, record it in the
    active plan's `0a. Open questions and conservative defaults` with stable IDs,
    and keep investigating rather than repeatedly interrupting the maintainer.
    Never apply this shortcut to fund movement, identity/permission decisions,
    irreversible or destructive data changes (rule 11), real customer sends, or
    deployment. Ask before those actions. Investigation/plan requests do not authorize implementation.

17. **Report measured numbers, not remembered confidence.** Recount test/file
    totals from the actual run; name commands, target/build version, and failures.
    Do not substitute coverage percentages for behavioral proof. Label evidence
    as `STATIC`, `TESTED`, `RUNTIME`, `VPS`, or `UNVERIFIED`; only use `VPS` after
    explicitly authorized observation. State what was not checked and provide
    the exact proposed verification command without implying it was executed.

18. **Documentation is part of the change.** Update affected current documents
    alongside the implementation. Do not leave an active document describing
    superseded behavior or label a proposal built. Small updates belong in the
    same requested commit; substantial documentation follows immediately in an
    authorized docs commit before unrelated work. This rulebook changes only
    when a rule changes, not for routine feature progress.

## Product, copy, and accessibility

- Keep the external public site education-only; private investing/eligibility
  flows must not leak into its copy. This repo implements the gated app/admin/API.
- Use `BeOnEdge`, never `BOE` or `BE` in client-facing strings. No guaranteed,
  assured, risk-free, multibagger, tip/guru, emoji, exclamation, or FOMO copy.
- Use Indian INR grouping; show money source/freshness and
  `Investments are subject to market risk.` on money screens. Use established
  precision for actual NAV/unit displays; never invent them as portfolio authority.
- Signal green/red/amber express money/risk states; gold is brand accent only,
  never a chart series. Reuse the existing design layer.
- Target WCAG 2.2 AA: semantic controls/labels, keyboard operation, visible focus,
  readable contrast, generous touch targets, and reduced-motion alternatives.

## Preparing context

At session start and after compaction:

1. Read root `README.md`, then this `RULES.md`, completely before repository work.
2. Read `AGENTS.md` and `CLAUDE.md` for entrypoints, task map, and current state.
3. Read the active plan's decisions, approval status, current step, open questions,
   evidence, and traps. Read an explicitly approved decision section completely.
   Do not manufacture missing documents or treat archived plans as new approval.
4. Read the last 20–30 commit bodies (`git log -30`) and `git status`; establish
   existing user changes and workspace ownership. Disclose unavailable history.
5. Load task-specific documents from the task map, using relevant sections of long
   documents. Read a plan and its context brief before implementing its step.
6. Before editing, read the file, its relevant existing tests, importers/contracts,
   and `git log` for its path. Use `git blame`/commit bodies for arbitrary-looking
   constraints. Respect current file ownership and do not overwrite user work.
7. Check claims against source before depending on them. Correct mistaken active
   documentation in the same change; keep historical reports dated and intact.

## Updating documents and plans

- Record maintainer decisions with date, scope, and status in the active plan's
  decision record. Replace a changed current decision and retain the old row under
  `Replaced`, with its reason/date. Agents record decisions; they do not make them.
- Give nonblocking questions stable IDs in section `0a`; never reuse IDs. When
  answered, move the row to the decision record with the answer/date/reference.
- Update a handoff/progress section with what changed, exact verification,
  remaining risks, corrected beliefs, and explicit unverified work. Reference the
  implementing commits only after they actually exist.
- Keep `plans/` proposal/approval/completion status accurate. On completion, move
  to a topic's existing completed-document area only when appropriate, update its
  status/links, and do not overwrite previous dated reports or completed history.
- Update `CLAUDE.md` when the current task/state/task map changes. Update root
  `README.md` or the relevant topic index when documents are added/moved/finished.
- Update `WORKFLOW.md`, `DEPLOY.md`, or the relevant `release_manager/` guide for
  changed commands, routes, environment keys, paths, or operator procedures.
  Treat old VPS reports as dated observations, not proof of the current VPS state.
- A change that adds a migration records in the plan's handoff whether the
  previous release still runs against it or it is a registered destructive
  boundary (rule 11), so the maintainer can decide the release cut and rollback.
- Agent entrypoints and steering files reference this rulebook. Do not duplicate
  its full rules or invent missing legacy coordination scripts.

## Verification boundaries

For source changes, run the affected unit's checks at its task boundary. Before
an authorized integration/release handoff, run the full applicable sweep:

| Working directory | Command |
| --- | --- |
| `packages/contracts/` | `npm run check` |
| `backend_controller/` | `npm run check` |
| `backend_controller/` | `npm run test:integration` with an isolated local test container runtime |
| `frontend_stack_ts/` | `npm run check` |
| `frontend_stack_ts/` | `npm run build:client` |
| `frontend_stack_ts/` | `npm run build:admin` |

Build contracts before frontend checks. Run only one-shot suites; integration
fixtures must not use a real/deployed database. Do not install dependencies or
change toolchain/configuration merely to make a check appear runnable. A schema
change also needs its populated-upgrade integration test (rule 10); the container
runtime it uses falls under the permission in rule 3.

Documentation-only changes need link/reference/authority review and
`git diff --check`, not application test proliferation. State explicitly that
application/runtime checks were not run. Browser/native/mail verification that
starts persistent processes needs permission; real mail, emulator/Gradle, export,
VPS, and deployment permissions remain separate under rules 1–3.

## Task map

| Need | Where |
| --- | --- |
| Repository overview and current documents | [README.md](README.md), [CLAUDE.md](CLAUDE.md) |
| Active proposals and handoffs | [plans/](plans/) |
| Git/workspace and operator release process | [WORKFLOW.md](WORKFLOW.md) |
| Deployment/configuration reference | [DEPLOY.md](DEPLOY.md), [release_manager/README.md](release_manager/README.md) |
| Prior implementation evidence | [release_manager/docs/](release_manager/docs/) |
| API/runtime authority | `backend_controller/src/runtime/`, `backend_controller/src/routes/`, `backend_controller/src/domain/`, `backend_controller/db/migrations/` |
| Shared API contracts | `packages/contracts/src/operations/` |
| Frontend routes/design system | `frontend_stack_ts/src/app/routing/`, `frontend_stack_ts/src/ui/` |
