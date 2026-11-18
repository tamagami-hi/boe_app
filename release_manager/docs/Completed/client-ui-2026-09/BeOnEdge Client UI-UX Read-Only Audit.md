# BeOnEdge Client Application
# READ-ONLY UI / UX / VISUAL DESIGN AUDIT

## PURPOSE

The BeOnEdge client application is approaching production release.

A separate agent is already actively working on:

- client-facing wording
- technical/developer terminology
- state descriptions
- error wording
- raw identifiers
- content quality
- behavioural implementation issues

DO NOT duplicate that work.

This task is exclusively concerned with the **visual and interaction design quality of the client application**.

The goal is to inspect the actual frontend implementation and identify everything that prevents the client application from feeling:

- polished
- professional
- deliberate
- visually coherent
- financially trustworthy
- easy to scan
- easy to operate
- responsive
- mobile-native
- production-ready

This is a **READ-ONLY AUDIT**.

You must NOT implement any fixes.

---

# OUTPUT LOCATION

Create all new UI/UX audit material under:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client_ui
```

Create this directory if required.

Do NOT write UI audit material into:

```text
release_manager/audit_pages/client/
```

That directory contains the earlier content/client-facing audit and must remain untouched.

Recommended structure:

```text
release_manager/
└── audit_pages/
    ├── client/
    │   └── existing content audit
    │
    └── client_ui/
        ├── UI_AUDIT_INDEX.md
        ├── DESIGN_SYSTEM_AUDIT.md
        ├── RESPONSIVE_AUDIT.md
        ├── NAVIGATION_AUDIT.md
        ├── COMPONENT_AUDIT.md
        ├── IMPLEMENTATION_BLUEPRINT.md
        │
        ├── 001_splash/
        │   └── ui_audit.md
        ├── 002_login/
        │   └── ui_audit.md
        ├── 003_verify_email/
        │   └── ui_audit.md
        └── ...
