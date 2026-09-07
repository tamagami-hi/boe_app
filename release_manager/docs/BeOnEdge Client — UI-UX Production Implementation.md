# BeOnEdge Client Application
# UI / UX PRODUCTION IMPLEMENTATION

## ROLE

The read-only UI/UX audit is complete.

You are now authorised to begin the **actual UI/UX implementation** based on that audit.

This is NOT another audit phase.

Do not spend another large pass rediscovering problems that have already been measured and documented.

Use the existing reports as the source of truth, trace the source before each systemic change, implement the fixes, and then re-measure the resulting application.

---

# CURRENT STATE

The client content/presentation implementation has already been completed.

That previous pass:

```text
removed raw UUID presentation
removed raw snake_case presentation
removed client-visible architecture terminology
prevented error.message reaching client copy
created client-specific domain/presentation mappings
fixed /blocked active-account behaviour
preserved backend/payment/SIP/auth contracts
```

Do NOT regress any of that work.

The UI/UX audit was performed against the post-content implementation state.

Audited revision:

```text
dedf19f
```

with the important preceding frontend implementation commit:

```text
21814bc
feat(client): production UI and content pass across all 25 client routes
```

Before editing, confirm the current working tree and HEAD.

If the repository has advanced since `dedf19f`, do not reset or overwrite newer work.

Reconcile the audited source references against the current files first.

---

# SOURCE OF TRUTH

Read these completely before implementation:

```text
release_manager/audit_pages/client_ui/UI_AUDIT_INDEX.md
release_manager/audit_pages/client_ui/IMPLEMENTATION_BLUEPRINT.md
release_manager/audit_pages/client_ui/DESIGN_SYSTEM_AUDIT.md
release_manager/audit_pages/client_ui/COMPONENT_AUDIT.md
release_manager/audit_pages/client_ui/NAVIGATION_AUDIT.md
release_manager/audit_pages/client_ui/RESPONSIVE_AUDIT.md
```

Also use all per-route:

```text
release_manager/audit_pages/client_ui/<PAGE>/ui_audit.md
```

The implementation blueprint is the PRIMARY implementation plan.

The other reports provide evidence and reasoning.

Do not reinterpret the findings from scratch unless the current source has materially changed.

---

# EXISTING AUDIT MUST REMAIN IMMUTABLE

The current files under:

```text
release_manager/audit_pages/client_ui/
```

are the before-state.

Do not rewrite the original audit reports.

Do not modify the original measurement JSON.

Do not overwrite the existing audit evidence.

Create implementation artifacts separately.

---

# IMPLEMENTATION OUTPUT

Create:

```text
release_manager/audit_pages/client_ui/UI_IMPLEMENTATION_TRACKER.md
release_manager/audit_pages/client_ui/UI_IMPLEMENTATION_SUMMARY.md
release_manager/audit_pages/client_ui/implemented/
```

Use the same page IDs.

Example:

```text
client_ui/
├── UI_AUDIT_INDEX.md
├── IMPLEMENTATION_BLUEPRINT.md
├── ...
├── UI_IMPLEMENTATION_TRACKER.md
├── UI_IMPLEMENTATION_SUMMARY.md
└── implemented/
    ├── 002_login/
    │   ├── implementation.md
    │   ├── mobile.png
    │   └── desktop.png
    ├── 004_dashboard/
    └── ...
```

Keep before and after evidence separate.

---

# SCOPE

This implementation is specifically for:

```text
layout
spacing
hierarchy
component composition
responsive behaviour
design-system consistency
navigation presentation
interaction affordance
form geometry
financial-value presentation
touch ergonomics
focus states
modal/sheet behaviour
visual state hierarchy
loading-state geometry
empty/error presentation
desktop composition
mobile composition
accessibility-related UI mechanics
```

---

# NOT IN SCOPE

Do NOT change:

```text
backend contracts
API schemas
database schemas
payment state machine
PhonePe protocol behaviour
SIP scheduling
AutoPay business logic
mandate domain logic
authentication eligibility rules
investment calculations
fund calculations
legal content
product scope
```

Do not implement unresolved product decisions from the previous content audit.

Do not create:

```text
password reset
sign-up
statement download
new profile-edit capabilities
new support channels
new legal documents
new AutoPay behaviour
```

