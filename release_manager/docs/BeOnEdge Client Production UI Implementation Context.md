# BeOnEdge Client Application — Production UI / Content Implementation

## OBJECTIVE

The extraction/audit phase of the BeOnEdge client application is complete.

We are now entering the **implementation phase** for the final production release.

The current application is functionally substantial, but the audit shows that many client-facing screens expose:

- developer terminology
- architecture terminology
- raw internal identifiers
- raw provider/internal status codes
- backend/process explanations
- overly long explanatory copy
- implementation details
- raw failure messages
- awkward machine-generated plurals
- ambiguous empty values
- duplicate headings
- internal terminology presented as product terminology
- actions with insufficient feedback

The goal is NOT to rebuild the application from scratch.

The goal is to transform the existing frontend into something that feels like a **finished financial client application** while preserving its existing business logic, APIs, payment flows, security controls, routing, authentication, SIP logic and investment logic.

---

# SOURCE OF TRUTH

Before changing any application code, read these files completely:

```text
release_manager/audit_pages/client/AUDIT_INDEX.md
release_manager/audit_pages/client/ROUTE_INVENTORY.md
release_manager/audit_pages/client/SHARED_COMPONENTS.md
```

Then, before modifying an individual route, read:

```text
release_manager/audit_pages/client/<PAGE_FOLDER>/page.md
```

and inspect all screenshots in that directory.

The audit is the baseline.

Do not rely only on this implementation brief.

Each `page.md` contains findings that must be reconciled against the actual source before changes are made.

Baseline audited version:

```text
VERSION: 0.12.8
git: 412fe3a
frontend: frontend_stack_ts/
```

---

# PRIMARY PRODUCT PRINCIPLE

Every piece of visible UI must answer:

> Is this information useful to an investor/client using BeOnEdge?

If the answer is no, it should normally not be visible.

A client should understand:

- what they own
- what they are investing in
- what amount is involved
- what action is happening
- whether an action succeeded
- whether it failed
- whether they need to do something
- what happens next
- how to get help

A client should NOT need to understand:

- backend architecture
- database concepts
- ledgers as an implementation mechanism
- server-side processing
- API terminology
- HTTP concepts
- provider state machines
- internal status tokens
- UUIDs
- database record versions
- raw exception messages
- webhook/provider mechanics
- internal reconciliation implementation
- idempotency
- deployment environments

---

# NON-NEGOTIABLE ENGINEERING RULES

## 1. Preserve Business Logic

Do not casually change:

- authentication behaviour
- eligibility behaviour
- email verification requirements
- fund availability rules
- investment calculations
- payment initiation
- PhonePe checkout handling
- payment callbacks
- payment reconciliation
- SIP scheduling
- AutoPay behaviour
- mandate backend behaviour
- investment accounting
- API contracts
- database schemas
- support APIs
- device PIN security
- biometric security
- update verification/security
- account suspension/closure semantics

This is primarily a **client presentation implementation**.

---

# 2. Do Not Confuse Data With Presentation

Internal values may remain internally.

For example:

```text
fund_receipt_acknowledged
phonepe
payment_failed
mandate_setup_failed
UUIDs
provider error codes
internal status enums
```

may still be required by APIs and application logic.

Do NOT rename backend values merely to improve the UI.

Instead implement a presentation mapping:

```text
internal value
        ↓
presentation mapper
        ↓
client-facing label/message
```

The raw value should not be directly rendered.

Use central mappings wherever the same domain value appears in multiple screens.

---

# 3. Never Display Raw Server Errors

Client screens must never use raw:

```text
error.message
exception.message
provider error message
API failure detail
```

as final client copy.

Create controlled client-facing error mappings.

Unknown errors should become concise safe messages such as:

```text
We couldn't complete this action right now.
Please try again.
```

or another context-specific equivalent.

Raw information may remain available internally for logging/debugging.

---

# 4. Do Not Fabricate Missing Product Functionality

The audit found some missing capabilities or content.

Do NOT create fake frontend flows for them.

Examples include:

- password reset
- account creation
- editable account details
- missing legal documents
- missing privacy policy
- missing fee schedule
- missing risk disclosure

If the backend/product capability does not exist, do not create buttons that lead nowhere.

If product/legal input is required, record:

```text
REQUIRES PRODUCT DECISION
```

or:

```text
REQUIRES LEGAL CONTENT
```

in the implementation tracker.

---

