# 001 — Discovery and verification

## What was done

The blueprint documents were read first, as
`release_manager/docs/frontend-typescript-redesign-architecture/` requires: its `README.md`, doc 00,
and the full decision index D-001…D-071, then D-046 to D-051 (the previous backend cleanup) and
D-071 (the AutoPay wedge) in full. That reading is what made the audit's central finding legible —
D-071 had already described the wedge shape, so finding the same shape unfixed elsewhere was a
matter of looking.

Five subsystem sweeps then ran in parallel: the HTTP surface and repositories; workers and state
machines; configuration and persistence; the frontend; and tooling, deployment and docs.

## Then every claim was re-checked

This is the part that mattered. The sweeps produced a large, mostly accurate inventory and **four
confident claims that were wrong**. Each would have caused damage if acted on.

| Claim | Reality |
| ----- | ------- |
| Four admin `overview` link-map edges are stale, with `OverviewScreen` rendering only four literal paths | `OverviewScreen.tsx:80-84` filters `ADMIN_ROUTES` by nav presence and permission, then renders `<Link to={route.path}>` at :121-127. All four are reachable. Acting on this would have deleted four correct edges |
| The generated client has four duplicate alias keys | The registry was keyed by `operationId` while the export block uses `exportName`. Two naming systems, not duplicates |
| `BREAKPOINTS` is dead | `useBreakpoint`/`isCompact` are used by `FundListScreen.tsx`, and `BREAKPOINTS` backs their media queries |
| `abandonUndispatchedSetup` has no call site | `clientAutoPaySipRoutes.ts:481` |

Three further sweep conclusions were softened rather than reversed: `markPaymentRefundPending` and
`newMerchantRefundId` were flagged dead but belong to D-048's deliberately-whole refund machinery;
and `findMandateForOwner` was flagged dead but has an integration test asserting owner-scoping.

## What this changed about the method

Two rules came out of it and governed everything after.

**Dynamic rendering defeats literal scanning.** Any `.map()` over a route manifest, any glyph
lookup table, any Tailwind `@theme` class generation — none of it is visible to grep. The frontend
export analysis was therefore rebuilt around a real import graph plus a two-part test (zero external
references **and** a single intra-file occurrence), which is what reduced 237 unreferenced exports
to 26 honest candidates.

**Generated code is analysed at its generator.** Reading `generate-api-client.mjs` rather than its
output is what revealed that the unused registry was the generator's doing, and reading
`check-frontend-contract-bypass.mjs` is what proved removing it was safe.

## Notable discovery

`grep "relay" backend_controller/src` turned up `providers/relay/` and no
`phonePeCheckoutGateway.ts` or `phonePeRecurringGateway.ts` — the two files D-071 (dated the same
day) describes fixing. Commit `380ba1a` had retired PhonePe egress and taken both with it, along
with the regression test that pinned D-071's behaviour.

That single observation set up A-001: the obvious fix for the collection wedge was to copy D-071's
error-code mapping, and it could not be done honestly, because the replacement talks to a service
outside this repository whose error contract is unspecified.

## What to check next

Nothing outstanding from this pass. The four disproved claims are recorded in
`../LOGS/findings_register.md` under "Claims investigated and disproved" specifically so they are not
re-opened by the next tool that scans this repository.