unless separately authorised.

---

# UI BEHAVIOUR CHANGES THAT ARE ALLOWED

This audit identified UI components that advertise interaction semantics they do not actually implement.

You ARE allowed to fix UI-level behaviour such as:

```text
keyboard navigation
focus management
Escape handling
modal focus trapping
scroll locking
touch-target sizing
tab semantics
radio-group semantics
safe-area layout
navigation back affordances
interaction ordering
```

These are UI/UX implementation changes.

They must NOT change the underlying financial/domain action.

Any such behavioural change requires focused testing.

---

# PRESERVE THE DESIGN IDENTITY

Do NOT redesign BeOnEdge from scratch.

The audit determined that the existing design system is intentional and coherent:

```text
warm parchment surfaces
espresso navigation
gold accent
Fraunces display typography
Instrument Sans UI typography
squircle radius family
two-tier shell/elevation language
```

Preserve that identity.

Do NOT:

```text
replace the palette
introduce generic blue-fintech styling
add glassmorphism
introduce a completely different typography system
flatten every surface
remove the editorial identity
copy Groww / Zerodha / INDmoney / Paytm Money
```

The goal is to make the existing design system behave consistently.

---

# FUNDAMENTAL IMPLEMENTATION PRINCIPLE

Fix root causes before fixing individual pages.

The audit found that most visible problems originate in:

```text
shared components
shell
tokens
breakpoints
```

Therefore:

> Never apply a page-specific CSS patch when the root cause belongs to a reusable component or recipe.

Example:

Bad:

```text
LoginScreen -> add margin-bottom
```

Correct:

```text
Introduce shared form composition
    ↓
Form owns field rhythm
    ↓
Action group owns field-to-CTA separation
    ↓
Login, verification, investing, SIP and support inherit it
```

---

# BATCH 0 — PRE-IMPLEMENTATION SAFETY

Before modifying anything:

Record:

```text
git rev-parse HEAD
git status --short
VERSION
current APK/client build identity if available
```

Confirm no unrelated dirty files will be overwritten.

Record this at the top of:

```text
UI_IMPLEMENTATION_TRACKER.md
```

Then run the current frontend quality gate once so there is a pre-change baseline.

Do not start by refactoring unrelated code.

---

# BATCH 1 — P1 PRODUCTION-CRITICAL FIXES

These come first.

Do not begin broad P2/P3 polish until every P1 has been implemented and re-measured.

---

# P1-1 — OFFLINE BANNER / SHELL COLLISION

Audit IDs:

```text
CO-SHELL-01
NAV-01
RS-COLL-01
```

Current root cause:

```text
ConnectivityBanner
    sticky top-0
    z-index 200

ClientFrame header
    sticky top-0
    z-index 100
```

They live in independent sibling sticky contexts.

Measured mobile failure while offline + scrolled:

```text
banner covers 50.8px of a 60px header
banner covers 42.8px of a 44px icon button
```

Desktop:

```text
33.4px of the 82px navigation island covered
```

### Required direction

Create ONE top-chrome layout contract.

Preferred solutions described by the audit:

```text
A. shell owns the banner and header as one stack
```

or:

```text
B. banner publishes its height and the header consumes that
   height as its sticky top offset
```

Do NOT fix it by simply increasing the header z-index.

That would hide the offline state rather than solve the geometry.

### Acceptance

At minimum verify:

```text
390px online
390px offline at scrollY 0
390px offline at scrollY ~300
1440px offline at scrollY ~300
```

Required:

```text
0px interactive overlap
back button fully reachable
bell fully reachable
desktop navigation fully reachable
offline banner fully visible
```

---

# P1-2 — FORM COMPOSITION / LOGIN COLLISION

Audit IDs:

```text
CO-FORM-01
DS-SPACE-02
DS-MOTION-03
```

Current issue:

```text
email field → password field = 0px
password field → Sign in CTA = 0px
```

The button hover lift creates a measured:

```text
294 × 1.5px intersection
```

This is NOT a LoginScreen-only problem.

The actual root cause is that there is no shared form-composition abstraction.

### Required direction

Introduce a reusable form composition pattern.

It should separately own:

```text
field → field spacing
field → action-group spacing
```

The action gap should be larger than the inter-field gap.

