# 019 — Cursor pagination end to end

Closes known gap 1 from `README.md`. Decisions: D-043, D-044, D-045. Log: Entry 023.

Touches all three packages: `backend_controller/`, `packages/contracts/`, `frontend_stack_ts/`.
The opaque cursor mechanism itself was not invented here — `backend_controller/src/http/cursor.ts`
already had it, signed with `config.cursorKey` and bound to route plus filter hash. The work was
making it reach the routes and screens that never used it.

## 0. The finding that had to be fixed first

`packages/contracts/src/scalars.ts`:

```
export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/u)
```

`backend_controller/src/http/cursor.ts::encodeCursor`:

```
return `${body}.${signature}`
```

The scalar's character class has no `.`, so it matched nothing the backend can mint. A real token
looks like this (292 characters, one dot):

```
eyJyIjoiL3YxL2NsaWVudC9vcmRlcnMiLCJmIjoiYWFh…IjoxNzg4MDgxNjYzMDAyfQ.gB5Sekmh_62z0tk1PTQtohyKh_O7q31wG6PDAczV0mI
```

Why it mattered rather than being cosmetic: `listClientFunds` and `listClientOrders` already used
`createPaginatedSuccessEnvelopeSchema`, whose `meta.page.nextCursor` is `Cursor.nullable()`.
`frontend_stack_ts/src/api/http.ts` runs the whole success envelope through `safeParse` and throws
`TransportError("malformed")` on failure. So the first page of funds or orders would have failed
validation as soon as a second page existed — the error would have appeared on the page *before* the
one nobody could reach. It had not fired because neither list has exceeded 25 rows in any environment
this has run in.

Now `/^[A-Za-z0-9_-]{16,1024}[.][A-Za-z0-9_-]{16,1024}$/u`, with `scalars.test.ts` asserting the
two-part shape and rejecting a bare body, a too-short half, a three-part token, and a trailing space.

## 1. Backend — one paginator

`src/http/pagination.ts` is new and owns `MAX_PAGE_LIMIT`, `DEFAULT_PAGE_LIMIT`, `readKeyset`,
`readKeysetValues`, `paginate` and `createdAtKeyset`.

Before, the same logic existed in four places:

| Where | What it was |
| ----- | ----------- |
| `routes/adminRouteKit.ts` | the shared copy, imported by five admin route modules |
| `routes/adminIdentityRoutes.ts` | a private `readKeyset`/`paginate` pair, identical except for taking `deps` instead of a key |
| `routes/clientPortfolioRoutes.ts::listOrders` | the over-fetch, slice, and `encodeCursor` open-coded inline |
| `routes/clientCatalogRoutes.ts::listFunds` | the same, again |

All four now call the one implementation. `adminRouteKit` keeps only its idempotency, header and
formatting helpers, and `MAX_ADMIN_LIMIT` is `MAX_PAGE_LIMIT` rather than a second literal `100`.

### Routes that gained the cursor

`after` query parameter, keyset predicate in parameterised SQL, `meta.page` on the response:

| Route | Order | Cursor tuple | Filters hashed into the cursor |
| ----- | ----- | ------------ | ------------------------------ |
| `GET /v1/client/transactions` | `(created_at, id) desc` | `[iso(createdAt), id]` | userId |
| `GET /v1/client/notifications` | `(created_at, id) desc` | `[iso(createdAt), id]` | userId |
| `GET /v1/client/payments` | `(created_at, id) desc` | `[iso(createdAt), id]` | userId, resolved payment states, success projection |
| `GET /v1/client/support/tickets` | `(created_at, id) desc` | `[iso(createdAt), id]` | userId |
| `GET /v1/admin/fund-receipts` | `(created_at, id) asc` | `[iso(createdAt), acknowledgementId]` | state |
| `GET /v1/admin/refunds` | `(created_at, id) desc` | `[iso(createdAt), id]` | state |
| `GET /v1/admin/payments` | `(created_at, id) desc` | `[iso(createdAt), id]` | none |

The receipt queue is the one ascending list — it is a work queue, oldest first — so its predicate is
`>` where every other list uses `<`. Its cursor id is `fund_receipt_acknowledgements.id`, not the
order id, because that is the table the `order by` is on.

Client payments hash the *resolved* state set rather than the raw `status` string, so `?status=pending`
and `?status=created,provider_pending` share a cursor namespace, which is correct: they select the
same rows. Admin payments hash `{}` — the list has no filters — which still binds the cursor to the
route.

Repository changes: `clientAccountRepository.listNotifications/listPayments/listSupportRequests` and
`clientValueEntryRepository.listRecentByUser` gained `afterCreatedAt`/`afterId`. The three admin
repositories (`fundReceiptAcknowledgementRepository.findQueuePage`, `refundRepository.listPage`,
`paymentsRepository.listPage`) already accepted them and their routes were simply not passing them.

### Two defects found on the way

**`GET /v1/admin/mandates` could not describe a next page honestly.** The route asked the repository
for `limit` rows while `adminMandateRepository.listMandates` was appending `+ 1` to the SQL limit
itself. `hasMore` came out right by accident, but the over-fetch had two owners and neither call site
said so. The repository now takes the caller's budget verbatim, matching every other list repository,
and the route asks for `limit + 1`.

**The same route put `page` inside `data`**, alone among nine admin lists that put it in `meta.page`.
Moved, along with the contract and `adminMandate.integration.test.ts`, which now reads it through a
`pageOf` helper.

