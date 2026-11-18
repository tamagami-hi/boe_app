# BeOnEdge Client Application
# PRODUCTION READINESS / BEHAVIOURAL VERIFICATION

## PURPOSE

The client-facing content implementation pass is complete.

Baseline result:

```text
169 findings total
132 FIXED
19 ACCEPTED
14 REQUIRES PRODUCT DECISION
4 REQUIRES LEGAL CONTENT
```

The frontend presentation has already been significantly cleaned.

Do NOT perform another general content rewrite.

A separate agent is independently performing a UI/UX/layout/design audit.

This task has a different responsibility:

> Determine whether the current client application is behaviourally safe and production-ready after the completed presentation changes, identify what is still genuinely blocking release, and convert every unresolved product/legal item into an explicit decision package.

---

# IMPORTANT SEPARATION OF RESPONSIBILITIES

There are now three distinct tracks.

## Track A — Completed

Client-facing wording / presentation cleanup.

Do not reopen this broadly.

## Track B — Running separately

UI/UX / layout / visual hierarchy / responsive design audit.

Do not redesign layouts or CSS during this task.

## Track C — THIS TASK

Production readiness, behavioural/state verification, regression analysis and unresolved-decision preparation.

---

# READ FIRST

Read completely:

```text
release_manager/audit_pages/client/IMPLEMENTATION_SUMMARY.md
release_manager/audit_pages/client/IMPLEMENTATION_TRACKER.md
release_manager/audit_pages/client/AUDIT_INDEX.md
release_manager/audit_pages/client/ROUTE_INVENTORY.md
release_manager/audit_pages/client/SHARED_COMPONENTS.md
```

Also inspect:

```text
release_manager/audit_pages/client/implemented/
```

for the relevant pages.

The extraction baseline must remain untouched.

---

# CURRENT IMPLEMENTATION BASELINE

The completed implementation reports:

```text
raw UUID pages                     1 -> 0
snake_case token pages             1 -> 0
visible architecture terms        10 -> 0
screens rendering error.message    4 -> 0
horizontal overflow 390x844        0 -> 0
```

Do not regress these properties.

---

# ABSOLUTE SCOPE RULE

This phase is primarily:

```text
VERIFY
CLASSIFY
DOCUMENT
TEST
```

not:

```text
REDESIGN
REWRITE
REFACTOR
ADD FEATURES
```

Do not implement product decisions.

Do not fabricate legal content.

Do not touch UI layout/style issues being investigated by the separate UI/UX audit.

---

# ALLOWED SOURCE CHANGES

Default: **READ ONLY**.

A source modification is allowed only if verification discovers a clear regression or production-critical correctness defect introduced by the completed implementation.

Examples:

```text
wrong payment status mapped
valid API state disappears
guard redirects incorrectly
button invokes wrong action
payment state loses required information
client error mapping produces factually false copy
runtime crash
route cannot render
accessibility regression prevents operation
```

If such a defect is discovered:

1. document it first;
2. identify exact root cause;
3. make the narrowest possible correction;
4. run focused regression verification;
5. record it separately as a post-implementation correction.

Do not use this exception for visual polish.

---

# OUTPUT DIRECTORY

Create:

```text
release_manager/audit_pages/client/release_readiness/
```

Recommended files:

```text
RELEASE_READINESS.md
STATE_VERIFICATION_MATRIX.md
PRODUCT_DECISIONS.md
LEGAL_BLOCKERS.md
ACCEPTED_FINDINGS_REVIEW.md
REGRESSION_REPORT.md
UNVERIFIED_STATES.md
FINAL_RELEASE_GATE.md
```

Do not overwrite:

```text
IMPLEMENTATION_SUMMARY.md
IMPLEMENTATION_TRACKER.md
page.md
baseline screenshots
implemented screenshots
```

---

# PHASE 1 — VERIFY THE IMPLEMENTATION ITSELF

Before investigating unresolved issues, confirm that the completed implementation is internally coherent.

Run the repository's current quality gates.

At minimum:

```text
npm run typecheck
npx eslint src
npx vitest run
npm run build
node scripts/check-bundle-boots.mjs
node scripts/check-android-dist.mjs
```

Also run any existing PhonePe/payment guard already used by the project.

Record exact results.

Do not claim production readiness merely because the build succeeds.

---

# PHASE 2 — PRESENTATION-MAPPER CONTRACT AUDIT

The implementation added a presentation layer under:

```text
frontend_stack_ts/src/domain/
```

including:

```text
failure.ts
paymentReason.ts
provider.ts
notifications.ts
clientStatus.ts
plural.ts
reference.ts
```

Audit these carefully.

The fundamental rule is:

```text
internal domain state
        ↓
client presentation mapping
        ↓
safe human-readable output
```

Verify that this boundary cannot leak internal values again.

---

## A. Unknown Value Behaviour

The implementation rule is:

> Unknown provider/status/event/failure values must not render raw machine tokens.

Verify this explicitly.

For each presentation mapper test:

```text
known value
unknown value
null
undefined
unexpected casing where type boundaries permit it
```

Expected behaviour must be deliberate.

Unknown values must either:

```text
produce a safe generic presentation
```

or:

```text
return null and cause the row/badge to be omitted
```

They must never render the raw value.

---

## B. Failure Handling

Verify that:

```text
error.message
```

can no longer become client copy through any code path.

Search the entire CLIENT frontend for:

```text
error.message
.message
failureCode
requestId
provider
```

Do not flag legitimate internal/logging use.

Trace every rendered path.

Unknown failures must use the controlled fallback.

---

## C. Client/Admin Separation

Verify that client-friendly mappings did not alter admin-facing terminology.

In particular:

```text
sipState
mandateState
mandateSetupState
```

were intentionally preserved for precise internal/admin usage.

Make sure no client presentation cleanup accidentally changed admin semantics.

---

# PHASE 3 — MONEY-PATH REGRESSION REVIEW

This is the highest-risk area.

Inspect:

```text
007 lump-sum investment
008 SIP creation
010 Activity
011 payment status
012 SIP list
013 SIP detail
```

Do not initiate a real payment merely to test presentation.

Do not mutate a live SIP.

Instead combine:

```text
source tracing
existing tests
mocked/unit-level state rendering where safe
existing captured states
non-persistent browser state where safe
```

---

# PAYMENT STATE MATRIX

Create a complete matrix for every client investment/payment state.

For every state document:

| Internal state | Client label | Client explanation | Actions | Reference shown? | Retry? |
|---|---|---|---|---|---|

Include at least the states corresponding to:

```text
awaiting payment
being invested
invested
refund in progress
needs review
refunded
payment failed
```

Confirm that:

- two different technical states are not accidentally presented as the same thing when a user action differs;
- the explanation never asserts money movement that the backend does not guarantee;
- a failed state does not falsely imply funds were not debited;
- a pending state does not falsely imply success;
- refund states do not imply refund completion prematurely.

Accuracy is more important than friendly wording.

---

# PAYMENT STATUS SCREEN

Re-verify page 011 specifically.

Expected presentation hierarchy from the completed work is broadly:

```text
Fund
Amount
Status
Explanation
Relevant actions
Payment details
Reference ID
```

Verify:

- fund resolution failure does not crash the page;
- an unknown payment partner is omitted cleanly;
- unknown failure code is omitted safely;
- short Reference ID is stable enough for support use;
- the full internal UUID remains available internally if support/admin requires it;
- retry navigation is correct;
- support action works;
- automatic refresh does not cause state flicker or duplicate action rendering.

---

# SHORT REFERENCE SAFETY REVIEW

The client now receives an 8-character reference derived from the internal identifier.

Do NOT automatically change this.

Analyse whether this is operationally safe for support.

Answer:

```text
What is the source identifier?
How many references can realistically coexist?
Can two records share the same first eight characters?
Can support search by this shortened reference?
Does admin tooling understand it?
What happens if more than one record matches?
```

If support cannot reliably use the shortened reference, classify it as:

```text
REQUIRES PRODUCT/OPERATIONS DECISION
```