# 5. Do Not Invent Legal or Regulatory Copy

In particular, do not generate:

- Terms of Service
- Privacy Policy
- fee schedules
- risk disclosures
- grievance policy content
- investor charter content

unless the repository already contains the authoritative text.

You may improve the presentation of existing legal content.

You may improve the empty/unpublished state.

Do not fabricate the actual legal document.

---

# DESIRED CLIENT LANGUAGE

Prefer vocabulary such as:

```text
Investment
Payment
Payment status
SIP
AutoPay
AutoPay authorisation
Fund
Portfolio
Transaction
Verification
Account
Support
Reference ID
```

Avoid visible vocabulary such as:

```text
backend
server-derived
server-side
append-only
idempotent
ledger architecture
provider state
provider attempt
payload
endpoint
worker
callback
webhook
database
schema
environment
record version
internal ID
request ID
raw enum
```

Use `ledger` only if BeOnEdge deliberately intends it as a client product concept.

At present the audit indicates it is primarily implementation vocabulary.

---

# WRITING STYLE

Client-facing copy should generally be:

- short
- calm
- clear
- actionable
- contextual
- financially precise
- free of unnecessary technical explanation

Avoid paragraphs explaining how the software architecture works.

### Bad pattern

```text
The backend derives your values from an append-only ledger and waits
for the payment provider to notify the server of settlement.
```

### Desired pattern

```text
Your payment is still being confirmed.
```

Then show an action if one is useful.

---

# DO NOT OVER-SIMPLIFY FINANCIAL STATES

Client-friendly does NOT mean inaccurate.

For example, do not say:

```text
Your payment failed and no money was deducted.
```

unless that statement is guaranteed by the actual payment state.

If the backend only knows that confirmation failed, use wording such as:

```text
We couldn't confirm this payment yet.
```

Accuracy takes priority over reassuring wording.

---

# PHASE 0 — CREATE IMPLEMENTATION TRACKER

Create:

```text
release_manager/audit_pages/client/IMPLEMENTATION_TRACKER.md
```

For every audit flag use:

```text
FIXED
ACCEPTED
BLOCKED
REQUIRES PRODUCT DECISION
REQUIRES LEGAL CONTENT
NOT APPLICABLE
```

Recommended format:

| Page | Flag | Finding | Resolution | Files changed | Status |
|---|---|---|---|---|---|

Do not delete or overwrite the original extraction reports.

They are the before-state.

---

# PHASE 1 — FIX SHARED PRESENTATION INFRASTRUCTURE FIRST

Do NOT begin by manually changing 25 pages independently.

Several findings originate from shared components.

Correct these first.

---

## 1. ClientFrame / Mobile Page Titles

Audit finding:

Several mobile screens show:

```text
shell route title
+
PageHeader title
```

creating duplicated headings.

Inspect:

```text
frontend_stack_ts/src/shells/client/ClientFrame.tsx
```

and the affected `PageHeader` usage.

Establish one clear page-title hierarchy on mobile.

Do not simply hide random headings page-by-page.

Create a consistent rule.

Desktop and mobile should each have one obvious primary page heading.

---

## 2. AuthLayout

Inspect:

```text
frontend_stack_ts/src/app/layouts/AuthLayout.tsx
```

Current auth marketing content contains terminology such as:

```text
Server-derived valuations
Append-only ledger
Idempotent money movement
Administrator-managed fund pools
Values are derived server-side...
```

This is architecture documentation, not client-facing onboarding.

Replace the technical implementation messaging with concise product-level BeOnEdge messaging.

Do not make investment-performance promises.

---

## 3. ErrorState

Inspect:

```text
frontend_stack_ts/src/ui/patterns/ErrorState.tsx
```

The shared error vocabulary needs production treatment.

Remove client-visible architecture/configuration terminology.

Examples requiring review:

```text
Your account does not carry the permission this screen needs.
Not configured in this environment.
This capability depends on a payment provider...
Reference {requestId}
```

A normal client should receive:

1. what happened
2. whether they can retry
3. what action they can take

Do not expose a server request ID as ordinary page content.

If a support reference is operationally necessary, it may be available through a deliberately secondary support mechanism rather than being visually prominent.

---

## 4. Failure Sanitisation

Locate every `describeFailure` implementation and any other direct rendering of:

```text
error.message
```

The audit specifically identified relevant implementations around:

```text
LumpsumInvestScreen.tsx
SipStartScreen.tsx
SipDetailScreen.tsx
LoginScreen.tsx
```

Create consistent controlled mappings.

Do not leave raw-server-message fallbacks.

---

## 5. Status Presentation

Review:

```text
frontend_stack_ts/src/domain/status.ts
```

The domain state itself may remain unchanged.

Review the client-facing labels.

Values such as:

```text
Not started
Unknown
Not set
Not published
Not disclosed
—
```

should not be blindly placed in financial cards and information rows.

Depending on context:

```text
Verification not started
Status unavailable
Not available
Not provided
```

or omission of the row may be more appropriate.

Do this contextually.

---

## 6. Human-Friendly Pluralisation

Remove constructions such as:

```text
1 disclosed holdings
1 months
3 lump-sum contribution(s)
2 installment(s)
```

Create/reuse appropriate plural helpers where necessary.

Do not solve this with `(s)` in client copy.

---

## 7. LoadMore

Review:

```text
frontend_stack_ts/src/ui/patterns/LoadMore.tsx
```

Avoid product copy such as:

```text
Showing the first 20 ledger entries. There are more.
```

Use natural page-specific nouns.

---

## 8. ConfirmDialog

Review:

```text
frontend_stack_ts/src/app/overlays/ConfirmDialog.tsx
```

Current default:

```text
Leave it as it is
```

is reused everywhere.

Confirmation dialogs should use action-specific labels where clarity matters.

Examples conceptually:

```text
Keep SIP active
Keep device PIN
Continue editing
```

Do not apply these exact strings without reading each dialog.

---

## 9. Transactional Back Confirmation

Current generic text:

```text
Leave this screen? Your entry will not be submitted.
```

Review the three transactional routes:

```text
007 lump sum
008 SIP setup
011 payment status
```

A payment-status screen is not semantically equivalent to an unfinished form.

The back behaviour/message should reflect the actual state.

Do not claim that data will be lost when no unsaved data exists.

---

## 10. Pending Payment Recovery

Review:

```text
features/payments/PendingPaymentRecovery.tsx
```

Current text explains PhonePe/provider mechanics in detail.

Keep the recovery behaviour.

Simplify the presentation to:

- what is pending
- what the client should do
- where to open it

Do not teach the user how backend settlement works.

---

## 11. App Update UI

The updater's security mechanisms are valuable.

Its client copy currently exposes implementation detail such as:

```text
minimum service version
SHA-256 digest
service/server compatibility
verified download internals
```

Preserve:

- HTTPS restrictions
- digest verification
- package validation
- update gating
- Android install permissions

but rewrite the visible explanation for normal users.

Security logic must remain unchanged.

---

## 12. Device Security

Preserve the PIN and biometric security implementation.

The audit found that the introductory security explanation is disproportionately long.

Reduce visible architecture/security-model explanation while retaining important user consequences:

- what the PIN protects
- when it is required
- biometrics availability
- what happens if the PIN is removed
- what happens if the user forgets it

Do not weaken security behaviour.

---

# PHASE 2 — CRITICAL TRANSACTIONAL SCREENS

These receive the highest priority.

Order:

```text
011 Payment status
007 Lump-sum investment
010 Activity
008 Start SIP
013 SIP detail
015 Notifications
023 Blocked/account unavailable
```

---

# PAGE 011 — PAYMENT STATUS

Route:

```text
/activity/payments/:paymentId
```

This is one of the most important production screens.

Current audit findings include visible:

```text
Payment reference: <raw UUID>
Order: <raw UUID>
phonepe
provider failure code
Reported reason
```

and the page does not show the fund name.

### Required implementation direction

Do not expose two raw UUIDs as primary client information.

Determine what identifier is actually operationally useful to the user/support team.

Present at most the useful client reference in a clear format.

Do not confuse:

```text
internal payment UUID
internal order UUID
provider-facing reference
```

with one another.

Keep all identifiers internally if required.

Map:

```text
phonepe
```

to appropriate presentation such as:

```text
PhonePe
```

only where knowing the payment partner is actually useful.

Never display provider error codes directly.

Create failure-code → client-message presentation mappings.

Retain the original code internally for diagnostics.

Add the fund/product name if the existing API/data relationships make it available without introducing a new backend dependency.

If it is not available, record that limitation rather than inventing it.

The page should primarily communicate:

```text
Fund
Amount
Payment state
Date/time
What happens next
Relevant action
Useful reference
```

