# BOE Codebase Audit — dead, stale, duplicate and non-terminating code

Audit and cleanup performed 2026-08-31 against working-tree state `13f2c76` (clean tree,
v0.12.7). Repo-wide: `backend_controller/`, `frontend_stack_ts/`, `packages/contracts/`,
`release_manager/`, `test_e2e/`, `tools/`, `emu/`, `.github/` and the root documents.

Every conclusion below is traceable to a file path and, where it matters, a line number.
Nothing was executed against a database, a device or the VPS, so anything needing a running
system is marked **UNVERIFIED** with the exact command to run.

## Purpose

Reduce the repository to the code the current system actually requires, and — separately and
more importantly — find **active** code whose lifecycle cannot terminate. The second half is
where the real defects were: four permanently-wedged or unbounded execution paths, and one
security control that had silently stopped covering half its surface.

## Document order

Read 00 first. 02 is the one to read before touching payments.

| Doc | Title | Read it to learn |
| --- | ----- | ---------------- |
| [00](00-executive-summary.md) | Executive summary | What was found, what changed, what is still open, and the six things to do next |
| [01](01-method-and-classification.md) | Method and classification | How reachability was established, the seven classes, and the four cases where static analysis was wrong |
| [02](02-lifecycle-and-state-machines.md) | Lifecycle and state machines | Every state machine, its terminal states, and the five non-terminating paths |
| [03](03-backend-dead-code.md) | Backend dead code | Repository methods, the superseded port layer, the dead transition, what was kept and why |
| [04](04-frontend-dead-code.md) | Frontend dead code | 24 dead exports, the duplicates consolidated, the generated-client reduction, the link-map corrections |
| [05](05-configuration-audit.md) | Configuration audit | Every dead setting removed, the silent name mismatch, and the new two-directional guard |
| [06](06-persistence-audit.md) | Persistence audit | Dead tables, columns and enum values; the absent retention story. **Nothing was dropped.** |
| [07](07-tooling-deployment-docs.md) | Tooling, deployment and docs | The nginx rate-limit gap, the unwired readiness probe, and why DEPLOY.md was rewritten |
| [08](08-retained-and-uncertain.md) | Retained and uncertain | Everything deliberately left alone, with the evidence that justified keeping it |
| [09](09-verification-results.md) | Verification results | Every gate run, every number, and an explicit list of what was *not* verified |

`LOGS/` holds the change log and the decision record. `TASK/` holds the developer-facing
narrative of each pass.

- [`LOGS/audit_log.md`](LOGS/audit_log.md) — what changed, in order, with verification status
- [`LOGS/findings_register.md`](LOGS/findings_register.md) — every finding F-001…, classified, with disposition
- [`LOGS/risk_and_decision.md`](LOGS/risk_and_decision.md) — A-001… the decisions that constrain follow-up work
- [`TASK/`](TASK/) — one file per pass

## Headline result

| | |
| --- | --- |
| Files changed | 77 tracked, plus 3 deleted |
| Net line change | **685 added, 1457 removed — net −772** |
| Non-terminating paths fixed | 3 (collection expiry, refund poll, mandate-pass attribution) |
| Non-terminating paths reported, not fixed | 2 (both need a product decision — see 02 §5) |
| Security control repaired | 1 (nginx `boe_auth` covered 2 of 4 login endpoints) |
| Dead code removed | 14 port interfaces, 63 backend types, 9 repository methods, 24 frontend exports, 13 CSS tokens, 1 npm dependency, 1 Android permission |
| Configuration removed | 12 settings across 4 example files and 2 compose files |
| New guards added | 2 (dead-config detection; collection-expiry state machine) |
| Root documents corrected | 4 (`DEPLOY.md` rewritten, `CLAUDE.md`, `WORKFLOW.md`, `PRODUCT.md`) |

## Hard boundaries observed

1. **Nothing was dropped from the database.** Dead tables, columns, enum values and one dead
   index are reported in [06](06-persistence-audit.md); every one needs a reviewed migration
   and a historical-data judgement that is not this audit's to make.
2. **No product behaviour was changed** except where the previous behaviour was a
   non-terminating loop. Each such change is named in [02](02-lifecycle-and-state-machines.md)
   with its before/after.
3. **No wire format was changed.** The one money-typing defect found
   (`amountPaise: z.number()`) is reported, not fixed — see [08](08-retained-and-uncertain.md) §2.
4. **`If deadness cannot be proven, it was not deleted.`** [08](08-retained-and-uncertain.md)
   is the list of things that survived that test, each with the evidence.
5. **No comments were added to source files**, per the root `README.md`. Explanations live in
   these documents.

## The six things to do next

In priority order. Items 1 and 2 need the VPS; 3 needs a device.

1. **`sudo nginx -t && sudo systemctl reload nginx`** after shipping the nginx configs. The
   `boe_auth` regex fix is inert until reloaded, and two login endpoints stay at 20 r/s
   until it is. [07](07-tooling-deployment-docs.md) §1.
2. **Run the read-only SQL in [09](09-verification-results.md) §3** to find out whether wedged
   rows already exist in production — stuck `mandate_collection_attempts`, uncapped
   `refund_operations`, pinned `sip_plans.next_due_date`. The code no longer creates them;
   existing rows are not retroactively repaired.
3. **Rebuild and install both APKs.** `@capacitor/local-notifications` and
   `POST_NOTIFICATIONS` were removed; that changes APK contents and is unverified.
   [04](04-frontend-dead-code.md) §6.
4. **Wire `apk_manifest_debuggable` into the release path, or delete it deliberately.** It is
   a release-safety check that is unit-tested and never runs.
   [08](08-retained-and-uncertain.md) §1.
5. **Answer the two product questions in [02](02-lifecycle-and-state-machines.md) §5** — what a
   SIP should do when an installment is abandoned, and whether refunds get a creation path.
   Both are currently unbounded-or-stuck by omission.
6. **Decide the `amountPaise: z.number()` question.** Three admin mandate operations carry
   money as a JSON number while the rest of the contract uses the `Paise` string scalar.
   [08](08-retained-and-uncertain.md) §2.

## What this audit did not cover

- **No integration tests were run.** They need testcontainers; no pagination predicate,
  session channel or cache invalidation in this change set has met PostgreSQL.
- **No runtime observation of any kind.** No worker was started, no APK was built, no
  browser was opened, nothing was deployed.
- **The `vault.md/` directory was excluded.** It is an Obsidian vault with its own Python
  venv inside the worktree; it is not application code.
- **`.resources.legacy.TLDR/` was excluded.** It is an explicit historical archive.
