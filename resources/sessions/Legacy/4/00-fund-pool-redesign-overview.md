# Session 4 - Fund Pool Redesign Plan

## Scope

Implementation complete. All backend data contracts, admin AUM controls, client Explore/Fund Detail UI, and lifecycle validation have been built and verified.

The requested change is a client-app redesign for fund pool discovery and detail pages, modeled after the Groww reference screenshots in `resources/reference/Grow reference/`, while keeping BOE's existing theme and admin-controlled fund pool workflow.

Primary user-facing goals:

- Redesign fund pool cards in the client Explore section.
- Redesign the fund detail page so tapping a fund pool opens a richer fund profile.
- Replace the simple growth chart with a fund-vs-Nifty comparison chart.
- Add admin AUM controls for the comparison chart and the bottom allocation/ratio charts.
- Show bottom analysis charts similar to the reference: equity/debt/cash split, equity sector allocation, and advanced ratios.

## Current Architecture Found

Client Explore uses `GET /v1/products` through `frontend_stack/packages/client/src/services/fundsApi.js`, then renders fund cards in `frontend_stack/packages/client/src/pages/Explore.jsx:22`. The current card shows name, status, tagline, pool size, sector count, a mini sector bar, risk, min SIP, and an action/disclaimer.

Client Fund Detail uses `GET /v1/products/:product_id` and renders `frontend_stack/packages/client/src/pages/FundDetail.jsx:53`. It already has a detail shell, key stats, sector chart, investment breakdown, holdings list, fees, disclosure blocks, CTA, minimums, and SIP projection sections.

Admin AUM uses `frontend_stack/packages/admin/src/screens/AumScreen.jsx:37`. It already controls fund name, lifecycle, pool size, launch/current/initial values, min SIP/lumpsum, risk, sectors, investments, and chart visibility. It submits through `Admin.jsx:121` to `POST /v1/admin/funds` and `PATCH /v1/admin/funds/:id`.

Backend fund persistence is JSON-store backed in `backend_controller/src/admin/services/fundsService.js:93` for create and `backend_controller/src/admin/services/fundsService.js:178` for update. Client exposure is filtered through `toClientFund` in `backend_controller/src/admin/services/fundsService.js:284` and the related shared service `backend_controller/src/shared/services/fundCatalogService.js:93`.

## Important Constraint

The project has substantial uncommitted work already. The later implementation should avoid broad refactors and touch only:

- fund payload shape and sanitizer/enrichment functions
- `AumScreen.jsx` editor and preview
- client `Explore.jsx`, `FundDetail.jsx`, `Charts.jsx`
- related mobile/desktop CSS
- session docs under `resources/sessions/4/`

## Proposed Delivery Order

1. Backend/data contract first: extend fund shape in a backward-compatible way and pass through only client-safe fields.
2. Admin AUM controls: add grouped controls for benchmark chart, asset split, sector allocation, top holdings, and advanced ratios.
3. Client components: add reusable comparison line chart and donut chart components.
4. Client Explore card redesign: richer compact cards using admin-controlled performance fields.
5. Client Fund Detail redesign: Groww-inspired information hierarchy with BOE styling.
6. Documentation and validation: update the session plan with final decisions, then run backend and frontend checks.

## Non-Goals

- Do not add a new admin section outside the existing AUM page.
- Do not fetch market data directly from the client.
- Do not add a direct Nifty provider integration in this slice unless a backend provider already exists.
- Do not replace the existing JWT-cookie auth, router, or fund lifecycle model.
- Do not hand-roll a full financial analytics engine; this is an admin-published display contract.