```

Do not overwrite the existing screenshots or extraction reports.

You may reference them.

---

# ABSOLUTE READ-ONLY REQUIREMENT

## DO NOT MODIFY APPLICATION SOURCE

You may inspect everything.

You may change nothing.

Do not:

- edit TS/TSX
- edit CSS
- edit Tailwind classes
- edit themes
- modify components
- change layouts
- change routing
- change text
- adjust breakpoints
- run lint autofix
- run formatting that rewrites files
- update dependencies
- change package files
- modify generated files
- create implementation patches
- commit source changes
- alter APIs
- alter application state
- create real transactions
- create SIPs
- alter AutoPay
- change profile/security configuration

The only files you may CREATE are reports and supporting audit artifacts under:

```text
release_manager/audit_pages/client_ui/
```

---

# APPLICATION SOURCE

Primary client frontend:

```text
frontend_stack_ts/
```

Start by understanding the actual frontend architecture.

Inspect at minimum:

```text
frontend_stack_ts/src/
```

and determine:

- application shell
- route layouts
- page containers
- layout primitives
- card primitives
- form controls
- button primitives
- typography
- spacing tokens
- CSS variables
- theme
- responsive breakpoints
- grid/flex abstractions
- modal/sheet primitives
- navigation
- top bars
- bottom navigation
- tables
- lists
- empty states
- status badges
- alerts
- form layouts
- page headers

Do not inspect only individual screens.

Many visible defects may originate from shared components.

---

# EXISTING AUDIT MATERIAL

Read the existing audit before beginning:

```text
release_manager/audit_pages/client/AUDIT_INDEX.md
release_manager/audit_pages/client/ROUTE_INVENTORY.md
release_manager/audit_pages/client/SHARED_COMPONENTS.md
release_manager/audit_pages/client/IMPLEMENTATION_TRACKER.md
```

Then inspect every existing page directory and screenshot.

The content audit is useful context, but this audit has a different purpose.

Do NOT reopen wording findings unless wording creates a visual/hierarchy issue.

Example:

A paragraph being technically inappropriate belongs to the other audit.

A paragraph occupying 45% of the viewport and destroying the page hierarchy belongs to THIS audit.

---

# IMPORTANT: SOURCE MAY BE CHANGING

Another agent is actively implementing content-related improvements while this audit is being performed.

Therefore:

1. record the git commit / working tree state when this audit begins;
2. do not assume the application remains unchanged during the entire audit;
3. base structural findings primarily on source architecture and the rendered version actually inspected;
4. record timestamps or commit SHA where helpful;
5. never overwrite the other agent's changes.

If source changes during the audit, continue read-only and explicitly state which revision/state each observation came from.

---

# PRIMARY QUESTION

For every screen ask:

> If this were a production investment application used by a real client, does the visual hierarchy immediately tell the client where they are, what matters, and what they should do next?

Then evaluate why or why not.

---

# EXAMPLE OF THE TYPE OF ISSUE TO FIND

The current sign-in screen provides a useful example.

The password input and primary:

```text
Sign in
```

button visually collide.

There is insufficient separation between the final form field and primary CTA.

This may originate from:

- missing vertical gap
- negative margin
- absolute positioning
- fixed-height container
- shared button styles
- shared field wrapper
- CSS specificity
- breakpoint behaviour
- transform
- incorrect line-height
- card layout
- container height assumptions

Do NOT simply report:

```text
Add margin-bottom.
```

Trace the source.

Determine:

```text
which component controls the geometry
which style creates the condition
whether the same primitive affects other screens
whether it occurs only at a breakpoint
whether hit areas actually overlap
whether the issue is visual only or DOM geometry also overlaps
```

Then document the proper implementation direction.

Do not implement it.

---

# AUDIT BOTH GEOMETRY AND PERCEPTION

A visual defect does not have to be literal CSS overlap.

Distinguish:

## Actual geometry collision

Two rendered boxes overlap.

## Perceived collision

Boxes technically do not overlap, but spacing is so small that they appear visually attached.

## Hierarchy collision

Two visual elements compete for equal emphasis.

## Semantic collision

A UI element visually looks clickable when it is not.

## Responsive collision

A layout works at one width but intersects/wraps incorrectly at another.

Use the correct classification.

---

# VIEWPORTS

At minimum analyse:

## Mobile

```text
390 × 844
```

This is a primary target.

Also inspect nearby constrained widths if practical:

```text
360 × 800
375 × 812
390 × 844
412 × 915
```

The purpose is not to create five screenshots per page.

The purpose is to detect fragile breakpoint behaviour.

---

## Desktop

Primary:

```text
1440 × 900
```

Also inspect representative widths where useful:

```text
1024
1280
1440
1920
```

Pay particular attention around the application's existing desktop/mobile breakpoint.

---

# DO NOT AUDIT ONLY TWO STATIC SIZES

Responsive bugs often exist between reference viewports.

Resize gradually and inspect for:

- sudden layout jumps
- overlap
- wrapping
- clipped controls
- disappearing content
- awkward whitespace
- width changes
- table overflow
- navbar collisions
- modal overflow

Identify the width range where a problem begins.

Example:

```text
Issue occurs from approximately 768px–890px.
```

This is much more useful than:

```text
Tablet layout looks bad.
```

---

# PHASE 1 — DESIGN SYSTEM REVERSE ENGINEERING

Before judging individual pages, determine what visual system currently exists.

Create:

```text
DESIGN_SYSTEM_AUDIT.md
```

Analyse:

---

## 1. Colour System

Document:

- background colours
- surface colours
- card colours
- text hierarchy
- border colours
- accent colours
- positive states
- warning states
- destructive states
- disabled states

Determine whether colour usage is systematic or arbitrary.

Do NOT propose a complete brand recolour unless the current system is genuinely incoherent.

---

## 2. Typography

Document:

- font families
- heading styles
- serif/sans usage
- page titles
- section titles
- card titles
- labels
- body text
- captions
- numerical display
- button text

Look for:

- inconsistent sizes
- arbitrary weights
- excessive uppercase
- poor line-height
- awkward wrapping
- overly large paragraphs
- financial figures lacking prominence
- weak label/value distinction

The sign-in page, for example, combines a very large editorial headline with a comparatively large form card.

Analyse whether the resulting hierarchy is intentional or whether the marketing surface overwhelms the task of signing in.

---

## 3. Spacing Scale

Determine whether the application uses a coherent spacing system.

Look for common distances such as:

```text
4
8
12
16
20
24
32
40
48
64
```

or equivalent rem units.

Identify arbitrary values.

Check consistency of:

- label → field
- field → field
- field → CTA
- heading → description
- description → content
- card → card
- section → section
- page edge → content
- bottom navigation → content

Specifically identify cases where insufficient spacing creates perceived or actual overlap.

---

## 4. Border Radius

Inspect:

- cards
- buttons
- inputs
- chips
- badges
- sheets
- modals
- navigation surfaces

Determine whether radius values form a system.

Flag cases where different components appear to belong to different design systems.

---

## 5. Shadows / Elevation

Check:

- whether elevation communicates hierarchy
- whether shadows are excessively heavy
- whether nested shadows create visual noise
- whether floating/sticky components have appropriate separation

---

## 6. Borders

Determine whether borders and shadows are being used inconsistently for the same visual purpose.

---

## 7. Iconography

Audit:

- icon family
- stroke weight
- icon size
- alignment
- text/icon spacing
- filled vs outline inconsistency
- icon-only action discoverability

---

# PHASE 2 — SHARED COMPONENT AUDIT

Create:

```text
COMPONENT_AUDIT.md
```

Trace shared components before page-level analysis.

At minimum inspect:

- Button
- Input
- Select
- Checkbox
- Radio
- Tabs
- StatusBadge
- Alert
- EmptyState
- PageHeader
- Card
- Stat cards
- Money display
- Form group
- Modal
- Sheet
- ConfirmDialog
- LoadMore
- tables
- mobile cards
- navigation components

For every shared component assess:

```text
visual consistency
spacing
minimum size
touch target
states
loading state
disabled state
focus state
error state
responsive behaviour
text wrapping
long-value behaviour
```

---

# FORM COMPONENTS ARE HIGH PRIORITY

The provided sign-in screenshot demonstrates why form primitives deserve specific investigation.

Audit all forms for:

- label spacing
- required-marker placement
- input height
- input padding
- border contrast
- focus treatment
- validation placement
- helper text
- input-to-input spacing
- input-to-button spacing
- button width
- button placement
- keyboard-safe behaviour on mobile
- scroll positioning
- viewport resize when keyboard opens

Look for reusable causes.

If the same form primitive is responsible for defects across:

```text
login
email verification
investment
SIP
support
device security
```

report the shared primitive as the root problem.

Do not prescribe six independent page fixes.

---

# BUTTON HIERARCHY

Catalogue:

- primary
- secondary
- tertiary
- destructive
- link-style
- icon button
- disabled
- loading

Check whether the visual hierarchy actually corresponds to action importance.

Examples to investigate:

```text
two buttons with equal weight despite one being destructive
secondary action visually stronger than primary
CTA touching preceding input
full-width buttons used inconsistently
buttons with different heights on adjacent pages
button text wrapping
```

---

# PHASE 3 — NAVIGATION AUDIT

Create:

```text
NAVIGATION_AUDIT.md
```

Current primary navigation should be analysed as a system.

Inspect:

```text
Home
Funds
Portfolio
Activity
Profile
```

and secondary routes such as:

```text
SIP plans
Statements
Notifications
Support
Legal
Security
Email verification
```

Audit:

- active-state clarity
- selected tab treatment
- icon/text relationship
- bottom-navigation height
- safe-area handling
- content hidden beneath navigation
- back-button logic
- page title placement
- desktop/mobile equivalence
- navigation depth
- orphan-feeling routes
- how users return from detail pages

Do NOT decide that a route must be added to global navigation.

Instead document discoverability and hierarchy.

---

# MOBILE TOP BAR + PAGE HEADER

This deserves its own investigation.

Determine whether the application currently creates:

```text
mobile shell title
+
page-level title
```

on the same viewport.

Assess:

- duplicate titles
- wasted vertical space
- conflicting wording
- excessive hierarchy
- relationship to back button
- relationship to notifications icon

Recommend a single consistent architecture.

For example, the final implementation may ultimately choose:

```text
Shell owns navigation chrome.
Page owns content title.
```

or:

```text
Shell owns page title on mobile.
PageHeader suppresses duplicate h1 on mobile.
```

Do not implement either.

Determine which fits the existing system best.

---

# PHASE 4 — RESPONSIVE AUDIT

Create:

```text
RESPONSIVE_AUDIT.md
```

This is a major part of the task.

For every shared component and page inspect:

### Horizontal overflow

No content should silently exceed the viewport.

### Vertical collision

Especially:

- bottom navigation
- sticky headers
- CTAs
- sheets
- forms
- keyboards

### Text wrapping

Especially:

- currency values
- fund names
- support ticket names
- statuses
- buttons
- tabs

### Layout transformation

If desktop uses a table and mobile uses cards, verify both provide equivalent hierarchy.

### Breakpoint discontinuity

Identify sudden jumps.

### Fixed heights

Find fixed-height containers whose children can exceed them.

### Min/max heights

Check whether they cause:

- clipping
- overlap
- excessive whitespace

### Absolute positioning

Audit every important use of:

```css
position: absolute
position: fixed
position: sticky
```

for responsive consequences.

---

# PHASE 5 — PAGE GEOMETRY

For every route generate:

```text
<page>/ui_audit.md
```

Use the following structure.

---

# Page: <name>

## Route

```text
...
```

## Source

```text
...
```

## Components involved

```text
...
```

---

## 1. Visual hierarchy

Describe what the eye sees in order.

Example:

```text
1. oversized marketing headline
2. explanatory copy
3. feature bullets
4. sign-in card
5. investment disclaimer
```

Then evaluate whether that hierarchy matches the user's task.

---

## 2. Layout structure

Document the actual layout:

```text
container
max width
grid
columns
flex direction
gap
padding
alignment
```

Where possible identify the controlling source classes/styles.

---

## 3. Spacing

Report inconsistent or problematic spacing.

Give approximate rendered measurements where useful.

Example:

```text
Password input → primary CTA:
approximately 0–4 px perceived separation.

