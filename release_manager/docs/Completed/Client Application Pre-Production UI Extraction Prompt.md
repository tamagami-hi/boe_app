# CLIENT APPLICATION — PRE-PRODUCTION UI / CONTENT EXTRACTION

## OBJECTIVE

We are nearing the production release of the **BeOnEdge client application**.

Before making any UI, UX, wording, layout, styling, or functional changes, perform a complete **extraction and documentation pass of the current client-facing frontend**.

The purpose of this task is to capture exactly what the client currently sees so that a separate page-by-page production UI/content audit can be performed afterward.

A major concern is that some pages currently contain text, explanations, status messages, context, terminology, diagnostics, or UI elements that make the application feel like it was created for developers or by an AI rather than as a polished client-facing financial application.

DO NOT attempt to fix those problems during this task.

This task is **EXTRACTION ONLY**.

---

# STRICT RULE

## DO NOT MODIFY THE APPLICATION

During this task:

- Do not redesign anything.
- Do not rewrite text.
- Do not rename buttons.
- Do not remove developer-looking content.
- Do not change styles.
- Do not change layouts.
- Do not change APIs.
- Do not change frontend logic.
- Do not change backend logic.
- Do not change routes.
- Do not refactor code.
- Do not remove stale code.
- Do not fix bugs unless a bug completely prevents the extraction process.
- Do not make "small improvements".
- Do not make assumptions about what should eventually be changed.

The application must remain functionally and visually unchanged.

The goal is to produce a **snapshot of the current client application**.

---

# OUTPUT DIRECTORY

Save all extraction artifacts under:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client
```

Create the directory if it does not already exist.

Recommended structure:

```text
release_manager/
└── audit_pages/
    └── client/
        ├── AUDIT_INDEX.md
        ├── ROUTE_INVENTORY.md
        │
        ├── 001_landing/
        │   ├── page.md
        │   ├── desktop.png
        │   └── mobile.png
        │
        ├── 002_login/
        │   ├── page.md
        │   ├── desktop.png
        │   └── mobile.png
        │
        ├── 003_dashboard/
        │   ├── page.md
        │   ├── desktop.png
        │   └── mobile.png
        │
        └── ...
```

Use deterministic numbered folders so pages can easily be audited in sequence.

Example:

```text
001_landing
002_login
003_email_verification
004_dashboard
005_explore
006_fund_details
007_investments
```

Do not combine unrelated pages into one report.

---

# PHASE 1 — DISCOVER THE COMPLETE CLIENT APPLICATION

First inspect the frontend source and determine every route/page that belongs to the **client application**.

Do not include the admin application.

Search the frontend comprehensively, including:

- route definitions
- page components
- layouts
- nested layouts
- redirects
- authenticated routes
- unauthenticated routes
- onboarding
- account creation
- login
- email OTP verification
- dashboard
- Explore
- fund pools
- investments
- payments
- one-time investments
- SIP
- AutoPay
- mandates
- profile
- settings
- transaction/history pages
- support/help pages
- notifications
- legal/information pages
- error pages
- empty-state pages
- success pages
- failure pages
- payment status pages
- callback result pages
- any client-facing page reachable from navigation
- client-facing pages not currently linked in navigation
- dynamically generated routes
- parameterized routes
- routes requiring IDs
- pages rendered conditionally based on user/account/investment state

Inspect both routing code and navigation components.

Do not assume the visible sidebar/navigation contains every page.

---

# PHASE 2 — CREATE ROUTE INVENTORY

Create:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client/ROUTE_INVENTORY.md
```

For every discovered client route record:

```markdown
# Client Route Inventory

| # | Route | Page | Source | Auth Required | Dynamic | Reachable From UI | Screenshot |
|---|---|---|---|---|---|---|---|
| 001 | / | Landing | ... | No | No | Yes | Captured |
| 002 | /login | Login | ... | No | No | Yes | Captured |
| 003 | /dashboard | Dashboard | ... | Yes | No | Yes | Captured |
```

Also record routes that were discovered but could not successfully be rendered.