Do not expose the full UUID again merely to solve it.

---

# PHASE 4 — SIP / AUTOPAY STATE MATRIX

Document every relevant client SIP state and presentation.

Internal state must remain precise.

For each state record:

```text
internal state
client label
client explanation
available actions
whether AutoPay action exists
whether manual payment action exists
```

Include:

```text
draft
awaiting authorisation
active
paused
cancelling
cancelled
completed
setup failed
authorisation failed
expired
revoked
```

and corresponding AutoPay/mandate states where relevant.

Verify that the client's visible action always agrees with what the backend permits.

Example dangerous regression:

```text
Client sees "Try AutoPay again"
but current backend state rejects setup restart.
```

That is a production defect.

---

# DO NOT EXERCISE LIVE AUTOPAY

AutoPay is currently blocked on PhonePe provisioning.

Do not:

```text
create a mandate
cancel a real mandate
pause a live SIP
resume a live SIP
create a real SIP
```

Use source/state modelling for those paths.

Mark them:

```text
SOURCE VERIFIED — NOT END-TO-END VERIFIED
```

---

# PHASE 5 — ACCOUNT ACCESS / GUARD MATRIX

The completed pass fixed a genuine `/blocked` defect.

Now create a complete route/access matrix.

Account states:

```text
anonymous
invited
active + unverified
active + verified
suspended
closed
```

Route classes:

```text
public
session-required
client-required
eligible/investment-required
terminal-account allowed
```

Document expected destination for each relevant combination.

Pay special attention to:

```text
/dashboard
/verify-email
/funds/:id/invest/lumpsum
/funds/:id/invest/sip
/activity/payments/:paymentId
/blocked
/login
/
```

The matrix should make it impossible for the same class of false-state bug to reappear elsewhere.

---

# BLOCKED SCREEN

The active-state branch has been behaviourally verified.

The suspended and closed states were not.

Inspect their source carefully.

Verify that:

```text
suspended ≠ closed
```

in:

- title
- explanation
- available actions
- navigation
- support route
- sign-out behaviour

Also inspect shell behaviour.

A terminal-account screen should not accidentally expose navigation/actions the account cannot use.

If this is purely a visual/layout concern, leave it for the UI/UX audit.

If navigation remains functionally available when it should not be, classify it as behavioural.

---

# PHASE 6 — EMAIL VERIFICATION

The previous implementation deliberately retained one known issue:

```text
Code sent success
+
verification error
```

can coexist.

Do not automatically change it.

Analyse the actual state machine and produce a recommendation.

Determine whether:

```text
toast for send confirmation
clear success on verify attempt
single status region
```

would be semantically safest.

Classify it as:

```text
ACCEPTED FOR RELEASE
```

or:

```text
SHOULD FIX BEFORE RELEASE
```

with reasoning.

Do not implement unless it creates a materially confusing or incorrect production state and the change is extremely narrow.

---

# PHASE 7 — NATIVE / APK-ONLY SURFACES

The following remain incompletely rendered or verified:

```text
device lock
PIN set/change/remove states
biometric states
mandatory update
optional update
installer states
native transactional back
```

Audit these from source plus safe runtime states.

---

## Device Lock

Verify:

- PIN entry
- wrong PIN
- biometric cancelled
- biometric unavailable
- biometric failed
- forgotten PIN
- PIN removal
- sign-out
- idle lock threshold
- cold-start lock

Do not alter the maintainer's device state unless a disposable emulator/profile is available.

If a disposable emulator can be safely created, use that instead of the maintainer's active device.

---

## App Update

Verify the state machine without changing the deployed update feed.

Inspect:

```text
no update
optional update
mandatory update
download
download failure
digest mismatch
unknown-source permission
installer launch
```

Security properties must remain intact:

```text
HTTPS requirement
digest verification
package verification
verified-download-only installation
```

Do not weaken any update security mechanism to make testing easier.

---

# PHASE 8 — ACCEPTED FINDINGS REVIEW

There are 19 findings classified as ACCEPTED.

Do NOT treat ACCEPTED as equivalent to FIXED.

