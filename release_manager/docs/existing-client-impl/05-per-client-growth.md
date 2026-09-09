# Feature C — per-client growth editing

Mostly already built. This document is about the two things that are missing: an endpoint to read a
client's position, and a user interface.

---

## 1. What already exists

`routes/adminClientGrowthRoutes.ts` provides:

```
POST /v1/admin/client-growth/individual     permission: client_growth.write
POST /v1/admin/client-growth/collective     permission: client_growth.write
```

The individual body is `{ userId, fundId, growthPaise | growthBasisPoints, effectiveDate,
reasonCode, note? }` — a signed absolute amount **or** a signed percentage in basis points, exactly
one of the two.

The commit path (`:262` onward) is careful in ways worth preserving rather than reimplementing:

- `clientGrowthRepository.lockPosition(tx, userId, fundId)` — takes the row lock first.
- `findPositionBasis` — reads the **server's** current value, ignoring whatever the client sent.
- `planIndividualGrowth(currentValue, instruction, maxBasisPoints)` — applies a configured ceiling,
  so a fat-fingered percentage is refused rather than applied.
- `computeClientGrowthBasisHash(...)` — the commit carries a hash of the basis it was computed
  against, so a stale admin screen cannot apply an adjustment derived from an old value. The
  response is authoritative.
- Wrapped in `runGrowthCommit` for idempotency, with audit and client notification.

It writes a `growth_adjustment` ledger row, which by CHECK has `principal_delta_paise = 0` — growth
moves value, never principal ([`00-constraints.md`](./00-constraints.md) §2).

**Do not rebuild any of this.** The feature request is satisfied on the write side.

## 2. Gap 1 — no admin read of a client position — **CLOSED 2026-09-08**

`findPositionBasis` was called only *inside* the commit transaction, so the UI had nothing to render
before acting.

Now implemented as `GET /v1/admin/client-growth/investors/{userId}/positions`, permission
`client_growth.write` or `client_values.read`. Returns per fund: `principalPaise`,
`currentValuePaise`, `totalGrowthPaise` and `latestEntryId`. It reuses the **same** visibility rules
as the growth commit — reversals and reversed rows excluded, `having bool_or(entry_type =
'contribution')` — so the picker can only ever offer a position the mutation will accept.

Originally proposed:

```
GET /v1/admin/clients/:userId/positions          permission: client_growth.read (or reuse .write)
GET /v1/admin/clients/:userId/positions/:fundId  detail, including recent ledger entries
```

Returning, per fund: fund identity, principal (total invested), current value, gain, the latest
entry id, and enough ledger history to make an adjustment explicable.

Two things to get right:

- **Money as decimal strings**, not numbers ([`00-constraints.md`](./00-constraints.md) §9).
- **Return the same `latestEntryId` the basis hash is computed from**, so the UI can round-trip it
  into the commit and the staleness check actually functions. If the read returns a different
  identifier than the commit expects, the basis-hash protection silently degrades into an
  always-mismatch or an always-pass.

## 3. Gap 2 — the UI existed and has been rebuilt

An earlier draft of this plan claimed no growth UI existed at all. **That was wrong**, on the
strength of a case-sensitive `grep clientGrowth` that missed `ClientGrowth`. Three screens already
existed under `features/admin/client-values/`: `ClientPositionsScreen.tsx` (a hub),
`IndividualClientGrowthScreen.tsx` and `CollectiveClientGrowthScreen.tsx`.

What was actually wrong with the individual screen was that it let an admin pick a combination that
could not exist: the investor was a raw UUID text field and the fund list was *every* fund. Since the
commit requires an existing contribution for that exact `(investor, fund)` pair, almost every
selection failed with `RESOURCE_NOT_FOUND`.

Rebuilt 2026-09-08 so the pickers cannot express an invalid combination:

- **Investor** is a searchable combobox (`ui/primitives/Combobox.tsx`, new) backed by server-side
  search through `useAdminUsers({ q })`. Options show the name with the email and phone greyed
  beneath.
- **Fund** is scoped to that investor's own positions from the §2 endpoint, and stays disabled until
  an investor is chosen.
- **Reason code** is a fixed list: weekly, monthly, quarterly, yearly. No backend change was needed —
  `reasonCodeSchema` is a 1–80 character string.
- A panel shows amount invested, current value, gain so far, and the projected value after the
  adjustment, so the admin sees the arithmetic before committing.

Remaining UI work, for Feature B rather than C:

1. **Client detail.** A per-investor view is now reachable through the adjustment screen's picker,
   but Feature B's recorded-contribution action and the reversal action still need a home. The
   positions endpoint from §2 is what they should read.
2. **Collective preview.** The backend supports preview before commit for the whole-fund path; the
   collective screen should show the resulting values before the admin confirms.
### Route registration constraints

Admin screens are declared in `frontend_stack_ts/src/app/routing/adminRoutes.ts`.
`routeIntegrity.test.ts` enforces the manifest and the link map **including reachability** — a screen
that nothing links to fails the test. So the client-detail screen must be linked from the client
list, and the adjust form from client detail, or the suite goes red.

## 4. Work items

1. `repositories/clientGrowthRepository.ts` — expose a non-locking read of the position basis, or a
   sibling read for many funds at once.
2. `routes/adminClientPositionRoutes.ts` — the two GET endpoints. (Same module as Feature B's
   writes; they are the same resource.)
3. Permission: either reuse `client_growth.write` or add a `.read` — see
   [D-7](./07-open-decisions.md).
4. Frontend: client list (if absent), client detail with per-fund positions, growth adjust form with
   preview.
5. Register routes and links in `adminRoutes.ts`; satisfy `routeIntegrity.test.ts`.

## 5. Tests required

- The position read returns decimal strings, never JSON numbers.
- The `latestEntryId` returned by the read is the one the commit's basis hash is computed from
  (§2) — assert this explicitly, it is the subtle one.
- A stale basis hash is refused by the commit.
- A percentage beyond `maxBasisPoints` is refused.
- The read is refused without the permission.
- `routeIntegrity.test.ts` passes with the new screens.
- A reversed growth entry is excluded from the position basis
  (`clientGrowthRepository.ts:88` already does this; assert it end to end once the reversal writer
  from [`04`](./04-recorded-contributions.md) §6 exists).

## 6. Definition of done

An admin can find a client, see what each of their funds is worth and what it cost, preview a growth
adjustment, apply it, and see the result — without reading the database directly, and without being
able to apply an adjustment computed against a stale figure.

## 7. Why this is sequenced before Feature B

Feature B needs a place to put its action, and that place is the client-detail screen built here.
Building B first would mean building this screen anyway, with no way to see the result of a recorded
contribution.

## 8. Risks

**Reimplementing the write path.** The commit endpoint is subtle — the ceiling, the basis hash, the
lock ordering. The temptation when building the UI is to add a "simpler" endpoint alongside it. Do
not; that is how two code paths with different safety properties end up in a money system.

**Basis-hash mismatch through the read.** Covered in §2. The failure mode is quiet: protection that
looks present but never fires.
