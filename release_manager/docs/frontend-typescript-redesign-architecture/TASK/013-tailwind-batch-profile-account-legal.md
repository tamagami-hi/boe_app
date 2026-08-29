# 013 — Tailwind v4 conversion: profile, statements, notifications, support, device security, legal, email verification

One of four parallel, disjoint slices of the remaining CSS-module conversion in
`frontend_stack_ts/src/features/`. This slice owned seven directories and nothing else. It is the
account-and-policy half of the client app: everything reached from `/profile`, plus the two screens
that gate investing.

## What it had to preserve

These screens are mostly text and status. Almost all of their behaviour lives in components that were
already converted — `Card`, `Section`, `PageHeader`, `DataList`, `Prose`, `Disclosure`, `StatusBadge`,
`Alert`, `FormField`, `Switch`, `AsyncBoundary`. The stylesheets being deleted only styled the bits
in between, so the conversion is unusually low-risk and the interesting part is what the CSS turned out
to contain rather than how hard it was to replace.

Two behaviours had to survive intact and did, untouched:

- `DeviceSecurityScreen`'s four-state machine (`idle | set | confirm | verify`) and the honesty
  paragraph that says out loud that the device PIN is a convenience and not a security boundary. Not a
  word of that copy changed.
- `EmailVerificationScreen`'s resend cooldown, its `RATE_LIMITED` / `TOKEN_EXPIRED` / `STATE_CONFLICT`
  branches, and the `Navigate` that leaves the screen the moment eligibility reports `verified`.

## Converted

| File | Was |
| --- | --- |
| `profile/ProfileScreen.tsx` | `Profile.module.css` |
| `statements/StatementsScreen.tsx` | `Statements.module.css` |
| `notifications/NotificationsScreen.tsx` | `Notifications.module.css` |
| `support/SupportScreen.tsx` | `Support.module.css` |
| `device-security/DeviceSecurityScreen.tsx` | `DeviceSecurity.module.css` |
| `device-security/PinPad.tsx` | `DeviceSecurity.module.css` |
| `legal/LegalScreen.tsx` | `Legal.module.css` |
| `legal/LegalDocumentScreen.tsx` | `Legal.module.css` |
| `legal/GrievanceScreen.tsx` | `Legal.module.css` |
| `email-verification/EmailVerificationScreen.tsx` | `EmailVerification.module.css` |

`email-verification/VerificationStatusScreen.tsx` and `legal/InvestorCharterScreen.tsx` imported no
stylesheet and were not touched.

Deleted: `Profile.module.css`, `Statements.module.css`, `Notifications.module.css`,
`Support.module.css`, `DeviceSecurity.module.css`, `Legal.module.css`, `EmailVerification.module.css`.

Added: `profile.recipe.ts` (5), `statements.recipe.ts` (2), `notifications.recipe.ts` (1),
`support.recipe.ts` (1), `device-security.recipe.ts` (8), `legal.recipe.ts` (5).

Added to shared recipes, because each recurs outside its feature:

- `ui/recipes/text.ts` — `META_ROW` (a wrapping row of faint metadata spans; three of these existed),
  `REFERENCE_TEXT` (a quotable reference code), `SUBHEAD_TITLE` (an `h2` inside a card),
  `COUNT_TEXT` (a tally in tabular figures).
- `ui/recipes/datalist.ts` — `ITEM_TITLE`, `ITEM_HINT`, `PROSE_SM`, `PROSE_PRE`, `ENTRY_ROW`,
  `ENTRY_TEXT`, `ENTRY_GLYPH`.
- `ui/recipes/surface.ts` — `INSET_NOTE` (a quiet recessed panel; the support resolution note).
- `ui/recipes/layout.ts` — `STACK_SM`, `STACK_LG`, `ROW_BETWEEN`, `ROW_BETWEEN_BASELINE`,
  `GRID_COLS_MD`.

Reused rather than re-derived: `SHELL`, `CARD_STACK`, `CARD_LINK`, `ACTION_ROW`, `HONESTY_TEXT`,
`STAT_LABEL`, `META_TEXT`, `GRID_BASE`, `ring-inset-hairline-strong`.

## Defects found in the CSS being deleted

1. **Four dead rules, 27 lines, styling nothing.** `EmailVerification.module.css` declared
   `.statusRow` and `.statusLabel` with no consumer anywhere; so did `Profile.module.css` `.build` and
   `Statements.module.css` `.note`. `.build` is the more interesting one — it styled a build-version
   footer in `--be-font-mono`, which suggests a footer that was removed from the screen and left its
   styling behind.