Create:

```text
ACCEPTED_FINDINGS_REVIEW.md
```

For every one record:

```text
Flag
Reason originally accepted
Still valid after implementation?
Release risk
UI/UX agent should reconsider?
Product owner should reconsider?
Final recommendation
```

Use:

```text
KEEP ACCEPTED
REOPEN BEFORE RELEASE
SEND TO UI/UX
SEND TO PRODUCT
```

This is especially important for accepted findings that are arguably UX rather than content issues.

Examples include:

```text
native window.confirm
verification success + error simultaneously
fund-looking text inside a clickable payment row
web/native device-security presentation
404 action strategy
```

Do not change them yet.

---

# PHASE 9 — PRODUCT DECISION REGISTER

There are 14 unresolved product decisions.

Create:

```text
PRODUCT_DECISIONS.md
```

Do NOT simply copy the tracker.

Turn each into a decision that the product owner can answer.

Group duplicates.

For example, the category-casing findings across multiple pages are ONE product decision, not several unrelated questions.

Recommended decision set:

---

## PD-01 Account acquisition/recovery

Current state:

```text
No password-reset client flow.
No sign-up client flow.
```

Determine:

- Is client creation invitation/admin-only by design?
- Where should a client who forgets their password go?
- Should Login link to support or marketing site?
- Is password reset required for production?

---

## PD-02 Fund category taxonomy

Current server-authored values such as:

```text
hybrid
```

render verbatim.

Determine whether categories should:

```text
remain server-authored display values
```

or:

```text
have canonical client labels
```

If canonical, define them authoritatively.

Do not guess.

---

## PD-03 Fund disclosure publishing quality

Determine who owns the fund disclosure body and what the minimum publishable content standard is.

The frontend should not attempt to repair poor server-authored disclosures.

---

## PD-04 SIP discoverability

`/sips` is not in the five-item primary navigation.

Determine whether:

```text
current Home/Portfolio discoverability is sufficient
```

or whether it needs stronger placement.

Do not overcrowd the bottom bar without deliberate IA design.

Wait for the UI/UX audit before recommending exact placement.

---

## PD-05 Statement export

Decide whether Statements should support:

```text
PDF
CSV
share
email
download
```

or remain in-app only.

This is a product/backend feature decision.

---

## PD-06 Notification publishing

Determine policy for:

- duplicate messages;
- app-version numbers;
- server-authored tone;
- user already being inside the app;
- deduplication.

---

## PD-07 Profile editing

Determine whether clients are allowed to modify:

```text
name
phone
address
password
bank/account information
```

and which require verification/review.

Do not add edit controls without a backend policy.

---

## PD-08 AutoPay FAQ publication

AutoPay exists but provider provisioning currently blocks it.

Decide whether AutoPay FAQs should:

```text
remain visible before activation
be marked coming soon
be hidden until available
```

---

## PD-09 Support operating model

Authoritatively determine:

```text
support email
phone
office address
response commitment
ticket SLA
FAQ search requirement
```

Do not invent values.

---

## PD-10 App-origin behaviour

Determine whether:

```text
app.beonedge...
```

is strictly an authenticated application origin

or should have a public landing screen.

Do not conflate this with the separate BeOnEdge marketing site.

---

For every decision include:

```text
Current behaviour
Why a decision is needed
Available options
Impact of each option
Backend/API dependency
UI dependency
Release blocking?
Recommended owner
```

Do NOT select the option unless existing product documentation already makes it unambiguous.

---

# PHASE 10 — LEGAL RELEASE BLOCKERS

Create:

```text
LEGAL_BLOCKERS.md
```

The implementation identified four legal-content findings.

Consolidate them into authoritative deliverables.

At minimum:

```text
Terms / governing client agreement
Privacy policy
Risk disclosure
Fee schedule where applicable
Investor charter
Grievance redressal policy
```

Do NOT write any of these documents.

For each record:

```text
Does authoritative content exist?
Where is it expected to come from?
Where will the frontend display/link it?
Is current absence release-blocking?
Who must approve it?
```