Do not silently omit them.

Use:

```text
Captured
Partially Captured
Unable to Render
Requires Data
Requires Authentication
Requires Specific State
```

where appropriate.

---

# PHASE 3 — RENDER EVERY PAGE

Run the client application using the appropriate development/local environment without modifying application behavior.

Use the actual application wherever possible.

Render every discovered client page.

If authentication is required, use the existing development/test authentication method already present in the repository/environment.

Do not introduce authentication bypasses into production source code.

If necessary for extraction, temporary browser/session state may be used without committing application changes.

---

# PHASE 4 — SCREENSHOTS

Take screenshots of every client-facing page.

At minimum capture:

## Desktop

Use a normal desktop viewport approximately:

```text
1440x900
```

## Mobile

Use a representative smartphone viewport approximately:

```text
390x844
```

The application supports smartphone/client usage, therefore both layouts are important for the production audit.

If a page is significantly longer than one viewport:

### Capture a FULL-PAGE screenshot

Do not capture only the first screen.

The screenshot should contain the entire vertically scrollable page whenever technically possible.

Save screenshots inside that page's folder:

```text
desktop.png
mobile.png
```

Example:

```text
client/014_fund_details/desktop.png
client/014_fund_details/mobile.png
```

If the same page has important UI states that substantially change its content, capture those separately.

Example:

```text
desktop_default.png
desktop_empty.png
desktop_error.png
desktop_success.png

mobile_default.png
mobile_empty.png
mobile_error.png
mobile_success.png
```

Do not generate unnecessary screenshots for trivial hover states.

---

# PHASE 5 — EXTRACT THE PAGE CONTENT

For every page create:

```text
page.md
```

The Markdown report must describe what CURRENTLY exists.

It must NOT contain proposed fixes.

Use this structure.

---

# Page: <Human Readable Page Name>

## Identification

```text
Audit ID:
Route:
Dynamic Route:
Authentication Required:
Frontend Source:
Layout Source:
Primary Component:
Screenshot Desktop:
Screenshot Mobile:
```

---

## 1. Purpose In Current Application

Describe what this page currently appears to do based strictly on the implementation.

Do not describe what you think it SHOULD do.

---

## 2. Complete Visible Text

Extract all user-visible textual content currently rendered by the page.

Include:

- headings
- subheadings
- paragraphs
- descriptions
- notices
- informational text
- contextual explanations
- warnings
- helper text
- placeholders
- card descriptions
- tooltips where identifiable
- badges
- table headings
- labels
- status messages
- empty-state text
- loading messages
- error messages
- success messages
- toast content
- modal content
- dialog content
- button labels
- navigation labels
- footer text
- developer/debug-looking messages
- API-related terminology exposed to the client
- implementation-oriented terminology
- internal process descriptions
- generated-looking explanatory text

Preserve the current wording.

Do not rewrite it.

---

## 3. Buttons / Actions

Record every visible action.

Example:

| Element | Label | Action | Destination / Handler |
|---|---|---|---|
| Button | Invest Now | ... | ... |
| Link | View Details | ... | ... |

---

## 4. Page Sections

Record the page structure in display order.

Example:

```text
1. Header
2. Portfolio Summary
3. Investment Performance
4. Current Investments
5. Transaction History
6. Footer
```

For each section briefly describe the contents.

---

## 5. Cards / Panels / Widgets

List every major visible UI component and its content.

Example:

```text
Portfolio Overview Card
- Total Investment
- Current Value
- Returns
- Percentage Return
```

---

## 6. Forms

If the page contains a form, extract:

- field name
- displayed label
- placeholder
- default value
- input type
- validation text
- helper text
- required/optional status
- submit button
- cancel/back actions

---

## 7. Tables / Lists

Document:

- heading
- column labels
- list item structure
- filters
- sorting controls
- pagination
- empty-state wording
- row actions

---

## 8. Modals / Dialogs / Drawers

Document every modal/dialog associated with the page.

Include:

- trigger
- title
- body text
- fields
- buttons
- warnings
- success/error messages

If possible capture screenshots for important dialogs.

---

## 9. Conditional UI States

Inspect the source and record major states such as:

```text
loading
empty
populated
pending
approved
rejected
failed
success
payment pending
payment successful
payment failed
mandate pending
mandate active
SIP active
SIP paused
authentication missing
verification required
```

For each state record the text and UI shown.

This information is important even if every state cannot easily be reproduced in the browser.

---

## 10. Navigation

Record:

### Arrives From

Pages/buttons/navigation that can lead to this page.

### Links To

All routes/actions that can be initiated from this page.

---

## 11. Data Displayed

Record the data categories shown to clients.

Example:

```text
Investor name
Fund name
Investment amount
Current value
Return percentage
Transaction ID
Payment status
SIP amount
Mandate status
```

Do not expose secret values in the report.

---

## 12. Frontend Data Dependencies

Record the APIs/hooks/services/stores that supply the page.

Example:

```text
Hook:
Service:
API endpoint:
Store:
Context:
```

This is for traceability only.

DO NOT include credentials, tokens, secrets, passwords, private keys, or sensitive environment values.

---

## 13. Developer / Internal Terminology Present

This section is particularly important.

Extract any content currently visible to a normal client that appears implementation-oriented or developer-oriented.

Examples include terminology relating to:

- API
- endpoint
- backend
- worker
- callback
- webhook
- provider event
- internal ID
- database
- schema
- job
- queue
- synchronization
- polling
- HTTP status
- service
- payload
- state machine
- internal process
- technical diagnostics
- raw exceptions
- debugging messages
- architecture explanations
- unnecessarily technical context
- placeholder explanations
- AI-like explanatory wording

DO NOT correct it.

Simply quote/reference what exists and where it appears.

---

## 14. Potentially Client-Inappropriate Content

Flag content that may require later review because it appears:

```text
developer-oriented
internal-facing
placeholder-like
AI-generated-looking
overly explanatory
too technical
debug-related
administrative rather than client-facing
duplicated
confusing
unfinished
```

Do not suggest replacement wording.

Example:

```markdown
### Flag C-01

Location:
Current text:
Reason flagged: Internal implementation terminology exposed to client.

### Flag C-02

Location:
Current text:
Reason flagged: Extremely long explanatory text that reads like internal documentation.
```

This is classification only.

NO IMPLEMENTATION.

---

## 15. Visual Observations

Record obvious current UI characteristics without proposing changes.

For example:

```text
Large unused empty area below card.
Three different button styles visible.
Heading alignment differs from surrounding sections.
Text wraps outside card on mobile.
Developer-status panel visible.
Long technical explanation dominates top half of page.
```

Again:

### OBSERVE ONLY.

Do not modify anything.

---

## 16. Source References

Record the important source files involved in this page.

Example:

```text
frontend_stack_ts/app/...
frontend_stack_ts/components/...
frontend_stack_ts/lib/...
frontend_stack_ts/hooks/...
```

Include line references where useful.

---

# PHASE 6 — COMPONENT-LEVEL CONTENT

Some text may originate from shared components rather than the page file.

Examples:

```text
Navbar
Bottom navigation
Sidebar
Header
Footer
Investment cards
Payment cards
Notification banners
Error components
Empty-state components
Confirmation dialogs
```

Do not miss this content.

When documenting a page, include shared content that is actually visible on that page.

If the same shared component appears everywhere, document its source and indicate that it is shared.

---

# PHASE 7 — DYNAMIC / PARAMETERIZED PAGES

For routes such as:

```text
/funds/[id]
/investment/[id]
/transactions/[id]
```

capture at least one valid representative instance if test/dev data exists.

Document the route as the parameterized route, not only the concrete ID.

Example:

```text
Route: /funds/[id]

Captured example:
/funds/8cf...
```

Do not place sensitive IDs unnecessarily into screenshots/reports if they contain real client information.

---

# PHASE 8 — APPLICATION STATES