A commitment action should not visually belong to the preceding input.

Apply appropriately to:

```text
002 login
003 email verification
007 lump sum
008 SIP
019 support
```

Do not simply add a margin to LoginScreen.

### Acceptance

Measure all relevant forms.

At minimum:

```text
360
390
412
768
1024
1440
1920 where practical
```

Required:

```text
no intersections
no near-zero field gaps
no hover collision
consistent form rhythm
CTA visually separated from final field
```

---

# P1-3 — PORTFOLIO MONEY COLLISION

Audit IDs:

```text
RS-MONEY-01
CO-MONEY-01
```

Current problem:

```text
Portfolio headline summary
grid-cols-3
```

creates approximately:

```text
84px columns at 360px
```

while a crore-scale money string paints at approximately:

```text
127px
```

The audit measured collision above approximately ₹10 lakh.

### Required direction

Use the already-proven pattern:

```text
grid-cols-2
md:grid-cols-4
```

or an equivalent implementation preserving the same principle.

Do NOT:

```text
shrink the client's money typography
allow wrapping of primary financial values
truncate the amount
```

The money typography itself is correct.

### Required stress value

Verify using at least:

```text
₹1,25,00,000
```

and preferably:

```text
-₹1,25,00,000.50
```

### Acceptance

Required:

```text
no cell collision
no viewport overflow
no wrapping
no clipping
no type reduction
```

at:

```text
360
390
412
```

and desktop.

---

# P1-4 — DASHBOARD BENTO TABLET BAND

Audit ID:

```text
RS-BP-01
```

Broken range:

```text
768 ≤ viewport < 1024
```

Current grid:

```text
6 columns

hero  = 6 columns
aside = 3 columns
```

so the aside is pushed into a half-empty row.

Measured dead region reaches roughly:

```text
368–464px
```

depending on width.

### Required direction

Make the `md` spans form a deliberate six-column composition.

Either:

```text
hero + aside = 6
```

or deliberately make the aside full-width.

Do not leave a half-width card by itself.

### Acceptance

Measure:

```text
768
860/900
1000
1023
1024
```

There must be no orphaned half-row.

---

# P1-5 — FUND DETAIL DECISION HIERARCHY

Route:

```text
006 /funds/:fundId
```

Current issue:

```text
Invest CTA = section 6 of 7
```

Measured below the fold at every audited width.

This is a hierarchy failure, not a spacing defect.

### Required direction

Move the primary investment decision closer to the fund's key decision information.

A client should not have to pass through nearly the entire document before discovering the primary action.

The action should live near information such as:

```text
fund identity
risk
minimum investment
important fund terms
```

while secondary information can continue below.

Do NOT duplicate the investment action everywhere.

Do NOT make it a permanently floating CTA unless the design clearly requires it.

Do NOT alter:

```text
eligibility guard
fund availability
minimum amount
investment routes
```

### Acceptance

At:

```text
390×844
1440×900
```

the primary decision/action should be visible in the initial decision area or immediately after the essential fund summary, rather than being section six.

---

# P1 CHECKPOINT

After the five P1 corrections:

STOP broad implementation temporarily.

Rebuild.

Run the geometry probes.

Update:

```text
UI_IMPLEMENTATION_TRACKER.md
```

with measured before → after values.

Do not proceed until every P1 is confirmed.

---

# BATCH 2 — FOUNDATION

Implement the systemic Foundation section of:

```text
IMPLEMENTATION_BLUEPRINT.md
```

in order.

---

# F1 — SINGLE TOP-CHROME STACK

Already handled under P1.

Do not create a second competing fix later.

---

# F2 — SHARED FORM COMPOSITION

Already handled under P1.

Ensure subsequent form fixes build on it.

---

# F3 — BOTTOM NAV CLEARANCE

Current Page clearance reserves:

```text
nav height
+
safe area
+
spacing
```

even though the sticky bottom nav already participates in document flow.

This creates:

```text
~104px systematic dead space
```

on scrollable mobile pages and much more on short pages.

### Direction

For an in-flow sticky nav, reserve only the extra content separation + safe bottom.

Then separately decide how short pages distribute unused vertical slack.

Do not solve this with individual page margins.

Verify every `Page` route at the bottom of the document.