The frontend currently renders honest unavailable states.

Do not replace them with AI-generated legal copy.

---

# PHASE 11 — VERIFY SERVER-AUTHORED CONTENT BOUNDARIES

Several remaining issues belong to server-published content rather than frontend code.

Identify every backend-authored field visible in the client, including:

```text
fund category
fund disclosure
notification title
notification body
FAQ content
legal documents
```

Create a small publishing-governance section.

For each field record:

```text
frontend sanitises?
frontend maps?
frontend renders verbatim?
admin controls it?
client-visible immediately?
requires publication review?
```

The objective is to prevent future admin/server content from reintroducing an AI/developer feel even after the frontend cleanup.

---

# PHASE 12 — NO-GO / GO RELEASE GATE

Create:

```text
FINAL_RELEASE_GATE.md
```

Use these classifications:

```text
GO
GO WITH ACCEPTED RISK
BLOCKED — PRODUCT
BLOCKED — LEGAL
BLOCKED — BEHAVIOURAL
BLOCKED — PROVIDER
WAITING FOR UI/UX AUDIT
```

Assess:

---

## Authentication

```text
login
session restoration
verification
sign-out
blocked accounts
```

## Money

```text
lump-sum initiation
payment tracking
Activity
payment state presentation
refund presentation
```

## SIP

```text
manual SIP
SIP states
AutoPay presentation
provider provisioning
```

## Account

```text
profile
security
support
notifications
```

## Legal

```text
legal index
investor charter
grievance
other required documents
```

## Native

```text
device lock
app updates
hardware back
APK startup
```

## UX

Do NOT duplicate the design audit.

Simply write:

```text
WAITING FOR client_ui/IMPLEMENTATION_BLUEPRINT.md
```

until that audit is complete.

---

# PHASE 13 — REGRESSION AGAINST BEFORE/AFTER CLAIMS

Re-run the measurable presentation checks and verify they still hold:

```text
raw UUID                        0 pages
snake_case client tokens        0 pages
architecture terminology        0 pages
raw error.message               0 screens
horizontal overflow 390x844     0 routes
```

If any regression appears, investigate immediately.

---

# PHASE 14 — DO NOT REDO THE VISUAL AUDIT

Another agent is currently auditing:

```text
layout
hierarchy
spacing
responsive composition
component visual consistency
overlap
design system
navigation presentation
```

Do not duplicate or pre-empt its findings.

If you encounter a visual concern, record:

```text
FOR UI/UX AUDIT
```

and continue.

---

# PHASE 15 — PREPARE HANDOFF TO UI IMPLEMENTATION

When the UI/UX audit later produces:

```text
release_manager/audit_pages/client_ui/UI_AUDIT_INDEX.md
release_manager/audit_pages/client_ui/DESIGN_SYSTEM_AUDIT.md
release_manager/audit_pages/client_ui/RESPONSIVE_AUDIT.md
release_manager/audit_pages/client_ui/NAVIGATION_AUDIT.md
release_manager/audit_pages/client_ui/COMPONENT_AUDIT.md
release_manager/audit_pages/client_ui/IMPLEMENTATION_BLUEPRINT.md
```

do NOT immediately implement it as part of this task.

Instead leave the production-readiness material ready so a final implementation agent can combine:

```text
completed content implementation
+
production-readiness findings
+
UI/UX blueprint
+
product-owner decisions
+
legal content
```

without rediscovering the application again.

---

# FINAL RESPONSE

Return a concise summary:

```text
Quality gates:
Presentation regression scan:
Payment states verified:
SIP states verified:
Account/guard states verified:
Native states verified:
Accepted findings kept:
Accepted findings recommended to reopen:
Product decisions:
Legal blockers:
Behavioural blockers:
Provider blockers:
Waiting for UI/UX:
Overall release classification:

Reports:
release_manager/audit_pages/client/release_readiness/...
```

Explicitly state whether any application source files were modified.

If none:

```text
No application source files were modified during the production-readiness verification.
```

If a narrow regression correction was necessary, list every source file changed and the exact defect that justified it.