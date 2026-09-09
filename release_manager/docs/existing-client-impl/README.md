# Onboarding and administering existing clients — implementation plan

Status: **implemented and verified in the working tree; not deployed or committed.**

Features A–D from the interrupted implementation are present. Feature E now includes maturity
marking, withdrawal/reinvestment, payout tracking, contracts and admin controls.
See [`10-completion-plan.md`](./10-completion-plan.md) for the completion work and validation record.
The descriptions below document the original baseline, not the current implementation.
Written 2026-09-08 against `boe_app@v0.13.5` (`4083ef4`, clean tree).

Every claim about current behaviour was checked against source at that commit. Where something was
not checked, it says so — see [`08-evidence.md`](./08-evidence.md).

---

## The ask

Today a client can arrive exactly one way: sign up on the landing page, an admin approves the
application, the client verifies their email, and only then may they invest. Four additions:

| | Feature | Verdict |
|---|---|---|
| **A** | An admin creates a client account directly | new, small once D exists |
| **B** | An admin sets an existing client's record to match the firm's offline books | new, the hard one |
| **C** | An admin edits fund growth per client | **backend already exists**, needs a read endpoint + UI |
| **D** | Password reset and credential update | new, and nothing exists to reuse |

Plus the standing requirement: admin-created accounts must still verify their email before they
can invest.

## The four things worth knowing before reading further

**C is mostly already built.** `POST /v1/admin/client-growth/individual` already takes
`(userId, fundId)` and a signed adjustment, locks the position, recalculates from the server's own
basis, guards against a stale admin view with a basis hash, and writes an audited idempotent ledger
row. There is no endpoint to *read* a client's position and no UI at all. See
[`05-per-client-growth.md`](./05-per-client-growth.md).

**A and D are one piece of work, and D comes first.** `CredentialWriteRepository` exposes only
`exists` and `create` — no update, no reset, no invite. So an admin-created account has no route to
a password, and a client who forgets one has no recovery today. One token mechanism solves both.
See [`02-credential-lifecycle.md`](./02-credential-lifecycle.md).

**B cannot be done the obvious way.** There is no stored balance to edit — the client's figures are
folded from an append-only ledger on every read. Two CHECK constraints then box you in: only a
`contribution` may move principal and it *must* name an order, a payment and an allocation; while
`growth_adjustment` is pinned to `principal_delta_paise = 0`. The way through is to record the
offline investment as what it actually was. See
[`04-recorded-contributions.md`](./04-recorded-contributions.md).

**The email-verification requirement costs nothing.** Eligibility is derived, never stored, and
re-derived under lock before money moves. An admin-created account is therefore
`pending_verification` automatically, and *cannot* be made investable by an admin mistake. See
[`00-constraints.md`](./00-constraints.md) §1.

## Documents

Read in this order. `00` is load-bearing for everything else.

| File | What it is for |
|---|---|
| [`00-constraints.md`](./00-constraints.md) | The verified invariants that shape every design here. Single source of truth — the other documents reference it rather than restating it. |
| [`01-current-state.md`](./01-current-state.md) | How an account comes into existence today, and an inventory of what already exists versus what is genuinely missing. |
| [`02-credential-lifecycle.md`](./02-credential-lifecycle.md) | **Feature D.** Set, reset and change a password. Build first. |
| [`03-admin-created-clients.md`](./03-admin-created-clients.md) | **Feature A.** Admin creates a client account. |
| [`04-recorded-contributions.md`](./04-recorded-contributions.md) | **Feature B.** Record investments made before the app existed. |
| [`05-per-client-growth.md`](./05-per-client-growth.md) | **Feature C.** Per-client growth editing: the read endpoint and the admin UI. |
| [`06-sequencing-and-migrations.md`](./06-sequencing-and-migrations.md) | Build order, every migration, and the deploy-ordering rule. |
| [`07-open-decisions.md`](./07-open-decisions.md) | Decision register. Two entries block work. |
| [`08-evidence.md`](./08-evidence.md) | What was verified, with the commands; and what was assumed. |
| [`09-maturity-and-withdrawals.md`](./09-maturity-and-withdrawals.md) | **Feature E.** Maturity, withdrawal and reinvestment — the one place the money-ledger enum is extended, and why. |

## Build order

Each step unblocks the next, so this order is not arbitrary.

```
1. D  credential lifecycle      standalone value; A cannot ship without it
2. A  admin-created accounts    small once D exists
3. C  read endpoint + admin UI  builds the client-detail screen B will also need
4. B  recorded contributions    plus the reversal writer (00-constraints §4)
```

C before B is deliberate: Feature C's admin UI needs a "find a client, show their per-fund
positions" screen, and that is exactly where Feature B's action belongs. Building B first would
mean building that screen anyway, with no way to see the result.

## Scope boundary

**Bulk import is not designed here.** Everything in these documents is single-client. If the real
task is migrating a book of hundreds of existing clients from a spreadsheet, the ergonomics change
completely — a different endpoint shape, a dry-run/validate pass, partial-failure reporting, and an
import audit record. Say so before any of this is built. See
[`07-open-decisions.md`](./07-open-decisions.md) D-5.

## Two traps

Both are cheap to avoid and expensive to discover late.

- **The word `holdings` fails the build.** A guard test regex-scans every non-test source file for
  it. Use `position`, the term the growth repository already uses. `00-constraints.md` §5.
- **Nothing can undo an admin money write.** The schema documents corrections as a reversal plus a
  correct new entry, and the `reversal` entry type, its FK, its CHECK and its unique index all
  exist — but no code writes one. `00-constraints.md` §4.
