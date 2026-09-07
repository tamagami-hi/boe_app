# Risk and decision log

Decisions taken during the audit that constrain later work. `A-0xx` to avoid collision with the
`D-0xx` series in `frontend-typescript-redesign-architecture/LOGS/risk_and_decision.md`, which
remains authoritative for the frontend rebuild.

---

### A-001
**A non-terminating in-flight state gets a time-based exit, not an error-class exit.** · DECIDED 2026-08-31

D-071 fixed a wedged mandate setup by reading PhonePe's response body for a `*_NOT_FOUND` code. The
same defect existed in the collection machine, and the obvious move was to copy that fix.

It was rejected. Commit `380ba1a` deleted the gateway D-071 patched, along with its regression test.
Both surviving adapters (`providers/relay/*`) map not-found from HTTP status alone and talk to a
payment service **outside this repository**. `PLAN/payments-relay-design.md` does not specify the
relay's error contract. So whether `GatewayNotFoundError` is producible is unknowable from here, and
building the only exit edge on that assumption would repeat exactly the error D-057 records:

> "the only remaining candidate I can see" is not the same as "the cause", and I presented it as
> strong when it was merely undisproven.

The edge is therefore the collection's own `checkout_expires_at` plus a configured grace. It
terminates regardless of which error the provider emits, whether it emits one, or whether the
relay's mapping is correct.

**Generalisation for later work.** Prefer a clock the system owns over a fact it must be told. An
error-class edge is only as reliable as the least reliable mapping between the code and the
provider; a time edge has no such dependency. Use an error-class edge to terminate *faster* when
available, never as the only way out.

**Risk accepted.** A collection the provider genuinely completed *after* expiry would be recorded as
expired while the provider believes it succeeded. Two things bound this: the window is 48 h plus the
grace, and a late provider callback still runs through `applyCanonicalPaymentOutcome`, which is the
canonical settlement path. It is a real divergence risk and it is smaller than a permanently pending
order.

**Reversible:** yes — removing the expiry check restores the previous behaviour exactly.

---

### A-002
**The setup not-found grace becomes configuration, at a longer default.** · DECIDED 2026-08-31

`composePaymentReconciliationWorker` hardcoded `notFoundGraceMs: 60_000` and `claimLimit: 25` for
the mandate pass while the payment pass read all seven of its tunables from `serverConfig`. Both now
come from `serverConfig.payments.reconciliation`.

`claimLimit` is unchanged in effect (`PAYMENT_RECONCILIATION_CLAIM_LIMIT` defaults to 25). The grace
changes from 60 s to `expiryGraceMs`, default **300 s**.

**Why longer is right.** The grace exists so a provider that has not yet created an order is not
declared to have failed. Five minutes of not-found before expiring a mandate setup is more
conservative than one, and it makes the value operator-tunable and consistent with the payment path.

**Risk accepted.** A genuinely absent setup now takes up to five minutes longer to expire, so a user
sees a pending mandate for longer. Preferred over the alternative error — expiring a setup the
provider was about to create.

**Reversible:** yes — set `PAYMENT_RECONCILIATION_EXPIRY_GRACE_SECONDS=60`.

---

### A-003
**A test asserting a security or data-integrity contract keeps its subject alive; a test asserting a string does not.** · DECIDED 2026-08-31

Two structurally identical candidates went opposite ways.

`mandatesRepository.findMandateForOwner` — dead in production — was **kept**, because
`mandatePersistence.integration.test.ts` asserts it returns `null` for a foreign `userId`. It is the
owner-scoped half of a pair whose unscoped sibling is live; deleting the safe variant and leaving
the unsafe one is what invites a future unscoped read on a client route.

`mandatesRepository.findCollectionAttemptForOwner` — equally dead, equally owner-scoped, **no
test** — was **removed**.

The converse also applied, and removed three artefacts: `x-worker-health` survived because
`runtime_contract.test.sh` grepped for its *text*; the `touch /tmp/boe-worker-ready` side effects
survived the same way; and `apk_manifest.sh` exists only because its test asserts the file is
present. A test that checks a string exists proves nothing about whether it is used.

**Risk accepted.** "Asserts a contract" is a judgement. The mitigation is that every such call is
named in `../08-retained-and-uncertain.md` with its evidence, so the next pass argues with a
recorded reason rather than re-deriving one.