---

# F4 — TYPOGRAPHIC HIERARCHY

Rationalise the heading system.

Current problem includes:

```text
h2 weaker than some card titles
multiple recipes for equivalent hierarchy
fund name represented four different ways
three uppercase label systems
```

### Direction

Create/settle one ordered hierarchy for:

```text
page h1
section h2
subsection/card h3
item title
label
stat label
```

Retain the Fraunces + Instrument Sans relationship.

Do not replace the typography identity.

Settle one fund-name treatment when the fund is a label.

Exception:

```text
006 fund detail
```

where the fund is the page subject and therefore legitimately uses the page h1.

---

# F5 — TOKEN CLEANUP

Resolve the design-token ambiguities identified in the blueprint.

This includes:

```text
one default divider/hairline role
focus treatment visible on dark navigation
honest spacing scale
content-width floor behaviour
```

Do not rewrite the token system wholesale.

Make the existing token layer accurately describe what the application actually uses.

---

# BATCH 3 — SHARED COMPONENT SYSTEM

Implement the Shared Components section of the blueprint before making page-specific replacements.

---

# S1 — FIELD FAMILY

Derive:

```text
Input
Select
Textarea
AmountInput where appropriate
```

from one visual field language.

Current measured inconsistencies include:

```text
44px vs 50px heights
12px vs 16px text inset
two focus languages
Select has no visible invalid state
AmountInput radius divergence
```

Resolve them systemically.

Do not make all controls identical when their purpose legitimately differs.

They should clearly belong to the same family.

---

# S2 — ACTION GROUPS / DESTRUCTIVE ACTIONS

Create a deliberate action composition for:

```text
primary
secondary
navigation
destructive
```

Destructive actions should not simply sit 8px from benign/navigation actions.

Review:

```text
011 payment status
013 SIP detail
018 device security
```

For confirmation sheets/dialogs:

```text
safe action must not be visually invisible
irreversible action should not automatically become the thumb-nearest dominant control
```

Preserve all underlying actions.

---

# S3 — ASYNC REFRESH WITHOUT REFLOW

Current refresh indicator shifts content approximately:

```text
29.4px
```

on refetch.

011 can poll repeatedly.

### Direction

The refresh indicator must not insert/remove page geometry.

Use:

```text
overlay
reserved region
header attachment
```

or another stable solution.

Verify that polling on payment status does not make the content jump.

---

# S4 — EMPTY VS ERROR STATES

Do not render a normal empty portfolio and a system failure with the same visual weight.

Build a distinction between:

```text
normal absence of data
temporary/operational error
```

Reuse the existing identity.

Do not create theatrical error screens.

Review action consistency for empty states.

---

# S5 — CARD WEIGHT

Keep the signature BeOnEdge card.

Do not remove it.

But stop using the full double-surface Card for every explanatory sentence.

Promote/reuse a lighter prose/inset container.

Audit identified excessive Card usage particularly on:

```text
008
013
018
021
022
```

Reduce unnecessary nesting.

---

# S6 — INTERACTIVE SEMANTICS

Implement the behaviours the components announce.

Review:

```text
Tabs
RadioGroup
Switch
Sheet
Modal
ConfirmDialog
```

Examples:

```text
keyboard arrow behaviour where role=tab/radio expects it
focus trap for modal sheet
Escape handling
scroll lock
appropriate close affordance
touch-target sizing
```

Do NOT merely delete ARIA roles to make the audit disappear unless the component is genuinely not meant to have that interaction model.

For accessibility behavioural work, add focused tests.

---

# S7 — LINK AFFORDANCE

Interactive text should look interactive.

Non-interactive text should not look like a link.

Resolve the fund-name/link inconsistencies documented on:

```text
010
011
```

and contact-style inconsistencies on legal surfaces.

Use the existing gold/underline language where appropriate.

Do not create nested links.

---

# S8 — BUTTON SYSTEM

Resolve:

```text
size ladder mismatch
implicit width behaviour
stacked button height mismatch
disabled-state ambiguity
```

Do not flatten the primary/secondary/danger hierarchy.

---

# S9 — ALERT SYSTEM

Give `Alert` a proper action region.

Do not make callers inject one-off action layout into the alert body.

Keep one consistent alert boundary mechanism.