Recommended relationship:
should use the form's standard field-to-action spacing rather
than an isolated page-specific offset.
```

Do NOT implement it.

---

## 4. Alignment

Inspect:

- left edges
- baselines
- card edges
- headings
- form controls
- metrics
- labels
- icons

Flag small but visible alignment drift.

---

## 5. Overlap / collision

Classify each as:

```text
ACTUAL OVERLAP
PERCEIVED COLLISION
POTENTIAL RESPONSIVE COLLISION
NO COLLISION
```

Record:

```text
elements
viewport
bounding behaviour
suspected controlling source
severity
```

---

## 6. Density

Classify:

```text
too sparse
balanced
too dense
```

by section, not just page.

Financial applications need enough whitespace to feel controlled but should not require unnecessary scrolling.

---

## 7. Card hierarchy

Determine whether cards have meaningful hierarchy.

Look for:

- too many cards
- card-inside-card patterns
- every section boxed
- excessive borders
- inconsistent padding
- cards with little semantic purpose
- primary and secondary cards looking identical

---

## 8. Data hierarchy

For money-oriented pages inspect whether the order is sensible visually.

Typically important information may include:

```text
fund
amount
status
value
return
date
next action
```

Do not change the business meaning.

Judge visual prominence.

---

## 9. CTA hierarchy

Identify:

```text
primary action
secondary action
destructive action
navigation action
```

Assess whether visual treatment matches importance.

---

## 10. Interaction affordance

Find:

- clickable text that doesn't look clickable
- non-clickable text that looks like a link
- tiny click targets
- ambiguous rows
- cards that appear tappable but aren't
- icon buttons without sufficient indication
- disabled elements that resemble enabled ones

---

## 11. Mobile assessment

Specifically document:

```text
390 × 844
```

Include:

- first viewport
- scroll burden
- nav interaction
- CTA accessibility
- safe area
- keyboard risk
- sticky/fixed elements
- clipping
- overlap

---

## 12. Desktop assessment

Specifically document:

```text
1440 × 900
```

Include:

- max-width use
- information density
- unused space
- column balance
- card width
- form width
- visual centre of gravity

---

## 13. Accessibility-related visual issues

This is not a full accessibility compliance audit.

Flag visible issues such as:

- low contrast
- tiny text
- focus treatment missing
- colour-only distinction
- overly small targets
- poor form error placement
- text clipped at zoom
- horizontal scrolling

---

## 14. Root cause

Where possible identify whether the problem originates from:

```text
PAGE
SHARED COMPONENT
SHELL
GLOBAL CSS
DESIGN TOKEN
BREAKPOINT
CONTENT LENGTH
```

This field is extremely important.

---

## 15. Recommended design direction

Give implementation guidance without editing code.

For example:

```text
Move form spacing responsibility into the shared FormField/FormStack
rather than applying page-specific margins.
```

Good.

Avoid:

```text
Change line 73 to mt-6.
```

unless exact source evidence makes that necessary to explain the issue.

The implementation agent should have room to implement cleanly.

---

## 16. Severity

Use:

### P0 — Blocking

Breaks use of the interface.

Examples:

- CTA inaccessible
- content hidden
- genuine overlap preventing input/action
- navigation blocks content

### P1 — Production-critical

Visibly broken or significantly harms trust.

Examples:

- form elements collide
- major responsive break
- unreadable amounts
- contradictory interaction affordance

### P2 — Important polish

Makes the application feel inconsistent or unfinished.

### P3 — Minor polish

Small visual improvements.

---

# PHASE 6 — OVERLAP DETECTION

Perform a dedicated geometry pass.

This is important.

Where browser automation permits, collect bounding rectangles for major interactive elements.

At minimum consider:

```javascript
element.getBoundingClientRect()
```

for:

- inputs
- buttons
- cards
- nav bars
- headers
- alerts
- sheets
- fixed elements

Detect intersecting rectangles among elements that should not overlap.

Do not automatically treat intentional overlay components as defects.

Exclude intentional:

```text
modal overlays
sheets
dropdowns
tooltips
```

from generic collision checks.

---

# ALSO CHECK NEAR-COLLISIONS

Literal box intersection is not enough.

Flag vertical gaps below approximately a reasonable design-system minimum where visually problematic.

Examples:

```text
input → input
input → CTA
CTA → explanatory text
card → card
heading → card
```

The goal is visual rhythm, not merely mathematically non-overlapping rectangles.

---

# PHASE 7 — CONTENT LENGTH STRESS TEST

Without changing source data, inspect components with realistic long values where existing data already provides them.

Pay special attention to:

- long fund names
- ₹ values
- percentages
- payment statuses
- support titles
- notification text
- email address
- user name
- legal headings

Identify components likely to fail when strings are longer than the captured example.

Do not invent data into production storage.

Temporary browser-side inspection is acceptable if it does not alter source or persisted data.

---

# PHASE 8 — FINANCIAL NUMBERS

Financial values deserve dedicated visual inspection.

Check:

- alignment
- font weight
- tabular number behaviour if used
- ₹ symbol spacing
- negative numbers
- large crore/lakh values
- percentage signs
- decimal consistency
- wrapping
- truncated values

A value such as:

```text
₹1,25,00,000
```

must not unexpectedly wrap in an important summary card.

---

# PHASE 9 — EMPTY / LOADING / ERROR STATES

Analyse their visual composition separately.

Look at:

```text
empty
loading
refreshing
error
offline
disabled
locked
unverified
no holdings
no payments
no SIP
```

Ask whether the page maintains its structure when data disappears.

Common defect:

```text
section heading
large empty blank region
next section
```

instead of a deliberate empty state.

This is a UI finding even if the content itself is handled elsewhere.

---

# PHASE 10 — MODALS / SHEETS

Audit:

- width
- max-height
- scrolling
- bottom safe area
- title hierarchy
- action hierarchy
- destructive-action separation
- backdrop
- close behaviour
- mobile fit

Pay particular attention to SIP and device-security confirmation surfaces.

Do not execute destructive actions.

Source inspection is sufficient where safe rendering is impossible.

---

# PHASE 11 — DESIGN CONSISTENCY MATRIX

Create a matrix in:

```text
DESIGN_SYSTEM_AUDIT.md
```

Example:

| Component | Dashboard | Funds | Portfolio | Activity | Profile | Consistent? |
|---|---|---|---|---|---|---|
| Page header | ... | ... | ... | ... | ... | |
| Primary card radius | | | | | | |
| Section gap | | | | | | |
| CTA height | | | | | | |
| Empty state | | | | | | |

The point is to identify systemic inconsistency instead of producing 25 isolated observations.

---

# PHASE 12 — PAGE COMPOSITION

Look beyond CSS defects.

Assess whether each page is composed correctly.

Examples of composition problems:

```text
the least important card is first
primary action appears below several informational panels
critical amount receives less emphasis than metadata
page starts with an essay before the useful controls
too many sections compete at the same level
primary card visually identical to utility cards
```

This is one of the most valuable parts of this audit.

---

# SIGN-IN SCREEN — SPECIFIC EXAMPLE

Use the provided/current sign-in page as a reference for the depth expected.

Analyse:

### Overall composition

The page currently contains:

```text
Client Access
large editorial investment message
descriptive paragraph
three feature points
sign-in card
investment disclaimer
```

The audit should determine whether the sign-in action receives sufficient priority relative to the marketing content.

### Form geometry

Investigate:

```text
Email label
Email input
Password label
Password input
Sign in CTA
```

The current captured layout shows the primary CTA visually colliding with the password input.

Determine whether this is caused by:

```text
shared form spacing
button margin
input margin
container gap
positioning
fixed card dimensions
responsive styling
```

### Card

Analyse:

- card padding
- radius
- outer shadow
- width
- relation to viewport
- distance from surrounding content
- whether the strong border/shadow combination is excessive
- whether form density is balanced

### Mobile fold

Analyse whether a user opening the application primarily to sign in must consume too much vertical marketing content before reaching the form.

Do not assume it is wrong.

Evaluate it.

This is the level of analysis expected for all major routes.

---

# PHASE 13 — INFORMATION HIERARCHY GROUPS

Classify page content into:

```text
PRIMARY
SECONDARY
SUPPORTING
METADATA
ACTION
STATUS
```

Then determine whether the visual styling reflects that classification.

For example:

A UUID-style reference should never visually compete with:

```text
₹ amount
payment state
fund
```

even if another agent is already changing its wording.

This audit is about visual priority.

---

# PHASE 14 — GLOBAL LAYOUT SYSTEM

Determine whether the application has or needs a coherent page shell.

Identify common page geometry such as:

```text
desktop content max width
mobile horizontal padding
desktop horizontal padding
section spacing
header spacing
card gap
form gap
bottom nav clearance
```

Report current values and inconsistencies.

Do not invent a completely unrelated new layout system.

Prefer rationalising what already exists.

---

# PHASE 15 — SAFE AREAS AND APK

The Android APK is an important client surface.

Inspect use of:

```css
env(safe-area-inset-top)
env(safe-area-inset-bottom)
```

or equivalent native handling.

Verify that:

- top bar avoids status/notch area
- bottom navigation avoids gesture area
- sheets avoid gesture area
- CTA is not hidden by keyboard/nav
- scrolling content has bottom clearance

---

# PHASE 16 — SCROLL BEHAVIOUR

Inspect:

- nested scroll areas
- sticky elements
- body scrolling
- horizontal scroll
- scroll restoration
- fixed CTA
- fixed bottom navigation
- long card behaviour

Flag pages where the user can accidentally scroll one container while expecting another.

---

# PHASE 17 — FINAL IMPLEMENTATION BLUEPRINT

After all page audits, create:

```text
IMPLEMENTATION_BLUEPRINT.md
```

This is the most important output.

Do NOT organise it simply as 169 individual changes.

Group recommendations by root cause.

Recommended structure:

# 1. Foundation

Examples:

```text
spacing tokens
page shell
content widths
section rhythm
typography hierarchy
```

# 2. Shared Components

Examples:

```text
forms
buttons
cards
alerts
tabs
tables
badges
```

# 3. Navigation

# 4. Mobile Layout

# 5. Desktop Layout

# 6. Financial Data Presentation

# 7. Page-specific exceptions

---

# PRIORITISE SYSTEMIC FIXES

Example:

Bad implementation plan:

```text
Login: add margin
Support: add margin
SIP: add margin
Investment: add margin
```

Preferred analysis:

```text
Root cause:
shared form stack does not establish spacing between its final field
and following action group.