Where practical, include screenshots/content documentation for materially different client experiences.

Prioritize:

```text
no investments
active investments
no transactions
pending transaction
successful transaction
failed transaction
SIP inactive
SIP active
AutoPay/mandate pending
AutoPay/mandate active
email verification required
account pending
loading
API error
```

However:

Do not modify production data merely to manufacture every possible state.

Source-code documentation is sufficient for states that cannot safely be reproduced.

---

# PHASE 9 — AUDIT INDEX

Finally create:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client/AUDIT_INDEX.md
```

It should summarize the entire extraction.

Use a table similar to:

| ID | Page | Route | Desktop | Mobile | MD Report | Flags | Status |
|---|---|---|---|---|---|---:|---|
| 001 | Landing | / | Yes | Yes | Yes | 3 | Complete |
| 002 | Login | /login | Yes | Yes | Yes | 1 | Complete |
| 003 | Dashboard | /dashboard | Yes | Yes | Yes | 7 | Complete |

Then include:

```markdown
## Summary

Total client routes discovered:
Total pages rendered:
Total desktop screenshots:
Total mobile screenshots:
Total reports generated:
Unable to render:
Pages requiring specific data:
Total potentially client-inappropriate content flags:
```

---

# PHASE 10 — EXTRACTION COMPLETENESS CHECK

Before finishing, compare:

1. filesystem routing
2. explicit router configuration
3. navigation items
4. links
5. redirect destinations
6. buttons containing route changes
7. dynamically generated routes
8. layouts
9. authenticated routes
10. frontend API-driven screens

Make sure pages have not been missed simply because they are not linked from the primary navigation.

Search the source for route-related constructs such as appropriate equivalents of:

```text
router.push
router.replace
<Link>
href=
redirect
navigate
window.location
```

and any framework-specific routing mechanisms used by this repository.

---

# SCREENSHOT REQUIREMENTS

Screenshots must represent the actual application.

Do not:

- reconstruct the screen manually
- create mock screenshots
- generate synthetic screenshots
- replace dynamic values with invented values
- crop screenshots in a way that hides page content

Prefer browser automation such as Playwright or the existing testing/browser tooling already present in the repository.

Reuse existing tooling where practical rather than installing a large unnecessary new stack.

---

# PRIVACY / SECURITY

If development data contains:

- passwords
- access tokens
- session tokens
- API keys
- bank account information
- authentication secrets
- private credentials

do not write those values into Markdown files.

Screenshots should also avoid unnecessarily exposing genuine secret credentials.

Ordinary client-facing demo/test data is acceptable.

---

# VERY IMPORTANT: NO IMPLEMENTATION YET

The reports may identify content that appears inappropriate for the final client application.

Do not act on those findings.

This task ends after the current state has been:

1. discovered
2. rendered
3. screenshotted
4. extracted
5. documented
6. indexed

A separate audit will determine what should be:

- rewritten
- shortened
- removed
- redesigned
- reorganized
- renamed
- visually improved
- functionally changed

Do not begin that phase.

---

# EXPECTED FINAL RESULT

The following directory should become a complete visual and textual representation of the current client frontend:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/audit_pages/client
```

For every client page I should be able to open its folder and immediately see:

```text
page.md
desktop.png
mobile.png
```

plus additional screenshots where materially different page states exist.

The Markdown file must be sufficiently detailed that another engineer or AI agent can understand the current page without needing to rediscover its implementation.

The screenshots must allow us to visually inspect exactly what the client currently experiences.

---

# FINAL RESPONSE

When finished, DO NOT provide a redesign proposal.

Return only a concise extraction report containing:

```text
Total client routes discovered
Total pages successfully rendered
Total page Markdown reports generated
Total desktop screenshots
Total mobile screenshots
Total additional state screenshots
Total client-inappropriate-content flags
Pages unable to render
Location of AUDIT_INDEX.md
Location of ROUTE_INVENTORY.md
Whether any source files were modified
```

For the final line explicitly confirm:

```text
No client UI/content implementation changes were made during this extraction phase.
```