---

# S10 — LOADING SKELETONS

Loading structure should resemble the loaded result.

Especially fix:

```text
005 funds
```

where desktop currently loads a card grid and then transforms into a table.

Use the same compact/desktop branch to determine both skeleton and loaded structure.

---

# S11 — TOAST

Bring toast presentation into the existing radius/border/elevation system.

Do not make it a new visual language.

Review whether a manual dismiss action is warranted without making persistent state transient.

---

# S12 — DETAILROW EMPHASIS

Add a controlled emphasis option instead of forcing every label/value pair to look identical.

Use this to correct genuine hierarchy inversions.

Do not allow arbitrary caller styling to recreate inconsistency.

---

# S13 — LOADING PLACEHOLDERS

Remove remaining layout-shifting em-dash placeholders identified in the audit.

Use geometry-stable placeholder/skeleton behaviour.

---

# BATCH 4 — NAVIGATION

Use `NAVIGATION_AUDIT.md` and Blueprint N1–N5.

---

# N1 — MOBILE TITLE ARCHITECTURE

Implement the audit's recommended architecture:

> The shell owns navigation chrome; the page owns the title.

Remove the scroll-reveal manifest title from the mobile bar.

The mobile header should primarily provide:

```text
back affordance
notifications affordance
navigation chrome
```

The page's `PageHeader` remains the semantic and visual h1.

Do not create two competing title systems.

---

# N2 — DETAIL TITLES

Once N1 is implemented, do NOT spend effort creating manifest-level generic dynamic titles merely to refill the shell.

The page already owns context.

Keep contextual identity in the content hierarchy.

---

# N3 — BACK MODEL

Current problem:

```text
visibility is derived from route.back.path
click behaviour uses navigate(-1)
```

That is two different navigation models.

Make the chevron honour one model.

Pay particular attention to:

```text
006
011
013
deep links
notification destinations
replace-navigation from transaction flows
```

Do not break the transactional unsaved-entry confirmation logic already implemented.

Add focused navigation tests.

---

# N4 — UNLISTED ROUTE ENTRY POINTS

Do NOT add `/sips` or `/statements` to the five-item bottom navigation.

That remains a product/IA decision.

However, improve the existing entry-point hierarchy where the audit says it is too weak.

Especially:

```text
SIP plans
```

which contains recurring commitments but currently has low-emphasis entry points.

---

# N5 — NOTIFICATION BELL

Use the existing unread count/data to provide a restrained unread indicator on the global bell.

Do not create another notification state machine.

Use the existing notification query.

---

# BATCH 5 — RESPONSIVE / PAGE COMPOSITION

---

# M1 — DASHBOARD

Already handled under P1.

---

# M2 — REDUCE THE TALLEST MOBILE SCREENS

The three tallest composition problems are:

```text
016 Profile
019 Support
008 Start SIP
```

### Profile

Six full elevated cards are being used as menu rows.

Use a lighter settings/list treatment.

A settings hub does not require every navigation entry to be a large elevated card.

### Support

Current screen contains:

```text
support form
ticket history
FAQ
```

in one tall sequence.

The audit found the ordering contradicts the screen's own information hierarchy.

Recompose it without inventing new routes unless necessary.

Prefer allowing answers/help to be discovered before forcing a request form.

### SIP Start

Four stacked Cards create excessive vertical segmentation.

Move toward one cohesive form surface with internal sections/rules rather than multiple elevated containers.

Do not alter SIP logic.

---

# M3 — CONDITIONAL CONTENT SHIFT

Do not let first-input interaction suddenly push the CTA far down the page.

Audit identified:

```text
008 summary card
007 investment summary
019 character counter
```

Reserve space where appropriate or make changing content replace existing content rather than insert a whole new block.

Do not permanently reserve excessive blank space.

---

# D1 — DESKTOP COMPOSITION

Do not render the mobile vertical sequence unchanged across an 1181px content canvas.

Review:

```text
006 fund detail
013 SIP detail
016 profile
019 support
```

Use available width deliberately.

Do not make desktop denser merely because space exists.

Maintain readable line lengths.

---

# D2 — CHRONOLOGICAL LISTS

Notifications should follow the same reading principle as Activity.