**`unreadCount` was a page statistic.** It was `rows.filter(r => r.readAt === null).length` over the
rows about to be returned. See D-045: it is now a `COUNT(*)` over the account, in the same transaction.

## 2. Contracts

Client lists moved to `createPaginatedSuccessEnvelopeSchema` and gained `after: Cursor.optional()`:
`listClientTransactions` (which already declared `after` and `CURSOR_INVALID` but returned an unpaged
envelope), `listClientNotifications`, `listClientPayments`, `listSupportTickets`. A new
`ACCOUNT_PAGED_READ_ERRORS` adds `VALIDATION_FAILED` and `CURSOR_INVALID` to the account read set.
`MAX_ACCOUNT_LIST_LIMIT` dropped from 200 to 100 so a client page cannot exceed what a cursor
describes.

Admin: `listAdminFundReceipts`, `listAdminRefunds` and `listAdminPayments` gained
`after: AdminCursor` and `{ page: AdminPageMeta }` metadata, and moved from `ADMIN_READ_ERRORS` to
`ADMIN_PAGED_READ_ERRORS`. `listAdminMandates` moved its page from data to meta.

`AdminPageMeta` was left as a second schema for the same wire shape — see D-044.

`generated/openapi-v1.json` and `.d.ts` regenerated; `frontend_stack_ts` client regenerated. The
operation count is unchanged at 94, so the contract-bypass gate stays balanced (94 contracted, 94
generated).

## 3. Frontend

### `src/api/paged.ts`

`usePagedQuery` wraps `useInfiniteQuery`:

- `queryKey` must carry every active filter. This is the whole mechanism behind "a filter change
  restarts pagination": a cursor is minted against one filter hash and `decodeCursor` refuses it under
  another, so the key has to change with the filter or the next request is a guaranteed
  `CURSOR_INVALID`.
- `getNextPageParam` is the pre-existing `nextPageParam(meta.page)` from `src/api/cursor.ts`, which
  returns `undefined` when `hasMore` is false. `parsePageMeta`, also pre-existing, is what
  `api/envelope.ts` already ran on `meta.page`; this is the consumer it never had.
- `mergePages` concatenates `items` and takes every other field from page one. Those fields
  (`unreadCount`, the admin fund list's `summary`) describe the whole set, not the page.
- The return value is structurally an `AsyncQuery`, so `AsyncBoundary` call sites did not change and
  **the existing refreshing affordance shows while the next page loads** — `isFetching` is true during
  `fetchNextPage`, which is exactly the condition `AsyncBoundary` already renders `STATE_REFRESHING`
  for.
- `clampPageLimit` bounds the limit by `MAX_PAGE_LIMIT`, giving that constant its first consumer.
- `loadAll` walks to the end of the chain for the consumers in D-043 that need the complete set.

### `src/ui/patterns/LoadMore.tsx`

The only Load more in the product. Renders `null` when `hasMore` is false; otherwise a note —
`Showing the first N <noun>. There are more.` — above a `secondary`/`sm` `Button` whose `loading`
prop is `isLoadingMore`. Classes: `LOAD_MORE_ROOT` (added to `ui/recipes/state.ts`) and the existing
`META_MUTED`. A `LOAD_MORE_NOTE` constant was written and then deleted: `recipes.test.ts` fails on two
names for one class string, and `META_MUTED` was already `font-ui text-xs text-fg-muted`.

`ui/` may import `~/api` (`AsyncBoundary` already imports `~/api/errors`), so the `PagedListState`
type is imported rather than duplicated.

### Screens

`<LoadMore>` was added to 18 screens: client Activity (both tabs), Notifications, Support; admin
Applications, User directory, User login events, Audit log, Email deliveries, Fund receipts, Refunds,
Payments, Mandates, Funds, AUM overview, Fund AUM, Fund AUM history, FAQs.

Not given one, deliberately: `DashboardScreen`'s fund strip, which slices to three behind a "See all"
link — a teaser, not a truncated list. And every `loadAll` consumer, which has nothing left to load.

`OverviewScreen`'s queue tiles were reading `data.items.length` as a queue depth. With a 25-row page
that prints "25" for a queue of 300. They now render `25+` when `hasMore` — see D-043.

`qk.admin.refunds` now takes the state filter; the one invalidation site that used it as a prefix uses
the literal prefix instead.

## 4. Tests

- `frontend_stack_ts/src/api/paged.test.ts` (6). The filter-reset test was negative-tested: change
  `queryKey: ["probe", filter]` to `["probe"]` and it is the only test that fails.
- `backend_controller/src/http/pagination.test.ts` (11) — over-fetch, last page, empty page, that the
  cursor points at the last *kept* row and not the discarded one, and refusal across routes, across
  filter sets, under a foreign key, and for a cursor carrying no position.
- `backend_controller/src/routes/pagedQueries.schema.test.ts` (39) — the same battery across all seven
  paged query schemas via `test.each`, including that `after: ""` is refused rather than treated as
  page one, and that `offset` and `page` are rejected as unknown keys. Three schemas in
  `adminFundReceiptRoutes.ts` were exported to make this possible.

## 5. What was not verified

No SQL ran. The keyset predicates, the unread `COUNT(*)`, and the mandate over-fetch change are
`STATIC` only. Entry 023 carries the exact `curl` sequence to run on the VPS, which checks the cursor
chain and the cross-filter refusal in one pass.