not payment architecture.

---

# PAGE 007 — LUMP-SUM INVESTMENT

Route:

```text
/funds/:fundId/invest/lumpsum
```

The form should dominate the screen.

The audit found that the current explanatory `What happens next` content is larger than the investment interface itself.

Reduce supporting copy.

Client needs to understand:

```text
fund
amount
payment method/flow if applicable
what pressing the button does
what happens immediately afterward
```

Do not explain provider/server settlement architecture.

Sanitise all failure messages.

Preserve payment initiation behaviour exactly.

---

# PAGE 010 — ACTIVITY

Route:

```text
/activity
```

Remove presentation such as:

```text
phonepe
no provider attempt yet
ledger entries
```

unless there is a deliberate client reason to show it.

Map provider information.

Use natural transaction/activity terminology.

Make payment/investment state understandable at a glance.

The activity feed should read as a history of what happened to the client's money/account, not as a log viewer.

---

# PAGE 008 — START SIP

Route:

```text
/funds/:fundId/invest/sip
```

The frontend must distinguish between backend terminology and client terminology.

The backend may use:

```text
mandate
mandate setup
authorisation state
```

The normal client experience should generally explain this as:

```text
AutoPay
AutoPay authorisation
SIP payment authorisation
```

where appropriate.

Do not alter backend mandate identifiers or state machines.

The current `DEPENDENCY_UNAVAILABLE` content is excessively long.

Replace technical/deployment explanations with a concise client message.

Preserve actual availability behaviour.

---

# PAGE 013 — SIP DETAIL

Route:

```text
/sips/:sipPlanId
```

Priority findings include:

- raw failure code
- raw cancellation state
- mandate terminology
- multiple confirmation dialogs
- provider/internal state exposure

Create consistent SIP/AutoPay state presentation.

Do not flatten technically different states if the distinction matters to what the user should do.

Instead map technical states into meaningful:

```text
title
description
available action
```

Review all four confirmation dialogs individually.

---

# PAGE 015 — NOTIFICATIONS

Route:

```text
/notifications
```

Never display raw event kinds such as:

```text
fund_receipt_acknowledged
app_update_available
```

Create event-kind presentation mappings.

Each notification should have a human-readable:

```text
title
message
time
optional action
```

The internal event kind should remain internal.

A failed `Mark read` action must not fail silently.

External-destination failures must provide visible feedback where an action was initiated by the user.

---

# PAGE 023 — ACCOUNT UNAVAILABLE

Route:

```text
/blocked
```

This contains a genuine state-handling defect.

The audit showed that visiting `/blocked` using an active account renders:

```text
Account suspended
```

because the screen effectively branches:

```text
closed
vs
everything else
```

Review the route guard and screen state handling.

An active account must never be told that it is suspended merely because it reaches the URL.

Correctly distinguish:

```text
active
suspended
closed
unknown/invalid state
```

Do not alter backend account-state meaning.

Also provide appropriate progress/feedback for sign-out.

---

# PHASE 3 — CORE INVESTMENT EXPERIENCE

Next work through:

```text
004 Dashboard
005 Funds catalogue
006 Fund detail
009 Portfolio
012 SIP plans
014 Statements
```

---

## 004 Dashboard

Focus on:

- clear portfolio/investment overview
- email verification status
- pending payment recovery
- consistent state labels
- removal of ledger/server terminology

The dashboard should answer:

```text
What do I currently have?
What needs my attention?
What can I do next?
```

---

## 005 Funds

Remove machine-generated phrases such as:

```text
1 disclosed holdings
```

Do not expose backend implementation wording.

Cards/rows should make it easy to understand:

```text
fund name
risk level
important fund characteristics
appropriate action
```

Do not add financial claims unsupported by source data.

---

## 006 Fund Detail

Do not expose:

```text
Published version: 1
```

or other record/version implementation details as product information.

Fix pluralisation such as:

```text
1 months
```

Review missing/disclosed state presentation.

Make the page oriented around the investment decision, not the CMS/database representation of the fund.

---

## 009 Portfolio

Replace implementation vocabulary such as:

```text
ledger
contribution(s)
installment(s)
```

where it makes the interface unnatural.

Use correct grammar based on actual count.

The portfolio should present the client's investment position, not accounting implementation internals.

---

## 012 SIP Plans

Review all SIP state labels.

Make plan status/action relationships obvious.

Do not change the backend SIP state model.