A newest-first chronological inbox should not become a 2/3-column newspaper grid on desktop.

Use the proven measured single-column feed treatment.

---

# D3 — FORM WIDTH

560px remains a good form width.

Do not broaden forms merely to fill desktop space.

Review only the routes that are not actually forms.

Especially:

```text
024 Not found
```

Do not use `width="form"` simply because it happens to produce a narrow layout.

---

# BATCH 6 — FINANCIAL HIERARCHY

Do not change money formatting fundamentals.

The audit explicitly found these strengths:

```text
tabular numerals
lining numerals
nowrap
explicit + / - direction
signed tone not colour-only
precision fallback
stable money rows
```

Preserve them.

---

# PORTFOLIO GRID

Handled under P1.

---

# DATA HIERARCHY

Rebalance the inverted hierarchies documented by the audit.

### 011 Payment Status

The state of the payment is the primary answer.

The amount should not visually overpower the status.

### 006 Fund Detail

The client's practical investment decision information should dominate ahead of AUM-style metadata.

### 005 Funds Catalogue

Fund identity should dominate the card/table row, not fund size.

### 017 Verification

Status should read as the headline state rather than a tiny badge beneath larger secondary information.

Use the shared `DetailRow`/emphasis solution rather than arbitrary CSS.

---

# BATCH 7 — PAGE-SPECIFIC P2 FINDINGS

Only after systemic work has settled should you implement remaining page-specific P2 findings.

Read each:

```text
client_ui/<page>/ui_audit.md
```

and determine whether the finding:

```text
was already resolved by a shared fix
still exists
requires a page-specific implementation
```

Do not apply the same fix twice.

Record inherited fixes.

---

# BATCH 8 — P3 POLISH

P3 comes last.

Do not spend time polishing P3 while a P1/P2 defect remains.

Implement P3 findings when they:

```text
improve consistency
remove a systemic ambiguity
improve focus/accessibility
reduce visual noise
```

Do not implement stylistic churn for its own sake.

Respect the audit's existing ACCEPTED findings.

If you choose to reopen an accepted P3:

record exactly why.

---

# SYSTEMBARS / SAFE AREA

The audit found a configured SystemBars integration that is not currently installed/exercised.

Do NOT blindly add a native dependency.

First determine the intended native strategy.

If the configuration is stale:

remove the stale configuration only if doing so is safe.

If the plugin is required for production edge-to-edge behaviour:

install/configure it properly and test it on a notched/cutout emulator.

Document whichever decision was made.

---

# UNVERIFIED ITEMS MUST NOW BE VERIFIED

The audit left three areas explicitly unverified.

They must be handled during implementation verification.

---

## 1. ANDROID KEYBOARD / IME

Use a real Android IME interaction, not CDP focus alone.

Verify at minimum:

```text
/profile/support
/funds/:id/invest/lumpsum
/funds/:id/invest/sip
```

Check:

```text
CTA remains reachable
focused field scrolls into view
bottom navigation does not ride incorrectly over the IME
keyboard does not cover the active control
textarea remains usable
```

---

## 2. REAL SAFE-AREA / NOTCHED DEVICE

Use a disposable notched/cutout AVD where possible.

Verify:

```text
top header
desktop not relevant
mobile bottom navigation
sheets
dialogs
forms
```

against actual non-zero safe-area conditions.

Do not use the maintainer's active device configuration if a disposable AVD can be used.

---

## 3. BLOCKED ACCOUNT SHELL

Do not suspend or close a real account just to test this.

Use:

```text
safe test fixture
mocked session state
isolated test
source-level verification
```

to determine whether terminal-account presentation and shell chrome can collide.

Do not alter real client account state.

---

# VISUAL REGRESSION REQUIREMENTS

The previous content implementation achieved:

```text
0 raw UUID pages
0 snake_case client tokens
0 client-visible architecture terms
0 screens rendering raw error.message
0 horizontal overflow at 390×844
```

These remain non-regression requirements.

UI implementation must not reintroduce them.

---

# RESPONSIVE VERIFICATION

Reuse the existing audit harness.

Do NOT invent a weaker verification method.

Re-run the same relevant geometry sweep.

Reference widths:

```text
360
390
412
480
640
768
900
1023
1024
1280
1440
```

Record at:

```text
top
scrollY ~60
full scroll
```

where appropriate.

Compare before and after.

---

# HARD ACCEPTANCE CRITERIA

Before calling the implementation complete:

```text
P0 remaining = 0

P1:
offline/header interactive overlap = 0
login hover intersection = 0
portfolio money collision at crore-scale = 0
dashboard 768–1023 half-row defect = 0
fund detail primary action hierarchy corrected

horizontal document overflow = 0
at all audited widths

mobile bottom clearance no longer double-counted

refreshing does not shift page content

field family visually coherent

Select invalid state visible

dark navigation focus state visible

destructive dialogs have safe action hierarchy

Sheet/modal keyboard behaviour matches semantics

Tabs/RadioGroup keyboard behaviour matches declared roles

notification feed reading order corrected

mobile title architecture no longer duplicates/reveals generic titles

back navigation model is internally consistent

critical touch targets are usable

keyboard/IME behaviour verified

safe-area behaviour verified on non-zero inset surface where possible
```

---

# TESTING

Run the repository's complete frontend/client quality gate after every major batch where practical and definitely before completion.

At minimum:

```text
npm run typecheck
npx eslint src
npx vitest run
npm run build
node scripts/check-bundle-boots.mjs
node scripts/check-android-dist.mjs
```

Also run the project's existing:

```text
PhonePe guard
client-only Android build checks
```

if present.

For UI interaction changes, add focused tests where regression risk is meaningful.

Good candidates:

```text
Tabs keyboard navigation
RadioGroup keyboard navigation
Sheet focus/Escape behaviour
back navigation contract
form composition
conditional CTA geometry where testable
```

Do not create tests for trivial border-radius changes.

---

# APK VERIFICATION

Build and install the modified client APK.

Use a disposable emulator when possible.

Verify:

```text
authenticated shell
fund catalogue
fund detail
lump-sum form
SIP form
portfolio
activity
payment status
SIP detail
notifications
profile
support
security
legal
```

Do not execute real:

```text
payment
SIP creation
SIP cancellation
mandate action
AutoPay authorisation
```

merely to inspect layout.

Use existing data/state.

---

# SCREENSHOTS

Create post-implementation evidence under:

```text
release_manager/audit_pages/client_ui/implemented/
```

At minimum capture:

```text
390×844
1440×900
```

for each materially changed page.

For breakpoint-specific changes also capture relevant widths such as:

```text
768
900
1023
1024
```

Do not rely on beyond-viewport Android WebView screenshots for measurement.

The previous audit established that WebView full-page tiling can be misleading.

Use screenshots as supporting visual evidence.

Use geometry JSON as authoritative evidence for collision/spacing claims.

---

# UI IMPLEMENTATION TRACKER

For each root-cause finding record:

```text
Finding ID
Severity
Root cause
Implementation
Files changed
Affected routes
Verification method
Before measurement
After measurement
Status
```

Use statuses:

```text
FIXED
FIXED BY SHARED CHANGE
ACCEPTED
BLOCKED
UNVERIFIED
NOT APPLICABLE AFTER REFACTOR
```

Do not mark something FIXED merely because the code looks right.

Measure it where it was originally measured.

---

# PER-PAGE IMPLEMENTATION REPORT

For each page create:

```text
implemented/<page>/implementation.md
```

Use:

```markdown
# UI Implementation Result

## Original UI findings

...

## Shared fixes inherited

...

## Page-specific changes

...

## Interaction changes

...

## Responsive changes

...

## Deliberately unchanged

...

## Files changed

...

## Verification

360:
390:
412:
768:
1023:
1024:
1440:

## Remaining findings
...
```

---

# CHANGE DISCIPLINE

Prefer:

```text
one shared recipe change
```

over:

```text
10 page-specific class overrides
```

Prefer:

```text
existing token
```

over:

```text
magic pixel value
```

Prefer:

```text
existing pattern
```

over:

```text
new visual language
```

Prefer:

```text
measured responsive rule
```

over:

```text
looks fine at 390px
```

---

# NO GLOBAL BLIND REPLACEMENTS

Do not globally replace:

```text
gap
radius
shadow
font size
padding
grid
```

without semantic review.

Many uses are deliberate.

The audit specifically found that the core design system is sound.

