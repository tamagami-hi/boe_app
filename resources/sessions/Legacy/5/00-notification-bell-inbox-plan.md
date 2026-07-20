# Session 5 — Client Notifications: Central Bell Inbox

**Author:** claude (planner)
**Task:** `task_1780241288153_255`
**Implementers:** kimi-1, kimi-2 · **Verifier:** codex
**Status:** PLAN — ready for implementation

> All file paths are under `frontend_stack/packages/client/src/`.

---

## 1. Goal (from admin)

Give the **client app (mobile/APK) notifications one dedicated, consistent place**,
reachable from a **bell icon present on every app screen**. Remove notification access
that today lives **only on the Profile page**, and stop relying on per-page wiring. One
inbox, one consistent entry point.

Brand/content rules still apply: no emoji in copy, Indian number formatting, market-risk
disclosure on money screens, never "BOE"/"BE", keep things accessible (aria-labels).

## 2. Current state (verified in code)

- **Inbox page exists and is good:** `pages/Notifications.jsx`, route `/app/notifications`
  (registered in `ClientApp.jsx:61`). Has grouping (Today/Yesterday/Earlier), mark-all-read,
  empty state, keyboard a11y. **Keep this as the single inbox** — no redesign needed.
- **API:** `services/notificationsApi.js` exports `listNotifications()`, `markRead(id)`,
  `markAllRead()`. **There is no unread-count endpoint** — unread is derived client-side by
  counting `items.filter(n => !n.read)`.
- **App shell:** `layout/ClientLayout.jsx`.
  - Desktop: a sidebar (`app-sidebar`) whose `NAV_ITEMS` includes a "Notifications" (Bell)
    link → `/app/notifications` (line 17).
  - Mobile: there is **NO global top header**. `BottomNav` renders only on
    `PRIMARY_TAB_PATHS` (dashboard, explore, portfolio, transactions, profile).
- **Per-page top bar:** `layout/AppBar.jsx` — title + back button + **one optional**
  `rightIcon/onRight` action. Each page renders its own AppBar and decides its right action.
- **Today's actual inbox entry points:**
  1. Desktop sidebar nav item (ClientLayout) → ok on desktop.
  2. `pages/Profile.jsx:38` — `<Row label="Notifications" onClick={() => navigate('/app/notifications')} />`
     → **this is the profile-only access admin wants removed.**
  - On mobile there is otherwise **no consistent bell** on each screen. This is the gap.

### ⚠️ Do NOT touch (different feature)

These `Bell` usages are a fund-launch "Notify me when open" alert feature and the inbox
empty-state icon — **unrelated to the notification inbox. Leave them alone:**
`pages/Dashboard.jsx:240`, `pages/Explore.jsx:126`, `pages/FundDetail.jsx:566,571`,
and the `Bell/BellOff` icon imports inside `pages/Notifications.jsx`.

## 3. Target design

Add ONE consistent bell entry point that appears on every app screen, sourced from a
single shared hook for the unread badge. Recommended approach given the architecture:

**Make the bell a built-in part of `AppBar`** (centralized in one component), so every
screen that renders an AppBar automatically shows the bell in the same position with the
same badge — no per-page wiring.

```
AppBar (every app screen)
  [back]      Title          [bell + unread badge] [optional page action]
                                     │
                                     └ tap ▶ /app/notifications  (single inbox)

ClientLayout desktop sidebar: keep the existing "Notifications" nav item.
Profile page: REMOVE the "Notifications" row (no profile-only access).
```

- The bell is **always present** on AppBar (new dedicated slot), independent of the
  existing optional `rightIcon` page action (so pages keep their own action if any).
- Unread badge value comes from a shared `hooks/useUnreadNotifications.js`.
- On `/app/notifications` itself, the bell may render inactive/aria-current (optional).

## 4. Implementation steps

Coordinate on the board: `announce_intent` → `lock_file` → edit → `release`. Suggested
non-overlapping split:

**Slice A (kimi-1) — shared unread source + AppBar bell**
1. Add `hooks/useUnreadNotifications.js`: calls `notificationsApi.listNotifications()`,
   returns `{ unread }` = count of `!n.read`; guard against setState-after-unmount
   (use an `active` flag in the effect); on error return `{ unread: 0 }`. Keep it simple —
   no polling required for this slice (fetch once on mount).
2. Edit `layout/AppBar.jsx`: add a persistent bell button that `navigate('/app/notifications')`,
   with `aria-label="Notifications"` and an unread badge (hidden when 0, render e.g. "9+"
   when >9). Place it before the existing optional right action. Keep current props working
   (backward compatible — `rightIcon`/`onRight` still render alongside).
3. Add minimal CSS for the bell + badge in `styles/mobile/components.css` (and desktop
   equivalent if AppBar shows on desktop). Badge must meet contrast; use existing tokens,
   signal red only if appropriate — a neutral/brand dot is fine (badge is a count, not a
   money state, so avoid implying money signal colors).

**Slice B (kimi-2) — remove redundant/profile-only access + ensure coverage**
4. Edit `pages/Profile.jsx`: remove the `<Row label="Notifications" .../>` at line ~38
   (and any now-unused import). Profile no longer links to notifications.
5. Audit every app screen that renders `AppBar` to confirm the bell now appears
   consistently; for any primary screen that does NOT use AppBar (e.g. check Dashboard),
   ensure the bell is still reachable there (either adopt AppBar's pattern or add the same
   shared bell component). Document any screen without AppBar in the task thread.
6. Keep the desktop sidebar "Notifications" nav item in `ClientLayout.jsx` (that is already
   consistent on desktop) — no change needed there unless it conflicts.

> If kimi-1 + kimi-2 prefer, factor the bell into a tiny `components/NotificationBell.jsx`
> that both AppBar and any non-AppBar screen can drop in. That keeps it DRY and single-source.

## 5. Acceptance criteria (codex verification — task `task_1780241378401_262`)

- [ ] A bell icon appears in the same position on **every** client app screen (verify
      dashboard, explore, portfolio, transactions, statements, fund detail, mandate detail,
      profile, etc.).
- [ ] Tapping the bell from 3+ different screens lands on `/app/notifications`.
- [ ] **No** notification entry point remains on the Profile page; profile row removed; no
      dangling imports (`grep -rn "Notifications" src/pages/Profile.jsx` clean of the row).
- [ ] Unread badge is driven by the single shared hook/component (not re-implemented per
      page) and matches the inbox's unread count.
- [ ] The unrelated "Notify me when open" Bell buttons (Dashboard/Explore/FundDetail) are
      untouched and still work.
- [ ] No emoji/disallowed copy; bell has `aria-label="Notifications"`; badge is
      screen-reader friendly (e.g. `aria-label="N unread notifications"`).
- [ ] `npm run build` (frontend) passes; no unused-import/lint errors.

## 6. Non-goals

- No backend / `/v1` notification API changes; no new unread-count endpoint in this slice
  (derive client-side).
- No redesign of the inbox page visuals or `NotificationCard`/item markup.
- No new notification types, push, or real-time updates.
- Do not modify the fund-launch "Notify me when open" feature.
- Do not touch auth, routing guards, or other surfaces.

## 7. Risks / notes

- `AppBar` is used per-page; a page that does NOT use AppBar will miss the bell — Slice B
  step 5 must catch these. This is the main correctness risk.
- Deriving unread from `listNotifications()` means an extra fetch where the bell mounts;
  acceptable for this slice. If it causes redundant fetches, lift into the existing Zustand
  store (`src/store/`) as a follow-up — out of scope here.
- Keep public/onboarding routes (`/app/login`, `/app/splash`) bell-free (they don't render
  the app chrome anyway).