Note that `/sips` is not currently a primary navigation item.

Do NOT automatically add it to navigation.

Evaluate it as a UX/product decision and record a recommendation separately.

---

## 014 Statements

Replace accounting/internal terminology only where it is not meaningful to the client.

A financial statement itself may legitimately contain formal financial terminology.

Distinguish valid financial language from software architecture vocabulary.

Note that Statements is not currently part of either navigation bar.

Again, do not change global navigation without considering the overall information architecture.

---

# PHASE 4 — PROFILE / TRUST / SUPPORT

Implement:

```text
016 Profile
017 Email verification status
018 Device security
019 Support
020 Legal
021 Investor charter
022 Grievance redressal
```

---

# PAGE 016 — PROFILE

Focus on identity/account information.

Remove internal architecture descriptions.

Provide feedback while signing out.

The audit found that account details cannot currently be edited.

Do not invent an edit screen unless an existing supported API allows it.

Record missing capability separately.

---

# PAGE 017 — EMAIL VERIFICATION STATUS

Replace generic state values with contextual copy.

For example, a naked:

```text
Not started
```

is less useful than a state presented specifically as email verification status.

Keep eligibility behaviour unchanged.

---

# PAGE 018 — DEVICE SECURITY

Prioritise clarity over lengthy security-model explanation.

Do not weaken:

- PIN logic
- biometric logic
- lock timing
- PIN removal behaviour
- sign-out behaviour

Review all uncaptured states directly from source before changing them.

---

# PAGE 019 — SUPPORT

Current stored support category slugs must not be rendered directly.

Render the human label the client selected.

Review FAQs mentioning:

```text
SIP
AutoPay
```

The extraction notes that this flow was not exercised during the audit.

Do not remove these FAQs simply because they were not tested.

Determine whether SIP/AutoPay is intended for production from the existing product configuration/source.

If uncertain, mark:

```text
REQUIRES PRODUCT DECISION
```

rather than deleting functionality/content.

---

# PAGE 020 — LEGAL

The audit found no linked:

```text
Terms of Service
Privacy Policy
Risk Disclosure
Fee Schedule
```

Do not fabricate them.

Improve the structure/presentation of authoritative legal documents that actually exist.

Record missing documents as release blockers/product/legal requirements where appropriate.

---

# PAGE 021 — INVESTOR CHARTER

Current UI can expose:

```text
Version 1
```

while simultaneously saying the document has not been published.

Do not expose the raw record version.

Create a clear unpublished/unavailable state.

Do not fabricate charter content.

---

# PAGE 022 — GRIEVANCE REDRESSAL

Same principle:

Do not expose database/document version internals.

Improve external-link failure feedback.

Do not invent grievance policy text.

---

# PHASE 5 — AUTHENTICATION AND EDGE SCREENS

Finally review:

```text
001 Splash
002 Login
003 Verify email
024 Not found
025 Index redirect
```

---

## 001 Splash

A splash/loading screen should not explain infrastructure.

It should communicate:

```text
starting
connecting
connection problem
retry
```

when relevant.

---

## 002 Login

Remove architecture marketing from the surrounding auth shell.

Do not add:

```text
Forgot password
Create account
Register
```

unless those flows genuinely exist.

Do not create dead affordances.

---

## 003 Verify Email

Explain:

- verification requirement
- current status
- required client action
- what becomes available afterward

Do not explain server eligibility architecture.

---

## 024 Not Found

Resolve duplicated mobile heading behaviour through the shared shell solution.

Keep the page concise.

Provide a meaningful return destination.

---

## 025 Index Redirect

There is no actual screen.

Preserve routing behaviour unless the wider routing audit identifies a concrete issue.

---

# INFORMATION ARCHITECTURE REVIEW

The primary navigation currently contains:

```text
Home
Funds
Portfolio
Activity
Profile
```

Two meaningful routes are linked from elsewhere but absent from primary navigation:

```text
/sips
/statements
```

Do not mechanically add them.

After the page implementation is stable, determine whether:

### Option A

The five-item navigation already represents the correct top-level client model.

or:

### Option B

SIP Plans / Statements need stronger discoverability through Profile, Portfolio, Activity, Dashboard or navigation.

Record this as a UX decision.

Avoid overcrowding mobile bottom navigation.

---

# CLIENT-FACING IDENTIFIER POLICY

Perform a frontend-wide audit for:

```text
UUID
opaque token
snake_case
enum token
provider code
internal record version
request ID
```

Rules:

### Internal UUID

Do not show unless the user genuinely needs it.

### Support/reference identifier

If operationally useful, label it clearly:

```text
Reference ID
```

Do not show multiple internal references without explanation.

### Provider slug

Map:

```text
phonepe
```

to:

```text
PhonePe
```

when provider identity is relevant.

Otherwise omit it.

### Failure code

Never use as the main user explanation.

Map it to a client message.

### Event kind

Never render directly.

Map it to a notification title/type.

### Raw record version

Do not display as client content.

---

# EMPTY VALUE POLICY

Do not use `—` everywhere as a generic fallback.

For each data field choose one of:

```text
omit the row
Not available
Not provided
Not applicable
Pending
Status unavailable
```

according to semantics.

The difference matters.

---

# USER ACTION FEEDBACK POLICY

Any user-triggered operation should provide feedback when it is not immediately obvious.

Audit specifically identified weak feedback around:

- external links
- Mark read
- sign out

Check the whole frontend for similar cases.

Actions should expose one or more of:

```text
disabled/loading state
inline progress
success indication
failure indication
navigation/result
```

Do not add noisy confirmation messages for every trivial navigation click.

---

# TOAST POLICY

A ToastProvider exists but client screens currently do not use it.

Do NOT mechanically convert everything to toast notifications.

Use:

### Inline alerts

for state that should remain visible.

### Toasts

for transient action feedback where appropriate.

### Modal confirmations

only for meaningful destructive/state-changing actions.

Establish a consistent pattern.

---

# VISUAL IMPLEMENTATION RULES

After content problems have been addressed, inspect the screenshots for presentation inconsistencies.

Focus on:

- information hierarchy
- spacing
- grouping
- typography hierarchy
- responsive behaviour
- mobile page density
- button hierarchy
- card consistency
- redundant sections
- excessively large explanatory blocks
- duplicated labels
- content overflow
- empty whitespace

Do not redesign BeOnEdge into an unrelated visual product.

Improve the existing design language.

---

# MOBILE IS A FIRST-CLASS TARGET

Every implemented page must be evaluated at approximately:

```text
390 × 844
```

and desktop at:

```text
1440 × 900
```

Do not treat the APK/mobile layout as a scaled desktop site.

Pay special attention to:

- duplicated headings
- sticky/fixed chrome
- bottom navigation
- back navigation
- transaction flows
- dialogs/sheets
- long financial values
- tab layouts
- table/card transformations

---

# IMPLEMENTATION METHOD

For each page:

## Step 1

Read its:

```text
page.md
```

## Step 2

Inspect:

```text
desktop.png
mobile.png
additional state screenshots
```

## Step 3

Read the actual source code and shared components it depends upon.

## Step 4

List the page's audit flags.

## Step 5

Determine which findings were already solved by shared-component changes.

## Step 6

Implement the remaining page-specific changes.

## Step 7

Run the application and inspect both desktop and mobile.

## Step 8

Test important alternate states.

## Step 9

Update `IMPLEMENTATION_TRACKER.md`.

## Step 10

Capture new post-implementation screenshots.

---

# AFTER SCREENSHOT STRUCTURE

Create:

```text
release_manager/audit_pages/client/implemented/
```

and preserve page IDs.

Example:

```text
implemented/
├── 004_dashboard/
│   ├── desktop.png
│   ├── mobile.png
│   └── implementation.md
│
├── 007_lumpsum/
│   ├── desktop.png
│   ├── mobile.png
│   └── implementation.md
```

Never overwrite the extraction screenshots.

They are the baseline.

---

# IMPLEMENTATION.MD

For each page record:

```markdown
# Implementation Result

## Source audit flags

- 007-01
- 007-02
- ...

## Changes made

...

## Shared fixes inherited

...

## Product behaviour intentionally unchanged

...

## Remaining issues

...

## Requires product/legal decision

...

## Files modified

...

## Verification

Desktop:
Mobile:
Loading state:
Empty state:
Error state:
Populated state:
```

---

# TESTING PRIORITY

Do not create unnecessary tests for simple wording changes.

Prioritise focused regression coverage around:

- account-state routing
- blocked route
- payment state mapping
- failure sanitisation
- client status mappings
- eligibility guards
- SIP/AutoPay state mapping
- update-security behaviour where touched
- device-security behaviour where touched