2. **`Profile.module.css` and `Legal.module.css` were the same file twice.** `.hub` and `.grid` were
   identical; `.entryLink`, `.entry`, `.entryText`, `.entryTitle`, `.entryHint` and `.entryGlyph` were
   byte-identical apart from one `max-width` (46ch in profile, 52ch in legal). Both screens also each
   declared their own identical 12-line `Chevron` component. One `ENTRY_*` vocabulary now serves both,
   with the `max-w-[…]` difference stated at the two call sites where a reader can see it is
   intentional. The duplicated `Chevron` was left duplicated: deduplicating it means creating a shared
   icon module, which is a change to component structure and not this migration's job.

3. **`Statements.module.css` `.label` was `STAT_LABEL` written out by hand, with a raw literal.** It
   set `font-size: 10px` while `--text-2xs: 10px` already exists in `theme.css` for that exact purpose,
   and its other five declarations matched the existing `STAT_LABEL` recipe exactly. It now composes
   `STAT_LABEL` plus `mb-0.5 block`.

4. **Three `.meta` rows, three different gaps.** Notifications used `gap: var(--be-space-3)` with
   `align-items: center`; support used `gap: var(--be-space-3)` with no alignment; legal's `.docMeta`
   used `gap: var(--be-space-2) var(--be-space-4)` with no alignment. Same element, same purpose, three
   answers. Unified as `META_ROW` at `gap-x-4 gap-y-2 items-center`. Support's and notifications'
   column gap therefore moves 12px → 16px; the spec permits more generous whitespace and this is the
   only place a measurement changed without a defect forcing it.

5. **A `prefers-reduced-motion` block that only turned off a transition.** `DeviceSecurity.module.css`
   restated for `.key` what `ui/styles/base.css` already forces globally with `!important`. Deleted per
   the conversion spec.

6. **`PinPad` re-expressed an existing utility as a hand-written shadow.** `.key`'s box-shadow was
   `inset 0 0 0 1px var(--be-hairline-strong), var(--be-inner-lift-soft)` — character-for-character
   `ring-inset-hairline-strong` from `ui/styles/status.css`, which `field.ts` already uses for inputs,
   textareas and radios. Now composed rather than restated, so that shadow has one owner.

## Judgement calls worth knowing about

- **`GRID_COLS_MD` was added rather than bending `GRID_COLS`.** Both entry grids used
  `@media (min-width: 768px)`, which is `md`; the existing `GRID_COLS` record starts at `sm` (480px).
  Reusing it would have moved the breakpoint, and two entry cards side by side on a 480px phone is a
  worse layout, not a neutral one. Adding a second record beside the first is cheaper than a silent
  regression.

- **`ROW_BETWEEN_BASELINE` knowingly duplicates `SECTION_HEAD_ROW`.** Same three utilities, different
  concept: one is a section header's title/actions row consumed by `Section.tsx`, the other is a
  statement card's month/date-range row. Collapsing them would couple two unrelated things through a
  shared name. See the note appended to `risk_and_decision.md`.

- **The keypad went local, not shared.** `PIN_PAD`, `PIN_KEY`, `PIN_KEY_WIDE`, `PIN_DOTS`, `PIN_DOT_*`
  and `PIN_PROMPT` live in `features/device-security/device-security.recipe.ts`. A numeric keypad is not
  a pattern another feature will grow. Same judgement for the profile avatar, the legal contact list and
  the statement flow grid.

- **`transition-duration` is expressed as `duration-[var(--be-dur-fast)]`**, not as the nearest numeric
  step. Every other converted file uses `duration-200`, which happens to equal `--be-dur-base`; there is
  no numeric step equal to `--be-dur-fast`'s 120ms, and rounding to 150ms to avoid an arbitrary value
  would be choosing tidiness over the token.

- **The unread notification dot stays a pseudo-element.** It was `.unread::before` with a 6px gold
  circle; it is now `before:content-[''] before:size-1.5 before:bg-gold …` on the same element. No DOM
  node was added, so the accessible name of the notification title is unchanged — an inserted `<span>`
  would have been a quieter but real change to what a screen reader announces.

## Reconciling with the parallel batches

