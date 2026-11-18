# Open decisions

Two of these block work. The rest can be settled during implementation but are cheaper to settle
now.

---

## D-1 — Synthesise a payment, or add a fourth ledger entry type? **(blocking Feature B)**

**Context:** [`04-recorded-contributions.md`](./04-recorded-contributions.md) §2 and §4.

The plan recommends recording an offline investment as a real order → succeeded payment →
allocation → ordinary `contribution`, marked by a new `order_type = 'recorded_offline'`. The
alternative is a fourth `client_value_entry_type` that permits principal without payment provenance.

| | Synthesise (recommended) | Fourth entry type |
|---|---|---|
| Ledger migration | none | enum + CHECK on the money ledger |
| Readers to change | every `switch` on `order_type` | every `switch` on `entry_type`, incl. the statement fold |
| Honesty | records a payment that had no gateway | records exactly what happened |
| Failure mode if a reader is missed | a recorded order is mislabelled | a client's total silently disagrees between screens |

**Recommendation:** synthesise. The blast radius is smaller and does not land on the money fold.

**Choose the fourth entry type instead if** the team holds as a principle that a `payments` row must
never exist without a real payment. That is a legitimate position; it just costs more.

## D-2 — Build the reversal writer now? **(blocking, in practice)**

**Context:** [`00-constraints.md`](./00-constraints.md) §4,
[`04-recorded-contributions.md`](./04-recorded-contributions.md) §6.

Nothing in the codebase writes a `reversal`. So no admin money write can be undone — including the
growth adjustments that already shipped.

**Recommendation:** yes, with Feature B. An admin who can write money should be able to undo it, the
schema already supports it fully, and the read side already handles reversals. It also
retroactively fixes growth adjustments.

**The alternative** is accepting that a mistyped amount requires manual database intervention on the
VPS, which is worse than the feature it is avoiding.

## D-3 — Does a replaced credential keep history?

**Context:** [`02-credential-lifecycle.md`](./02-credential-lifecycle.md) §6.

`credentialRepository` needs a `replace`. In-place update is simplest. Keeping superseded hashes
would allow detecting password reuse, which nothing currently asks for, at the cost of storing more
password hashes than necessary.

**Recommendation:** in-place. Credentials are not money, and the append-only discipline in this
codebase is specific to the value ledger. Storing old hashes is a liability without a stated
requirement.

## D-4 — Does the password-reset link open the app or the web?

**Context:** [`02-credential-lifecycle.md`](./02-credential-lifecycle.md) §4.

The client is a Capacitor app with a web build on the same host. A reset link could deep-link into
the installed app via an App Link, or stay on the web.

Relevant precedent: `/pay/return` was recently made an App Link with an `autoVerify` intent filter
and an `assetlinks.json` association, so the mechanism exists and is working on the dev host. Adding
a second claimed path is a manifest change plus a client route.

**Consideration:** a web page works for everyone including someone on a desktop who cannot receive
the app's deep link, and it needs no manifest change. The app deep link is nicer for the common case.
A web page that offers to open the app is the usual compromise.

**Recommendation:** web first, deep link later if wanted. It removes a whole class of "verification
failed, chooser dialog appeared" problems from a flow whose failure means the client cannot log in.

## D-5 — Is Feature B single-client, or a bulk migration?

**Context:** [`README.md`](./README.md) scope boundary,
[`04-recorded-contributions.md`](./04-recorded-contributions.md) §10.

Everything in this plan is single-client: one admin, one client, one fund, one amount, one form
submission.

If the actual task is loading a book of existing clients from a spreadsheet, the design is different
in kind, not degree — a file upload, a validate/dry-run pass that reports what *would* happen, a
per-row outcome report, partial-failure semantics, and an import batch record so a bad import can be
reversed as a unit. `client_growth_batches` already exists as a precedent for batch identity on the
growth side.

**This needs answering before Feature B is built**, not after. Retrofitting bulk onto a
single-record endpoint produces the worst of both.

## D-6 — Does recording a past investment notify the client?

**Context:** [`04-recorded-contributions.md`](./04-recorded-contributions.md) §7.

The growth path already sends a client notification when an admin adjusts value. Silently changing
someone's portfolio is a surprising experience, and a notification is also a fraud control — the
client is the one person who knows whether the recorded investment is real.

**Recommendation:** notify, reusing the growth notification path. Consider suppressing it for a bulk
backfill (D-5), where hundreds of notifications for a data migration would be noise.

## D-7 — A separate read permission for positions?

**Context:** [`05-per-client-growth.md`](./05-per-client-growth.md) §2.

`client_growth.write` exists. The new position read could reuse it, or introduce
`client_growth.read`.

**Recommendation:** a separate read permission. Viewing a client's position and altering it are
different privileges, and an operations or support role may reasonably need the former without the
latter. It costs one permission row.

## D-8 — Which fund version does a recorded contribution reference?

**Context:** [`04-recorded-contributions.md`](./04-recorded-contributions.md) §5.

`investment_orders` requires a `fund_version_id`. For a historical investment, that could be the
version current at the historical date, or the version current now.

**Recommendation:** the version current at the effective date, if one exists — it is the truthful
answer and keeps any version-aware reporting coherent. Fall back to the current version with an
explicit note in `reason_code` when the fund predates its own version history.

This is small but easy to discover only when the insert fails.

---

## Answered already

Recorded here so they are not reopened.

**How does an admin-created client get a password?** Decided: the account is created with no
credential, and the client sets their own via the set-password token. An admin-typed temporary
password was rejected because a human would learn the client's password; reusing the signup path was
rejected because it writes fabricated application and review rows.
See [`03-admin-created-clients.md`](./03-admin-created-clients.md) §2.

**Is a `payments` row without a `payment_attempts` row safe?** Verified yes: client reads use
`left join lateral`, and the reconciliation worker enumerates attempts rather than payments. See
[`00-constraints.md`](./00-constraints.md) §7.

**Can `growth_adjustment` record a past investment?** No — `principal_delta_paise = 0` is enforced by
the database. See [`00-constraints.md`](./00-constraints.md) §2.