Affected:
002
003
007
008
019

Recommended implementation:
make field-to-action spacing part of the shared form composition.
```

This allows the implementation agent to fix the system once.

---

# PRIORITY TABLE

Finish `IMPLEMENTATION_BLUEPRINT.md` with:

| Priority | System/Page | Problem | Root Cause | Affected Routes | Recommended Direction |
|---|---|---|---|---|---|

Order:

```text
P0
P1
P2
P3
```

---

# UI_AUDIT_INDEX.md

Create:

```text
release_manager/audit_pages/client_ui/UI_AUDIT_INDEX.md
```

Include:

```text
Git revision inspected
Audit start time
Audit end time
Routes inspected
Mobile viewports inspected
Desktop viewports inspected
Total P0 findings
Total P1 findings
Total P2 findings
Total P3 findings
Shared-component findings
Page-specific findings
Responsive findings
Accessibility-related visual findings
```

Then provide a page table:

| ID | Page | Layout | Responsive | Hierarchy | Interaction | Severity |
|---|---|---|---|---|---|---|

---

# SCREENSHOT ANNOTATION

You may create copies or annotated versions of screenshots under:

```text
client_ui/
```

Do not modify the baseline screenshots under:

```text
client/
```

If annotation is useful, use clear markers such as:

```text
UI-002-01
UI-002-02
```

and reference those IDs in `ui_audit.md`.

Do not create hundreds of annotations unnecessarily.

Use them for geometry/hierarchy issues that benefit from visual evidence.

---

# DO NOT AUDIT CONTENT TWICE

Another agent handles wording.

Examples:

### Do not spend time on:

```text
"append-only ledger" sounds technical
```

unless the amount/placement of that text causes hierarchy problems.

### Do analyse:

```text
this 120-word paragraph occupies half of the first mobile viewport
and pushes the only action below the fold
```

That is a layout/hierarchy problem.

---

# DO NOT REDESIGN FROM PERSONAL TASTE

Every recommendation must have a reason grounded in at least one of:

```text
usability
hierarchy
consistency
responsive robustness
touch ergonomics
readability
interaction affordance
accessibility
financial information priority
existing design-system consistency
```

Avoid recommendations such as:

```text
make it more modern
use glassmorphism
add gradients
make everything rounded
change the entire font
```

without an actual usability/design-system reason.

---

# DO NOT TURN IT INTO A GENERIC BANKING APP

BeOnEdge already has a visual identity.

Preserve and strengthen it.

The purpose is not to clone:

```text
Groww
Zerodha
INDmoney
ET Money
Paytm Money
```

You may mentally use production financial applications as a quality benchmark, but do not copy their visual systems.

---

# NO IMPLEMENTATION

At the end of this task:

DO NOT:

```text
apply patches
fix CSS
modify components
change JSX
change classes
commit
```

Your deliverable is the design analysis and implementation blueprint.

---

# FINAL RESPONSE

When finished, return only a concise summary containing:

```text
Routes audited:
Shared components audited:
P0 findings:
P1 findings:
P2 findings:
P3 findings:
Responsive issues:
Shared/root-cause issues:
Page-specific issues:

UI audit index:
release_manager/audit_pages/client_ui/UI_AUDIT_INDEX.md

Design system report:
release_manager/audit_pages/client_ui/DESIGN_SYSTEM_AUDIT.md

Responsive report:
release_manager/audit_pages/client_ui/RESPONSIVE_AUDIT.md

Navigation report:
release_manager/audit_pages/client_ui/NAVIGATION_AUDIT.md

Component report:
release_manager/audit_pages/client_ui/COMPONENT_AUDIT.md

Implementation blueprint:
release_manager/audit_pages/client_ui/IMPLEMENTATION_BLUEPRINT.md
```

End with:

```text
No application source files were modified during this UI/UX audit.
```

---

# FIRST ACTION

Begin by reading:

```text
release_manager/audit_pages/client/AUDIT_INDEX.md
release_manager/audit_pages/client/ROUTE_INVENTORY.md
release_manager/audit_pages/client/SHARED_COMPONENTS.md
release_manager/audit_pages/client/IMPLEMENTATION_TRACKER.md
```

Then map the visual architecture of:

```text
frontend_stack_ts/
```

before auditing individual pages.

The first technical investigation should specifically determine the shared layout/form cause of the current sign-in field-to-CTA collision.

After understanding the shared design system, perform the complete 25-route UI/UX audit and write all findings to:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client_ui
```

This is analysis only.

Do not implement anything.