---

### A-004
**Configuration is guarded in both directions, with an explicit infrastructure allowlist.** · DECIDED 2026-08-31

`envPassthrough.test.ts` asserted only that keys present in *both* a stack `.env.example` and the
backend schema reach the container. That intersection has two blind spots, and both were exploited:
a schema key missing from the example can never fail (how `TRUST_PROXY` and the three SNS keys
escaped), and a key the schema does not declare is invisible (how `PROVIDER_MODE` survived in a
production template).

Added: no example may declare a setting nothing consumes. The consumed set is three Zod schemas plus
every `process.env` / `source.` / `env.` read in `src` and `scripts` — the last clause is required
because `PASSWORD_BREACH_CHECK_MODE` is read as `env.X` and a schema-only scan calls it dead.

**Rejected: inferring infrastructure keys by naming convention.** `POSTGRES_*`, `*_PORT`, `APK_*`
look inferable and are not — `PROVIDER_MODE` and `DATABASE_SSL` would have passed any such heuristic.
The allowlist is explicit and short.

**Rejected: adding the SNS keys to the stack examples to make the guard pass.** They are absent
because the SES/SNS inbox has never run in a deployed stack. Adding them requires a compose
passthrough and switches on an unexercised path — a deployment decision, not a way to satisfy a test.

**Risk accepted.** An infrastructure key added to the allowlist is exempt forever. Mitigated by
keeping it short, and by a sanity assertion on the scan so a broken regex fails loudly rather than
passing vacuously. Proven both ways before being trusted.

---

### A-005
**No database structure is dropped by an audit.** · DECIDED 2026-08-31

Four dead tables, roughly a dozen dead columns, four unproducible enum values and one dead index
were found. **None was removed.**

Application-level absence is not proof. Historical rows, reporting, rollback and compliance all read
the same schema, and none can be ruled out from the working tree. `026_login_events.sql` is the
example that settles it: the `user_credentials` lockout columns look dead, and the migration says
they exist to make lockout *decidable*. That decision is still open, and an audit is not the place to
close it by deletion.

`../06-persistence-audit.md` §6 gives the read-only SQL that turns each suspicion into a fact, and
§7 groups them into what one reviewed migration can safely carry — starting with the
`provider_events` claim index, the only item with an ongoing write cost and no compatibility surface.

**Risk accepted.** The dead schema stays, and with it the dead index's write amplification and the
unbounded growth of six tables. Both are recorded; neither is urgent.

---

### A-006
**A guard that cannot distinguish a defect from a correct pattern is worse than no guard.** · DECIDED 2026-08-31

D-062 requires reachability to be measured from rendered links. `routeIntegrity.test.ts` measures the
hand-written `LINK_MAP`. A static guard asserting every map target is backed by a rendered path
literal was built, run, and **reverted**.

It failed on `overview → users`, which is correct: `OverviewScreen` filters `ADMIN_ROUTES` by nav
presence and permission and renders `<Link to={route.path}>`. A literal scan cannot see it. Shipping
that guard would have pressured a future developer into deleting a working edge to make a test pass.

It also could not have caught the three defects actually found, which were *mis-sourced* edges —
attributing a link to a file is defeated by both the shell case (`ClientFrame` renders the
notifications bell on every screen) and the dynamic case.

So D-062 stays unenforced by unit test, `../04-frontend-dead-code.md` §8 says so plainly, and the
three corrections were made by inspection. The runtime crawl in `test_e2e/frontend-ts-audit.mjs` is
the only sound enforcement and it is not in CI.

**Risk accepted.** `LINK_MAP` can drift again. Preferred over a guard that produces confident false
positives on a correct pattern.

---

### A-007
**A dead safety check is wired or retired deliberately — never deleted as cleanup.** · DECIDED 2026-08-31

`apk_manifest_debuggable` has no production caller and exists only for its test. By the audit's own
rules it is deletable.

It was kept, because *what* it checks is a release-safety property — whether a shipped APK is
debuggable — and `CAPACITOR_DEBUG_LOG_TOKEN_EXPOSURE.md` records a real token-exposure incident in
this product. The finding is not "dead code" but something more useful: a safety check that is
unit-tested and never runs. Deleting it destroys the intent; leaving it silently preserves the
illusion that the check happens.