`src/ui/recipes/` was re-read after the feature work, per the lesson already recorded from batch 1.
Four collisions with constants added concurrently by other batches; each was resolved by deleting the
one added here:

| Added here | Kept instead | Where |
|---|---|---|
| `ACTION_ROW` (`flex flex-wrap gap-2 pt-1`) | `ACTION_ROW` (`flex flex-wrap gap-2`), with `pt-1` at the single call site | `layout.ts` |
| `ENTRY_LINK` | `CARD_LINK` | `surface.ts` |
| `PROSE_RELAXED` | `HONESTY_TEXT` | `text.ts` |
| `STACK_MD` | `CARD_STACK` | `surface.ts` |

Only the first failed the build. The other three were value-identical constants under different names
in different files — invisible to typecheck, lint, tests and the emitted CSS. The detection method and
why it cannot be automated into a rule are in `risk_and_decision.md`.

## Verified — TESTED

All of the following ran from `frontend_stack_ts/` on the development machine. The repo-wide runs were
taken at a moment when all four batches were momentarily consistent; the admin batch has since resumed
editing `ui/recipes/admin.ts`, so a repo-wide typecheck now reports errors in `features/admin/**` that
belong to that batch and not to this one. The scoped runs below were re-taken afterwards and are the
claim that stands for this slice.

- `npx tsc -p tsconfig.json --noEmit` — zero errors in the seven directories and in `ui/recipes/`
  (re-confirmed after the admin batch resumed). Zero errors repo-wide at the earlier consistent point.
- `npx eslint src/features/{profile,statements,notifications,support,device-security,legal,email-verification} src/ui/recipes`
  — clean. `npx eslint src` was clean repo-wide at the consistent point.
- `npx vitest run` — 8 files, 110 tests pass, including `ui/tokens/safeArea.test.ts`.
- `npm run build` — succeeded; `check-bundle-boots` evaluated 7 chunks with no error.
- `npm run build:client` — succeeded; `check-android-dist` passed for the client variant, 16 assets,
  810,161 bytes total.
- The emitted stylesheet was read to confirm the utilities this batch introduced generate rules rather
  than nothing: `transition-duration:var(--be-dur-fast)`, `scale:.96`, `letter-spacing:-.015em`,
  `letter-spacing:.06em`, the `160deg` avatar gradient, `inset 0 0 0 1.5px var(--be-hairline-strong)`,
  `max-w-80`, `min-w-32`, `size-14`, `size-3`, `overflow-wrap:anywhere`, `md:grid-cols-4`,
  `color:inherit`, `align-middle`, and the `before:content-['']` unread dot.

  Two of these first read as absent and were not: the minifier drops the leading zero, so `0.96`
  appears as `scale:.96` and `-0.015em` as `letter-spacing:-.015em`. The first grep was wrong, not the
  CSS. Worth recording because the same mistake would have produced a false "this utility did not
  compile" report.
- `grep -rn 'styles\.'` over the seven directories: nothing. No `#hex`, `rgb(`, `env(safe-area-`,
  `2xl:`, `ease-in-out` or source comment either.

## Not verified — UNVERIFIED

Nothing here has been rendered. A green typecheck and a green build cannot see a layout. Specifically
unproven:

- Whether the 56px gold initials avatar centres its glyph, and whether `--be-ambient-gold` reads
  correctly against the elevated card face behind it.
- Whether the statement flow grid reads correctly at exactly 768px, where it goes from two columns to
  four.
- Whether the unread gold dot sits on the notification title's midline. `vertical-align: middle` became
  `before:align-middle`, which is the same declaration, but the original was never observed either.
- Whether `META_ROW`'s 16px column gap looks right on the notification and support cards that previously
  had 12px.
- The `PinPad` on a device. It is the one component here whose only real test is a thumb: key size,
  press feedback at 120ms, and whether six dots fit at 390px.
- Every `AsyncBoundary` fallback path — the legal document `fallback` prop in particular, which renders
  when the backend has not published a document to the environment.

To confirm, on the VPS:

```
cd frontend_stack_ts && npx tsc -p tsconfig.json --noEmit && npm run lint && npm test && npm run build
```

then read, at 390px and 1512px: `/profile`, `/statements`, `/notifications`, `/profile/support`,
`/profile/security`, `/profile/legal`, `/profile/legal/investor-charter`, `/profile/legal/grievance`,
`/profile/email-verification`, `/verify-email`.