The purpose is to eliminate bypasses and ambiguities, not homogenise everything.

---

# DO NOT CHANGE CLIENT COPY DURING THIS PASS

The previous implementation already completed the client-facing content pass.

Do not casually rewrite:

```text
headings
status text
errors
instructions
legal copy
financial terminology
```

to solve visual problems.

If content length reveals a visual defect:

fix the layout/component.

If you believe copy must change for usability:

record it separately instead of silently reopening the completed content audit.

---

# DO NOT CHANGE DOMAIN PRESENTATION MAPPINGS

Keep the existing client presentation boundary intact.

Do not modify mappings such as:

```text
failure.ts
paymentReason.ts
provider.ts
notifications.ts
clientStatus.ts
reference.ts
```

unless a UI change genuinely requires a type/interface adjustment.

Do not alter what internal states mean.

---

# GIT DISCIPLINE

Do not revert unrelated changes.

Do not reset the repository.

Do not clean files you did not create.

Do not claim ownership of existing emulator/ADB resources you did not establish.

At completion:

```text
git diff --stat
git diff -- frontend_stack_ts/src/
git status --short
```

Record the result.

---

# IMPLEMENTATION ORDER

Follow this exact sequence:

```text
0. Preflight / baseline
1. All P1 fixes
2. Re-measure P1
3. Foundation F1–F5
4. Shared Components S1–S13
5. Navigation N1–N5
6. Mobile M1–M3
7. Desktop D1–D3
8. Financial hierarchy $1–$3
9. Remaining page-specific P2
10. P3 systemic polish
11. Unverified device checks
12. Complete 25-route regression sweep
13. Final build / APK verification
14. Implementation summary
```

Do not skip the P1 checkpoint.

---

# FINAL UI IMPLEMENTATION SUMMARY

Create:

```text
release_manager/audit_pages/client_ui/UI_IMPLEMENTATION_SUMMARY.md
```

Include:

```text
Source revision started from
Final revision / working state

Root-cause findings:
P0 fixed / remaining
P1 fixed / remaining
P2 fixed / accepted / remaining
P3 fixed / accepted / remaining

Page-level findings resolved through shared fixes
Page-specific fixes

Before → after measurements:
offline chrome overlap
login form gap/intersection
portfolio money stress
dashboard tablet geometry
bottom-nav dead space
refresh reflow

Responsive sweep:
routes
widths
records
horizontal overflow

Accessibility UI changes:
focus
tabs
radio
sheet/modal
touch targets

Unverified items:
keyboard
safe area
blocked account
and their final disposition

Files modified

Tests run
Build result
APK result

Backend changes
API changes
Database changes
Payment logic changes
SIP/AutoPay logic changes
Auth/eligibility changes
Client-copy changes
```

The final six categories above should normally remain:

```text
none
```

unless explicitly justified.

---

# DEFINITION OF DONE

This UI/UX implementation is finished only when:

1. All 25 routes have been revisited after shared changes.
2. Every P1 has been implemented and measured.
3. Every P2 has a disposition.
4. Shared fixes have been preferred over page patches.
5. No horizontal overflow has been introduced.
6. Crore-scale financial values remain readable.
7. Mobile and desktop both preserve the BeOnEdge visual identity.
8. Keyboard/focus behaviour matches declared component semantics.
9. Android keyboard behaviour has been manually checked where possible.
10. Safe-area behaviour has been checked on a non-zero-inset surface where possible.
11. Content implementation has not regressed.
12. Financial/business logic remains unchanged.
13. Typecheck passes.
14. ESLint passes.
15. Tests pass.
16. Production frontend build passes.
17. Android client checks pass.
18. Post-implementation evidence exists separately from the original audit.
19. UI_IMPLEMENTATION_TRACKER.md is complete.
20. UI_IMPLEMENTATION_SUMMARY.md is complete.

---

# FIRST ACTION

Do NOT start with individual pages.

Begin with:

```text
IMPLEMENTATION_BLUEPRINT.md
    ↓
F1 shell
F2 forms
$1 portfolio money
M1 dashboard breakpoint
006 fund-detail hierarchy
```

Complete and re-measure those production-critical findings first.

Then continue through the root-cause implementation order above.

This phase is for actual implementation.

Do not return another read-only audit.