Existing payment/security logic must continue to behave identically unless fixing a demonstrated defect.

---

# BUILD / QUALITY GATE

Before a batch is considered complete run the repository's applicable:

```text
TypeScript type checking
linting
frontend tests
production build
```

Also run the actual client and visually inspect it.

A successful build alone is insufficient for this task.

---

# DO NOT DO A GLOBAL STRING-REPLACE PASS

Many terms need contextual treatment.

For example:

```text
provider
ledger
mandate
reference
version
```

may be valid in one context and inappropriate in another.

Understand what the page is communicating before changing it.

---

# DO NOT OPTIMISE FOR THE AUDIT SCORE

The objective is not simply:

```text
169 flags -> 0 flags
```

Some findings may be intentionally retained.

The objective is a coherent production client experience.

Each retained finding must have a reason.

---

# IMPLEMENTATION ORDER

Follow this order unless a shared dependency requires adjustment:

## Batch A — Shared Foundation

```text
ClientFrame
AuthLayout
ErrorState
failure mappings
status presentation
pluralisation
LoadMore
ConfirmDialog
transactional back behaviour
PendingPaymentRecovery
```

## Batch B — Money-Critical

```text
011 Payment status
007 Lump-sum investment
010 Activity
008 Start SIP
013 SIP detail
```

## Batch C — High-Visibility

```text
004 Dashboard
005 Funds
006 Fund detail
009 Portfolio
012 SIP plans
014 Statements
015 Notifications
```

## Batch D — Account / Trust

```text
016 Profile
017 Email verification
018 Device security
019 Support
020 Legal
021 Investor charter
022 Grievance
023 Account unavailable
```

## Batch E — Entry / Edge States

```text
001 Splash
002 Login
003 Verify email
024 Not found
025 redirect
```

---

# IMPORTANT PAYMENT / SIP SAFETY RULE

When improving payment and SIP terminology, never change protocol behaviour simply because the internal vocabulary looks ugly.

For example:

```text
mandate
provider
payment attempt
settlement
reconciliation
```

may be necessary internal concepts.

The correct approach is:

```text
backend/domain state stays precise
        ↓
frontend presentation layer translates it
        ↓
client receives understandable wording
```

Do not simplify the actual state machine.

---

# DEFINITION OF DONE

The implementation phase is complete only when:

1. All 25 audited routes have been reviewed.
2. All 169 findings have a disposition.
3. Shared developer-oriented content has been reviewed.
4. Raw internal identifiers are no longer unnecessarily visible.
5. Raw provider/server failure codes are not client copy.
6. Raw snake_case event/category values are not rendered.
7. Machine-generated plurals are corrected.
8. Empty values are intentional and understandable.
9. Mobile duplicate headings are resolved.
10. Client actions provide appropriate feedback.
11. Payment and SIP business logic remains intact.
12. Device-security behaviour remains intact.
13. Update-security behaviour remains intact.
14. Legal content has not been fabricated.
15. Desktop screenshots have been reviewed.
16. Mobile screenshots have been reviewed.
17. Post-implementation screenshots exist separately from the audit baseline.
18. Type checking succeeds.
19. Tests succeed.
20. Production frontend build succeeds.

---

# FINAL IMPLEMENTATION REPORT

When all batches are complete, create:

```text
release_manager/audit_pages/client/IMPLEMENTATION_SUMMARY.md
```

Include:

```text
Pages reviewed
Audit flags fixed
Audit flags accepted
Product decisions required
Legal content required
Shared components modified
Client-facing terminology mappings added
Raw identifiers removed from presentation
Raw error/code mappings added
Navigation decisions
Known remaining UX issues
Tests run
Build result
```

Also explicitly list any:

```text
backend changes
API changes
database changes
payment logic changes
SIP/AutoPay logic changes
auth/eligibility changes
```

There should normally be none unless separately justified.

---

# FIRST ACTION

Start with **Batch A — Shared Foundation**.

Before editing, read:

```text
AUDIT_INDEX.md
ROUTE_INVENTORY.md
SHARED_COMPONENTS.md
```

and inspect the actual shared source files.

Then implement the shared fixes.

After Batch A, proceed directly into the money-critical screens beginning with:

```text
011 Payment status
007 Lump-sum investment
010 Activity
008 Start SIP
013 SIP detail
```

Do not perform another extraction phase.

Do not stop after producing another report.

This phase is for actual production implementation, verification and before/after evidence.