The same reasoning kept `refundRepository.create` and its two companions (D-048): the question is not
"is this dead" but "is this feature intended".

**Risk accepted.** Two known-unwired mechanisms remain in the tree, and a future reader may mistake
either for working. Mitigated by naming both in `../08-retained-and-uncertain.md` §1 with the
recommendation attached, and by listing the APK check in the README's "six things to do next".

---

### A-008
**A `LINK_MAP` edge whose target is rendered by the shell stays attributed to a screen.** · DECIDED 2026-08-31

`dashboard → notifications` is not backed by anything in `DashboardScreen`; the bell is rendered by
`ClientFrame`, the shell around every client screen. Three sibling edges were corrected as
mis-sourced, so consistency argued for removing this one too.

It was kept. The map's purpose is reachability, and `notifications` genuinely *is* reachable while
on the dashboard. Removing the edge would make the map understate reachability, which is the worse
error of the two — the map is what `routeIntegrity.test.ts` uses to decide whether a route is
orphaned.

The real gap is that the map has no concept of a frame-level edge. Attributing it to `dashboard` is
the least-wrong option available.

**Risk accepted.** One edge in the map is attributed to a screen that does not render it, and a
future reader may hunt for a link in `DashboardScreen` that is not there.

---

### A-009
**Money stays typed as it is; the formatter duplication is fixed separately.** · DECIDED 2026-08-31

Three admin mandate contract shapes declare `amountPaise: z.number()` while every other money field
uses the `Paise` string scalar. That is why two admin screens compute `row.amountPaise / 100` —
floating-point division on money, contradicting `clientOrderRoutes`' own stated invariant and D-019's
`paiseToRupees`, which throws rather than losing precision.

**Not changed.** It spans the contract, the backend response shapes, the generated client and two
screens, and it is a wire-format change needing a coordinated release.

What *was* fixed is the consequence that belonged to this pass: the three duplicate
`Intl.NumberFormat` constructions were consolidated onto one `formatRupees` in `domain/money.ts`, so
rupee presentation has a single owner even while the underlying typing stays wrong. The defect is
recorded in `../08-retained-and-uncertain.md` §2 rather than half-fixed.

**Risk accepted.** Two admin screens keep doing float division on money. It is display-only — no
write path uses these values — which is why it can wait for a decision.

---

### A-010
**A generated artefact is fixed in its generator, and idempotency is proven before trusting the diff.** · DECIDED 2026-08-31

`src/api/generated/operations.ts` carried an unconsumed `OPERATIONS` registry. It was removed from
`scripts/generate-api-client.mjs` and regenerated, never hand-edited.

Two checks before trusting it: `check-frontend-contract-bypass.mjs` was read to confirm it counts
operations from the `export { … }` block and not the registry; and the generator was run twice to
confirm a byte-identical result.

**Consequence to expect.** `npm run generate:api:check` compares generated output against git, so it
reports a difference while the change is uncommitted. That is the gate working as designed, not a
failure. The diff is 108 deletions and zero additions.

---

### A-011
**Two non-terminating paths are reported rather than guessed at, because the fix is a product promise.** · DECIDED 2026-08-31

F-004 — a SIP whose installment order ends non-`accepted` pins `next_due_date` forever — and F-005 —
`refund_operations` has no failure cap — are both genuine BROKEN/STUCK findings and both were left
alone.

F-004 is not a bug with one right answer. `/pay` deliberately accepts a `payment_failed` order, so
for `manual_checkout` the plan holding its due date is *correct*: the user can still pay that month,
and advancing would silently skip an installment they intend to make. The defect is that nothing
expires that intent. Skip the month, pause the plan, or expire the order — each is a different
promise to the customer, and `AUTOPAY_SIP_TRANSITIONS.active` offers no `collection_failed` state to
fall into.

F-005 is the same shape: auto-failing a refund is a financial decision.

Fixing the *rate* was in scope and was done (A-001, F-002). Fixing the *policy* was not.

**Risk accepted.** Both remain live. F-004 burns a `getMandateStatus` call per pass per affected
autopay plan and holds the plan indefinitely; F-005 can retry a refund forever, now at 30-second
intervals rather than 5.
