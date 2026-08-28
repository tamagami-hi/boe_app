# BOE Application — Full Architecture Discovery, Legacy Cleanup & TypeScript Frontend Redesign

## Primary Objective

Perform a **complete forensic investigation of the current BOE application repository** and produce an implementation-ready architectural plan for rebuilding the frontend cleanly in TypeScript while preserving the backend functionality that is actually in use.

The current application works, but it has evolved through many development iterations. Features have repeatedly been:

* added;
* modified;
* replaced;
* redesigned;
* partially migrated;
* removed from the product;

while portions of their old code often remained in the repository.

As a result, the current codebase contains architectural complexity, stale implementations, inconsistent frontend structures, potentially broken or duplicated routes/API integrations, and inconsistent responsive layouts.

The goal is **not to redesign on top of the existing frontend mess**.

The goal is to first determine precisely what the application currently does, identify the canonical backend contracts and active product features, and then define a **fresh, clean TypeScript frontend architecture** that implements only the functionality the product actually needs.

This phase should leave behind detailed Markdown documentation that another implementation agent—or I—can immediately use to perform the migration and redesign systematically.

---

# Repository Context

Repository root:

```text
/home/nethunter07/PROJECTS/boe_app
```

There is already an ongoing/partially completed complexity-reduction effort.

Existing investigation and simplification documentation is located at:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/docs/complexity-audit-2026-08-26
```

You must inspect this documentation before designing the new frontend.

Also inspect:

* recent work logs;
* recent agent-generated reports;
* Git status;
* recent commits;
* uncommitted work;
* migration work currently in progress;
* architecture notes;
* TODO documents;
* release-manager documentation;
* any implementation plans produced during the recent simplification effort.

Do not assume that all of those documents are correct or complete.

Use them as historical evidence and verify important conclusions against the actual source code.

---

# Current Technology Direction

## Backend

The backend is already implemented in **TypeScript**.

The backend is not being rewritten merely because the frontend is being redesigned.

The investigation should determine:

* which backend architecture is canonical;
* which API endpoints are actually used;
* which services are active;
* which database structures are active;
* which backend code is stale;
* which old backend functionality can eventually be removed;
* whether any backend changes are required to provide a clean contract to the new frontend.

The desired end state is not:

```text
new frontend
+
old messy backend
```

It is:

```text
clean TypeScript frontend
        ↓
clean canonical API contract
        ↓
existing TypeScript backend
        ↓
only active backend logic
        ↓
PostgreSQL / Redis / external providers
```

The backend should remain functionally stable while unnecessary remnants are identified and eventually removed safely.

---

# Current Frontend

The existing frontend is primarily written in:

```text
JavaScript
JSX
```

The new frontend should be written in:

```text
TypeScript
TSX
```

Do **not** simply perform a mechanical:

```text
.js  → .ts
.jsx → .tsx
```

conversion.

The purpose of this effort is to create a **new clean frontend architecture**, not merely type the existing legacy implementation.

The existing frontend should be treated primarily as:

* behavior reference;
* feature reference;
* API usage reference;
* business-flow reference;
* asset/source reference where appropriate.

Do not automatically preserve its structural decisions.

---

# Core Frontend Goal

Build a frontend architecture that is:

* fully TypeScript;
* modern;
* clean;
* consistent;
* maintainable;
* responsive;
* strongly typed;
* route-safe;
* API-contract-safe;
* reusable without becoming over-abstracted;
* appropriate for browser usage;
* appropriate for Android APK usage;
* visually consistent across screen sizes;
* free from obsolete feature remnants.

The resulting application should feel like a properly designed product rather than a collection of web pages accumulated through repeated iterations.

---

# Product Architecture That Must Be Preserved

The architecture investigation must treat the following capabilities as active product requirements unless repository evidence shows that a specific implementation is obsolete.

---

## 1. Users / Clients

There must be a durable canonical user/client identity.

Once a user successfully completes the application's **Email OTP Verification** checkpoint, that user must remain persistently represented in the database.

The terminology should be:

```text
Email OTP Verification
```

or appropriate domain/code equivalents such as:

```text
email_verified
email_verified_at
email_verification_status
email_otp_verified
```

Do not call this process KYC.

```text
Email OTP Verification
        ≠
Regulatory KYC
```

Email OTP Verification proves control of the supplied email address and forms part of account verification/onboarding.

If legacy frontend or backend code incorrectly uses KYC terminology for this process, identify it.

Do not blindly rename actual regulatory KYC functionality if genuine regulatory KYC functionality exists elsewhere.

The canonical user/client identity must continue to anchor:

```text
User / Client
    │
    ├── Email OTP Verification
    ├── Account / onboarding state
    ├── Fund allocations
    ├── Investments
    ├── Payments
    ├── Deposits / withdrawals
    ├── Transactions
    ├── SIP subscriptions
    │       └── AutoPay mandate
    └── Relevant financial/audit history
```

Financial records must not become orphaned because obsolete onboarding or legacy tables are eventually removed.

---

# 2. Fund Pool / Investment Management

The application fundamentally manages users and their participation in investment/fund pools.

Discover the exact current implementation of:

* fund pools;
* fund creation/configuration;
* client allocation;
* invested amounts;
* deposits;
* withdrawals;
* payment records;
* investment records;
* balances;
* allocation status;
* transaction history;
* admin adjustments;
* client-facing fund information.

Determine the authoritative source of truth for each.

Do not carry multiple legacy representations of the same concept into the new frontend.

---

# 3. SIP

SIP remains an active product capability.

Discover the actual implementation of:

```text
SIP subscription
SIP schedule
SIP amount
SIP due dates
SIP status
AutoPay relationship
payment reconciliation
investment creation
```

There are existing SIP workers.

Do not remove them merely because the frontend is being rebuilt.

Determine their real responsibilities and expose only the necessary user/admin interfaces in the new frontend.

---

# 4. AutoPay / PhonePe

AutoPay remains an active product capability.

Conceptually the desired responsibility separation is:

```text
SIP Scheduler / Backend
        ↓
Determine scheduled SIP is due
        ↓
Validate subscription and mandate
        ↓
Initiate required PhonePe redemption flow
        ↓
PhonePe / payment infrastructure
        ↓
Authorized debit
        ↓
Webhook / payment status
        ↓
Backend reconciliation
        ↓
Transaction / investment state
        ↓
Frontend
```

Do not build payment-processing logic into frontend components.

The frontend should interact only through authenticated backend APIs.

PhonePe remains an external provider.

There should be **one application implementation** for PhonePe integration.

Environment-specific behavior should be selected through configuration/environment variables rather than separate dev and production source implementations.

Conceptually:

```text
same source code
       ↓
environment configuration
       ↓
appropriate PhonePe environment/configuration
```

Do not create separate forks of payment logic for dev and production.

---

# 5. Secure Authentication / Login

The application already contains secure login/authentication mechanisms.

Discover the actual current implementation rather than replacing it casually.

Map:

```text
login UI
   ↓
authentication request
   ↓
backend authentication
   ↓
session/token creation
   ↓
Redis/database involvement
   ↓
authenticated API access
   ↓
authorization
   ↓
logout/session invalidation
```

Determine:

* how credentials are handled;
* whether sessions or tokens are used;
* how Redis participates;
* how frontend authentication state is maintained;
* how admin/client authorization is enforced;
* how route protection currently works;
* how expired sessions are handled;
* how authentication state survives reload/app restart.

The new frontend must preserve the security model while simplifying its frontend implementation.

Security logic must not be weakened merely for architectural cleanliness.

---

# Infrastructure Architecture

## Development Environment

Development deployment:

```text
/srv/dev_stack/BOE_APP/dev_release
```

The development environment should remain architecturally equivalent to production.

It has its own isolated:

```text
frontend
backend
PostgreSQL database
Redis
environment configuration
external-service configuration
```

It is used by a small group of developers/testers.

---

## Production Environment

Production deployment:

```text
/srv/dev_stack/BOE_APP/prod_release
```

The intended release philosophy is:

```text
same tested application artifacts
              +
environment-specific configuration
              =
environment deployment
```

Do not maintain substantially different application source code for dev and production.

---

# Redis

Redis remains part of the architecture.

Dev and production should remain isolated:

```text
DEV
 ├── Backend
 ├── PostgreSQL DEV
 └── Redis DEV

PROD
 ├── Backend
 ├── PostgreSQL PROD
 └── Redis PROD
```

Discover exactly what Redis currently provides.

Examples may include:

* session state;
* caching;
* queues;
* rate limiting;
* distributed locks;
* worker coordination;
* Pub/Sub;
* ephemeral state;
* request coordination.

Do not assume its purpose merely from configuration files.

Trace its actual usages.

The new frontend architecture should not directly depend on Redis internals.

Redis remains backend/infrastructure responsibility.

---

# Monitoring / Analytics Architecture

A separate monitoring/operations platform is planned but should **not become part of the new frontend redesign**.

The future architecture is conceptually:

```text
                 MONITOR / OPS
                      │
             ┌────────┴────────┐
             │                 │
            DEV               PROD
             │                 │
        telemetry         telemetry
        metrics           metrics
        logs              logs
        status            status
```

This monitoring platform will eventually exist as a **separate repository and separately deployable stack**.

The BOE application itself should only expose standard observability mechanisms where appropriate:

```text
health endpoints
metrics
structured logs
audit events
database metrics
Redis metrics
system/container metrics
```

Do not embed an entire monitoring dashboard or operations platform into the main BOE frontend.

---

# Critical Frontend Deployment Constraint — Browser + Android APK

The frontend serves two important presentation environments:

1. **normal web browser**
2. **Android smartphone application packaged through the existing Gradle-based application pipeline**

The current application suffers from inconsistent layouts across devices.

The new frontend must explicitly solve this.

However, avoid creating two completely independent frontend implementations.

Prefer:

```text
                 SHARED TYPESCRIPT FRONTEND
                          │
             ┌────────────┴────────────┐
             │                         │
       Browser Layout             Mobile/App Layout
             │                         │
       desktop/tablet            smartphone/APK
```

Share:

* API clients;
* domain types;
* authentication;
* business logic;
* query/data layer;
* forms/validation;
* reusable components;
* route definitions where practical;
* design tokens;
* feature modules.

Allow presentation-specific differences for:

* navigation;
* header structure;
* sidebar;
* bottom navigation;
* touch targets;
* safe areas;
* screen density;
* viewport dimensions;
* keyboard behavior;
* modal/dialog behavior;
* mobile scrolling;
* app-level shell;
* browser-level shell.

The new system should therefore be **responsive/adaptive**, not duplicated.

---

# Mobile / APK Layout Requirements

The mobile presentation must deliberately account for smartphone constraints.

Investigate the current Gradle/APK integration and any WebView/native wrapper configuration.

Document what the frontend must support for:

* status bar;
* camera cutout/notch;
* safe-area insets;
* Android navigation area;
* orientation;
* viewport sizing;
* keyboard opening/resizing;
* touch interaction;
* mobile scrolling;
* dialogs;
* sheets;
* menus;
* navigation;
* back-button behavior;
* deep/internal links;
* external links.

The frontend must not place important content behind:

```text
camera notch
status bar
system navigation
```

Use appropriate safe-area/layout primitives instead of arbitrary hardcoded padding wherever possible.

---

# Browser Layout Requirements

The browser version should deliberately support:

* desktop;
* laptop;
* tablet;
* narrow browser windows.

Define a proper responsive layout system.

Determine where the application should use:

```text
sidebar
top navigation
content container
cards
tables
drawers
modals
responsive forms
breadcrumbs
page headers
```

Do not allow each screen to invent its own layout rules independently.

---

# Design System Requirement

The new frontend must use a coherent design system.

The investigation should recommend a small foundational UI system covering:

## Foundations

* typography;
* spacing;
* border radius;
* elevations;
* color tokens;
* semantic states;
* icon conventions;
* breakpoints;
* container widths;
* transitions;
* accessibility states.

## Primitive components

Examples:

```text
Button
Input
Select
Textarea
Checkbox
Radio
Switch
Badge
Avatar
Card
Divider
Tooltip
Spinner
Skeleton
Alert
Toast
Modal/Dialog
Drawer/Sheet
Dropdown/Menu
Tabs
Pagination
DataTable primitives
```

## Application components

Examples:

```text
AppShell
WebNavigation
MobileNavigation
PageHeader
Section
FormSection
EmptyState
ErrorState
LoadingState
StatCard
TransactionRow
FundCard
UserCard
StatusBadge
```

Do not create a massive enterprise component abstraction framework.

Create only what this application needs.

---

# Feature-First Frontend Architecture

Prefer organizing the new frontend around product domains/features rather than one enormous collection of unrelated files.

A target structure may resemble:

```text
src/
├── app/
│   ├── routing/
│   ├── providers/
│   ├── layouts/
│   └── bootstrap/
│
├── features/
│   ├── auth/
│   ├── users/
│   ├── funds/
│   ├── allocations/
│   ├── investments/
│   ├── transactions/
│   ├── payments/
│   ├── sip/
│   └── profile/
│
├── components/
│   ├── ui/
│   └── shared/
│
├── services/
│   ├── api/
│   └── external/
│
├── hooks/
├── types/
├── utils/
├── styles/
└── assets/
```

This is illustrative only.

Do not impose this exact structure until the repository has been investigated.

The final recommended structure must be based on the project's actual requirements.

---

# TypeScript Requirements

The new frontend must use TypeScript meaningfully.

Avoid:

```text
any everywhere
unknown casts everywhere
duplicated handwritten API shapes
loosely typed JSON handling
```

Establish proper types for important domains such as:

```text
User
Client
Fund
FundPool
Allocation
Investment
Transaction
Payment
SIP
AutoPayMandate
VerificationState
AuthenticationState
API responses
API errors
```

Where backend contracts already exist in TypeScript, investigate whether safe sharing or generation of types is practical.

Do not introduce coupling that makes frontend and backend impossible to deploy independently.

---

# API Contract Investigation

This is one of the most important parts of the audit.

For every current frontend feature, determine:

```text
Page / Component
        ↓
frontend function/hook
        ↓
HTTP method
        ↓
API endpoint
        ↓
backend route
        ↓
handler/service
        ↓
database/external operation
```

Produce a complete route/API matrix.

For each endpoint classify:

```text
ACTIVE
LEGACY
DUPLICATE
BROKEN
UNREFERENCED
BACKEND-ONLY
FRONTEND-ONLY/BROKEN
NEEDS RUNTIME VERIFICATION
```

The new frontend must not be built against endpoints merely because old JavaScript code references them.

Verify backend reality.

---

# Route Investigation

Map every frontend route.

Determine:

* route path;
* screen/page;
* user role;
* entry/navigation path;
* backend dependencies;
* active status;
* whether it is reachable;
* whether links point to it;
* whether it contains stale functionality.

Find:

* broken links;
* unreachable pages;
* duplicate routes;
* renamed routes;
* stale navigation entries;
* routes with no backend support;
* backend functionality with no reachable frontend.

The new frontend should have one clean canonical route map.

---

# Admin vs Client Experience

Identify the real roles/product surfaces supported by the application.

Where admin and client functionality differ, design distinct navigation and permissions while sharing common foundations.

Example conceptual structure:

```text
Application
   │
   ├── Client Experience
   │    ├── Dashboard
   │    ├── Fund participation
   │    ├── Investments
   │    ├── SIP / AutoPay
   │    ├── Transactions
   │    └── Profile / account
   │
   └── Admin Experience
        ├── Dashboard
        ├── Users / clients
        ├── Funds
        ├── Allocations
        ├── Payments
        ├── Transactions
        ├── SIP administration
        └── Operational actions
```

Do not assume these exact pages exist.

Derive the final screen inventory from the codebase and active product requirements.

---

# Legacy Frontend Forensics

The existing JS/JSX frontend must be thoroughly inspected before replacement.

Identify:

* active screens;
* stale screens;
* duplicate screens;
* abandoned UI experiments;
* old components;
* unused hooks;
* duplicate hooks;
* unused contexts/providers;
* duplicate API clients;
* old API contracts;
* obsolete state management;
* unused assets;
* outdated CSS;
* duplicate styles;
* inconsistent layout wrappers;
* unreachable functionality;
* legacy authentication flows;
* obsolete payment screens;
* dead feature flags;
* commented-out implementations.

Do not carry these forward into the new frontend.

---

# Semantic Duplication

Look beyond identical code.

Find different implementations that perform the same business responsibility under different names.

Examples:

```text
useClientFunds()
usePortfolio()
useInvestmentSummary()
```

may all represent overlapping concepts.

Likewise:

```text
FundCard
InvestmentCard
PortfolioCard
```

may contain largely identical representations.

Document semantic duplication and recommend the canonical concept.

---

# Backend Cleanup Context

Although the main redesign target is the frontend, the desired end state is:

> no unnecessary remains in either frontend or backend.

Therefore identify backend remnants associated with features that are definitely no longer used.

Examples:

* stale routes;
* obsolete controllers;
* unused services;
* abandoned workers;
* duplicate API versions;
* unused validation schemas;
* unused database adapters;
* obsolete models;
* old compatibility logic.

Do **not** remove backend code merely because the new frontend does not immediately call it.

Prove that it is obsolete.

---

# Existing Complexity Audit

The following directory contains partially completed work that must be incorporated:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/docs/complexity-audit-2026-08-26
```

Read it carefully.

For every relevant previous finding classify it as:

```text
CONFIRMED
PARTIALLY COMPLETED
ALREADY FIXED
STILL ACTIVE
OUTDATED
CONTRADICTED BY CURRENT CODE
NEEDS VERIFICATION
```

Do not repeat work unnecessarily.

Also identify any half-completed refactors that leave the repository temporarily inconsistent.

---

# Git / Recent Work Investigation

Inspect recent repository activity.

Review:

```text
git status
git log
recent diffs
current branch
uncommitted changes
recently created files
recently deleted files
recently modified architecture
```

The purpose is to understand what the previous agent was in the middle of doing.

Do not accidentally design around code that represents a half-finished migration.

---

# Current Architecture Documentation

Reconstruct the actual current architecture.

Produce diagrams such as:

```text
Browser / APK
      ↓
Current frontend
      ↓
API client(s)
      ↓
Backend
      ↓
Authentication / authorization
      ↓
Domain services
      ↓
PostgreSQL / Redis
      ↓
PhonePe / email / external services
```

Then create more detailed per-domain diagrams.

---

# Target Architecture

The desired high-level system should remain simple.

Conceptually:

```text
             CLIENT / ADMIN
                   │
           TypeScript Frontend
                   │
            Typed API Layer
                   │
          TypeScript Backend
             │          │
        PostgreSQL     Redis
             │
        External Services
        PhonePe / Email
```

Do not introduce unnecessary:

* microservices;
* Kubernetes;
* event buses;
* excessive repositories;
* unnecessary generic factories;
* duplicated API layers;
* frontend business-rule engines;
* separate browser/mobile business implementations.

Prefer the smallest architecture that is correct, secure, and maintainable.

---

# Browser + Mobile Target Architecture

The new frontend should preferably consist of one feature/application layer with separate layout behavior.

Conceptually:

```text
                         BOE FRONTEND
                              │
                    Shared Feature Layer
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
       Browser Shell                       Mobile Shell
            │                                   │
 Sidebar / Header                    Mobile Header / Bottom Nav
 Desktop Tables                     Mobile Cards / Compact Lists
 Wide Dialogs                       Sheets / Mobile Dialogs
 Dense Information                  Touch-Friendly Information
```

The business logic should remain shared.

Avoid:

```text
web_fund_page.tsx
mobile_fund_page.tsx
```

containing two copies of the same business logic.

Prefer shared feature components with presentation composition appropriate to each shell.

---

# Responsive Component Strategy

Document which elements should:

### Remain identical

Examples:

* validation;
* API behavior;
* types;
* domain state;
* permissions;
* transaction semantics.

### Adapt responsively

Examples:

* grid count;
* spacing;
* form arrangement;
* cards;
* table density.

### Use a deliberately different mobile representation

Examples:

```text
Desktop data table
        ↓
Mobile stacked transaction cards
```

or:

```text
Desktop sidebar
        ↓
Mobile bottom navigation / drawer
```

This distinction must be designed intentionally.

---

# Layout Consistency

Audit the current application for layout inconsistencies.

Find all implementations of:

* app wrappers;
* headers;
* navbars;
* sidebars;
* mobile navigation;
* content widths;
* padding;
* page titles;
* modal positioning;
* cards;
* forms;
* tables.

Determine which ones conflict.

The target frontend should establish one canonical layout system.

---

# State Management Investigation

Determine exactly how frontend state is currently handled.

Find:

* global contexts;
* Redux/Zustand/etc. if present;
* local component state;
* server/query state;
* cached API state;
* authentication state;
* payment state;
* form state.

Do not automatically introduce a large state-management system.

Classify state into:

```text
Server state
Authentication/session state
UI state
Form state
Persistent client preferences
```

Choose the minimum appropriate mechanism for each.

---

# Data Fetching

Audit current data fetching for:

* duplicate requests;
* request waterfalls;
* unnecessary reloads;
* polling;
* race conditions;
* stale state;
* duplicated caching;
* missing loading states;
* missing error handling;
* retry loops;
* manual request coordination.

The new architecture must have one consistent data-access strategy.

---

# Error Handling

Define consistent handling for:

```text
authentication errors
authorization errors
validation errors
network failures
payment errors
server errors
empty states
loading states
offline/temporary failures
```

No page should independently invent its own error behavior.

---

# Navigation Integrity

The final design must guarantee:

```text
no broken navigation links
no unreachable active pages
no frontend routes without implementation
no API links pointing to removed endpoints
no dead menu entries
```

Create an explicit navigation map for:

```text
Admin Web
Admin Mobile
Client Web
Client Mobile
```

where applicable.

---

# Security Requirements

Frontend redesign must preserve backend-enforced security.

Ensure:

* authentication is backend-authoritative;
* authorization is backend-authoritative;
* client users cannot access another client's records;
* admin routes require appropriate authorization;
* payment verification occurs server-side;
* PhonePe webhook trust is server-side;
* financial values cannot be trusted merely because the frontend sends them;
* frontend route guards are UX protection, not the security boundary.

---

# Accessibility and Interaction

The new UI should follow modern accessibility practices.

Include:

* keyboard accessibility where relevant;
* visible focus states;
* semantic HTML;
* labels;
* accessible form errors;
* usable contrast;
* touch target sizing;
* screen-reader-friendly interactive controls where practical.

---

# Performance Requirements

Audit why current pages feel slow or web-like.

Measure or identify:

* unnecessarily large bundles;
* duplicate libraries;
* repeated API requests;
* oversized assets;
* unnecessary providers;
* expensive rerenders;
* blocking startup operations;
* repeated authentication validation;
* route-level loading problems.

The new frontend should support:

* route/code splitting where appropriate;
* efficient initial startup;
* cached server state where appropriate;
* skeleton/loading states;
* optimized assets;
* reduced JavaScript overhead.

Do not over-optimize before measuring.

---

# Dependency Audit

Inventory frontend dependencies.

Classify:

```text
KEEP
REPLACE
REMOVE
INVESTIGATE
```

Find:

* duplicate UI libraries;
* duplicate icon libraries;
* obsolete routing libraries;
* redundant HTTP clients;
* unused state libraries;
* stale packages;
* JS-only historical dependencies;
* packages supporting removed features.

The new frontend should begin with a deliberately small dependency surface.

---

# CSS / Styling Audit

Determine the current styling architecture:

* global CSS;
* CSS modules;
* Tailwind;
* inline styles;
* component libraries;
* styled components;
* duplicated stylesheets;
* hardcoded dimensions.

Identify the cause of inconsistent responsive behavior.

Propose one consistent styling strategy.

---

# Assets

Audit:

* logos;
* icons;
* illustrations;
* fonts;
* images;
* duplicated assets;
* unused assets;
* outdated branding.

Identify which should be migrated.

Do not copy the entire legacy asset directory automatically.

---

# Investigation Method

Do not judge functionality merely from filenames.

Trace actual:

```text
imports
exports
route registration
component rendering
navigation references
API calls
backend route registration
service calls
database queries
worker registration
build configuration
```

Mark uncertain findings as:

```text
NEEDS RUNTIME VERIFICATION
```

rather than guessing.

---

# No Premature Implementation

During this investigation/documentation task:

* do not redesign individual pages yet;
* do not rewrite the frontend yet;
* do not mass-delete legacy files;
* do not mechanically migrate JS → TS;
* do not change backend API contracts;
* do not remove database structures;
* do not introduce new frameworks;
* do not perform speculative refactoring.

First create a reliable architecture and migration blueprint.

---

# Required Documentation Output

Create a new documentation directory under:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/docs/
```

Use a descriptive work-specific name such as:

```text
frontend-typescript-redesign-architecture
```

If a more accurate project name becomes obvious during investigation, use that instead.

The directory should contain implementation-ready Markdown documents.

At minimum create:

```text
release_manager/docs/<work-name>/
│
├── 00-executive-summary.md
├── 01-current-system-architecture.md
├── 02-active-feature-inventory.md
├── 03-frontend-forensic-audit.md
├── 04-backend-api-contract-map.md
├── 05-route-navigation-map.md
├── 06-legacy-dead-duplicate-code.md
├── 07-typescript-frontend-target-architecture.md
├── 08-responsive-web-mobile-layout-system.md
├── 09-design-system-component-plan.md
├── 10-migration-and-implementation-plan.md
├── 11-target-file-and-directory-map.md
├── 12-risk-regression-test-plan.md
└── README.md
```

Additional focused documents may be created where useful.

---

# 00 — Executive Summary

Explain:

* what the application actually does today;
* why the frontend became difficult to maintain;
* what major legacy problems exist;
* what the recommended redesign strategy is;
* whether backend changes are required;
* major risks;
* approximate scope.

Someone should be able to read this document in a few minutes and understand the entire project direction.

---

# 01 — Current System Architecture

Document the actual current:

```text
frontend
backend
database
Redis
workers
payment integration
email verification
authentication
deployment
```

Include Mermaid or text diagrams.

Reference exact source files.

---

# 02 — Active Feature Inventory

For every active product capability document:

| Feature | Client/Admin | Frontend | Backend | API | DB | Status |
| ------- | ------------ | -------- | ------- | --- | -- | ------ |

Include only evidence-supported conclusions.

---

# 03 — Frontend Forensic Audit

Document:

* JS/JSX architecture;
* layouts;
* routes;
* components;
* hooks;
* services;
* state;
* styling;
* duplicate implementations;
* obsolete code;
* responsive failures;
* web/mobile inconsistencies.

---

# 04 — Backend API Contract Map

Produce a canonical map such as:

| Domain | Method | Endpoint | Handler | Auth | Request | Response | Frontend Usage | Status |
| ------ | ------ | -------- | ------- | ---- | ------- | -------- | -------------- | ------ |

This document is critical for building the frontend cleanly.

---

# 05 — Route and Navigation Map

Document current and proposed routes.

Show:

```text
CURRENT
```

versus:

```text
TARGET
```

Include:

* admin routes;
* client routes;
* mobile navigation;
* browser navigation;
* authorization requirements.

---

# 06 — Legacy / Dead / Duplicate Code

Classify findings:

```text
ACTIVE
DEFINITELY DEAD
PROBABLY STALE
DUPLICATE
SEMANTIC DUPLICATE
HALF-MIGRATED
NEEDS RUNTIME VERIFICATION
```

List exact files and references.

Do not simply say "old frontend contains dead code."

Provide evidence.

---

# 07 — TypeScript Frontend Target Architecture

Define the final recommended:

```text
directories
feature boundaries
component hierarchy
routing
providers
API layer
types
state
forms
authentication integration
error handling
```

Include an example target tree.

---

# 08 — Responsive Web/Mobile Layout System

This document should be extremely concrete.

Define:

* breakpoints;
* application shells;
* browser layout;
* mobile/APK layout;
* navigation patterns;
* content widths;
* page spacing;
* safe-area strategy;
* mobile tables;
* forms;
* dialogs;
* sheets;
* keyboard behavior.

Show which components are:

```text
SHARED
RESPONSIVE
WEB-SPECIFIC PRESENTATION
MOBILE-SPECIFIC PRESENTATION
```

---

# 09 — Design System / Component Plan

List exactly which primitives and application-level components should exist.

Avoid generic design-system overengineering.

Include:

```text
component
purpose
variants
responsive behavior
where used
```

---

# 10 — Migration and Implementation Plan

Produce implementation phases that I can begin executing immediately.

For example:

```text
Phase 0 — Stabilize contracts
Phase 1 — Create TS frontend foundation
Phase 2 — App shells and routing
Phase 3 — Authentication
Phase 4 — Core user/client flows
Phase 5 — Fund/allocation flows
Phase 6 — Payments
Phase 7 — SIP/AutoPay
Phase 8 — Admin functionality
Phase 9 — Mobile/APK adaptation
Phase 10 — Remove legacy frontend
Phase 11 — Backend cleanup
Phase 12 — Regression and release
```

The actual phases should be based on repository evidence.

For each phase specify:

* objective;
* files/directories created;
* files/directories modified;
* legacy files removed after replacement;
* backend dependencies;
* test requirements;
* acceptance criteria;
* prerequisites.

---

# 11 — Target File and Directory Map

Provide the proposed final frontend structure.

For every major file/directory specify:

```text
purpose
new / reused / migrated
source legacy file if applicable
dependencies
```

Also include a **legacy → target migration map**.

Example:

| Legacy File  | Responsibility | Target File            | Action  |
| ------------ | -------------- | ---------------------- | ------- |
| `old/...jsx` | User login     | `features/auth/...tsx` | Rewrite |
| `old/...jsx` | Dead page      | —                      | Remove  |

---

# 12 — Risk / Regression / Testing Plan

Identify high-risk areas:

* authentication;
* authorization;
* Email OTP Verification;
* fund allocation;
* payments;
* SIP;
* AutoPay;
* transaction persistence;
* Android packaging;
* navigation;
* responsive layouts.

Define the minimum testing required before replacing the old frontend.

---

# README

The documentation directory README should provide:

```text
purpose
document order
current project status
recommended starting point
implementation sequence
```

I should be able to open this README and immediately know which document to follow first.

---

# Every Finding Must Be Code-Accurate

Important conclusions must reference actual repository artifacts.

For example:

```text
src/pages/example.jsx
src/routes/example.ts
functionName()
ComponentName
POST /api/example
users table
redis key
worker name
```

Do not produce vague architectural commentary.

---

# Explicit Simplification Principle

The new architecture must optimize for:

> **the smallest clean implementation that satisfies the actual product requirements.**

Do not optimize for:

> maximum number of abstractions.

If a feature can cleanly be implemented as:

```text
Page
  ↓
Feature hook/query
  ↓
Typed API client
  ↓
Backend
```

do not introduce six additional layers without a concrete reason.

---

# Legacy Code Rule

The old frontend exists to tell us:

> what behavior needs to survive.

It does **not** automatically tell us:

> what architecture needs to survive.

Preserve valid business behavior.

Do not preserve accidental architectural complexity.

---

# Source-of-Truth Rule

For every important responsibility determine one canonical implementation.

Examples:

```text
one auth flow
one API client strategy
one route definition
one user identity
one payment status model
one fund-allocation model
one SIP model
one responsive layout system
one design system
```

Avoid competing implementations.

---

# End-State Requirement

The desired final system should be understandable enough that a developer can answer:

```text
Where is this page?
Where does it fetch data?
Which API does it use?
Where is that API implemented?
Which database state does it modify?
Who is allowed to call it?
How does this page render on mobile?
How does it render in the browser?
```

without performing another repository-wide forensic investigation.

The frontend should feel like **one deliberately designed application** rather than historical layers of different implementations.

The final architecture must support:

```text
Clean TypeScript frontend
        +
Modern consistent UI
        +
Browser-optimized presentation
        +
Android/mobile-optimized presentation
        +
Working routes
        +
Verified API contracts
        +
Secure authentication
        +
Email OTP Verification
        +
Funds / allocations / investments
        +
Payments
        +
SIP / AutoPay
        +
Clean backend integration
        +
No unnecessary legacy remains
```

---

# Final Deliverable

Do not finish this task with only an explanation in the terminal.

The primary deliverable is the documentation tree under:

```text
/home/nethunter07/PROJECTS/boe_app/release_manager/docs/<work-name>/
```

The documentation must contain enough concrete architectural detail, target files, implementation phases, dependency relationships, API mappings, and migration decisions that I can immediately begin the frontend rebuild without another discovery phase.

At the end of the task, print:

1. the documentation directory created;
2. all Markdown documents created;
3. the recommended implementation starting point;
4. the first implementation phase;
5. any critical blockers that must be resolved before coding.

Do not modify the application source code during this investigation phase.

# Addendum — Greenfield TypeScript Frontend Rebuild Boundary

Treat the new frontend as a **greenfield rebuild**, not as a compatibility migration of the existing frontend.

The current repository structure is:

```text
boe_app/
├── backend_controller
├── emu
├── frontend_stack
├── node_modules
├── packages
├── release_manager
├── test_e2e
└── vault.md
```

The existing frontend currently lives at:

```text
/home/nethunter07/PROJECTS/boe_app/frontend_stack
```

with the current structure:

```text
frontend_stack/
├── app
├── assets
├── deploy
├── node_modules
└── packages
```

## New Frontend Location

Create the new TypeScript frontend in a completely separate sibling directory:

```text
/home/nethunter07/PROJECTS/boe_app/frontend_stack_ts
```

The intended repository-level structure should become:

```text
boe_app/
├── backend_controller
├── emu
├── frontend_stack
├── frontend_stack_ts
├── node_modules
├── packages
├── release_manager
├── test_e2e
└── vault.md
```

---

# `frontend_stack` Must Remain Untouched

The existing:

```text
frontend_stack/
```

must continue to function exactly as it does today while the new frontend is being developed.

During the new frontend build:

**Do not modify the old frontend.**

This means:

* do not refactor it;
* do not migrate individual files out of it;
* do not rename its directories;
* do not alter its routes;
* do not change its API calls;
* do not replace its layouts;
* do not change its dependencies;
* do not remove components;
* do not convert existing JS/JSX files into TypeScript;
* do not make the old frontend dependent on `frontend_stack_ts`;
* do not gradually merge the two frontend implementations.

The old frontend must remain a functional reference implementation until the new frontend is complete enough to replace it.

---

# Greenfield Architecture Principle

Do **not** design `frontend_stack_ts` around backward compatibility with the current frontend.

Do not think in terms of:

```text
old component
    ↓
rewrite component
    ↓
preserve old structure
```

Instead think in terms of:

```text
actual product requirement
        ↓
actual backend capability
        ↓
clean domain model
        ↓
clean route structure
        ↓
clean TypeScript architecture
        ↓
modern frontend implementation
```

The existing frontend is historical evidence, not the architectural foundation of the new frontend.

---

# What the Old Frontend Is For

The old frontend should only be analyzed to understand:

* what the application currently allows users to do;
* what screens currently exist;
* which user flows are active;
* which admin flows are active;
* how authentication currently behaves;
* how Email OTP Verification behaves;
* how funds are displayed;
* how investments are represented;
* how allocation works;
* how payments are initiated/displayed;
* how SIP and AutoPay are exposed;
* what backend APIs are currently being called;
* what assets or branding are still relevant;
* what UX behavior users currently depend on.

Do **not** assume that any of the following should survive merely because they exist in `frontend_stack`:

* directory structure;
* component hierarchy;
* page hierarchy;
* state management;
* routing implementation;
* layout system;
* styling strategy;
* hooks;
* API wrappers;
* naming conventions;
* context providers;
* UI abstractions;
* responsive behavior.

Preserve **product behavior**, not legacy frontend architecture.

---

# Backend as the Real Integration Target

The new frontend should ultimately integrate directly with the existing TypeScript backend.

Therefore the main technical dependency should be:

```text
frontend_stack_ts
        ↓
canonical backend API
        ↓
backend_controller
        ↓
PostgreSQL / Redis / workers / external providers
```

The old frontend must **not** sit between the new frontend and backend.

Avoid:

```text
frontend_stack_ts
        ↓
frontend_stack
        ↓
backend
```

or any other compatibility bridge.

The target relationship is simply:

```text
OLD
frontend_stack
      ↓
backend_controller


NEW
frontend_stack_ts
      ↓
backend_controller
```

Both may temporarily coexist while the new frontend is being developed, but they must remain independent.

---

# Analyze the Backend Independently

Do not infer backend behavior only from the old frontend.

Inspect `backend_controller` directly and determine:

* actual registered routes;
* request methods;
* request schemas;
* response schemas;
* authorization requirements;
* user roles;
* database operations;
* Redis usage;
* worker interactions;
* payment integration;
* SIP/AutoPay behavior;
* Email OTP Verification;
* authentication/session handling;
* errors/status codes.

The backend itself is the authoritative integration source.

The old frontend is useful for discovering which backend functionality represents current product behavior, but it must not define the new architecture.

---

# Do Not Reproduce Legacy Mistakes

If the old frontend contains:

* duplicate pages;
* duplicate API wrappers;
* broken links;
* stale routes;
* old feature remnants;
* unnecessary providers;
* unused components;
* abandoned designs;
* inconsistent responsive logic;
* obsolete business terminology;
* duplicated state;
* multiple implementations of the same feature;

do not reproduce them in `frontend_stack_ts`.

The purpose of the greenfield rebuild is specifically to avoid carrying these historical problems forward.

---

# New Frontend Must Be Designed First

Before implementing significant feature pages, define the clean architecture for:

```text
frontend_stack_ts/
├── app/
├── features/
├── components/
├── services/
├── hooks/
├── types/
├── styles/
├── assets/
└── ...
```

The exact structure must come from the architecture investigation.

Do not copy the existing `frontend_stack` directory tree merely for familiarity.

---

# TypeScript-First Requirement

Everything in the new application should be designed TypeScript-first.

Prefer:

```text
.ts
.tsx
```

for application source code.

Do not create a JavaScript frontend first and convert it later.

Important domains should have explicit types from the beginning, including:

```text
User
Client
Authentication
EmailVerification
Fund
FundPool
Allocation
Investment
Transaction
Payment
SIP
AutoPayMandate
APIRequest
APIResponse
APIError
```

---

# No Compatibility Layer Unless Absolutely Required

Do not create temporary abstractions whose only purpose is to mimic the old frontend.

Examples to avoid:

```text
legacyApiAdapter
oldRouteCompatibility
legacyComponentWrapper
oldStateBridge
jsCompatibilityLayer
```

If the backend itself has a genuinely inconsistent API that prevents a clean frontend design, document that backend issue separately and propose the smallest appropriate backend correction.

Do not hide bad backend contracts behind permanent frontend compatibility code.

---

# Feature Parity, Not Implementation Parity

The replacement requirement is:

> The new frontend must support the active product functionality that users and administrators actually need.

It is **not**:

> The new frontend must reproduce every page, component, route, and behavior from the old frontend.

Classify old functionality as:

```text
REBUILD
REDESIGN
CONSOLIDATE
REMOVE
NEEDS VERIFICATION
```

Only rebuild functionality confirmed to belong to the current product.

---

# New Routing Must Be Canonical

The new frontend should define a clean route structure from scratch.

Do not preserve old URLs simply because they exist unless:

* users genuinely depend on them;
* external systems depend on them;
* Android deep links depend on them;
* backend redirects depend on them;
* there is another concrete compatibility requirement.

If an old route is poorly named or structurally broken, document the replacement route.

The final frontend should have:

```text
one route map
one navigation model
one authorization model
one canonical destination for each active feature
```

---

# New UI Must Be Independent

The visual design should also be treated as greenfield work.

Do not attempt to "clean up" the existing layouts incrementally.

Create a new:

* application shell;
* typography system;
* spacing system;
* navigation;
* sidebar;
* mobile navigation;
* content layout;
* cards;
* forms;
* dialogs;
* tables;
* responsive behavior;
* loading states;
* error states;
* empty states.

Use the old frontend only to understand the information that must be presented.

---

# Browser and Mobile Are Presentation Modes of the New Frontend

Do not reproduce separate legacy versions for browser and Android.

Within `frontend_stack_ts`, build one application architecture that deliberately supports:

```text
Shared Business / Feature Layer
           │
      ┌────┴────┐
      │         │
     Web      Mobile
    Shell      Shell
```

Business behavior, types, API access, authentication, and domain logic should remain shared.

Only layout/presentation should diverge where appropriate.

---

# Existing Application Must Stay Operational During Rebuild

Development should conceptually happen as:

```text
                    backend_controller
                     /             \
                    /               \
                   ↓                 ↓
          frontend_stack      frontend_stack_ts
             CURRENT                NEW
             WORKING              BUILDING
```

This allows the new frontend to be developed and tested without destabilizing the existing application.

---

# Replacement / Cutover Model

When the new frontend reaches required feature parity and passes testing:

```text
frontend_stack_ts
        ↓
full integration verification
        ↓
web verification
        ↓
Android/APK verification
        ↓
authentication verification
        ↓
payment verification
        ↓
SIP/AutoPay verification
        ↓
admin/client regression verification
        ↓
production readiness
```

only then should the old frontend be considered for removal.

---

# Old Frontend Removal Is a Separate Final Phase

Do not delete `frontend_stack` during the initial rebuild.

Its removal should happen only after the new frontend is verified.

The eventual migration should conceptually be:

```text
Phase 1
frontend_stack       = active
frontend_stack_ts    = development

Phase 2
frontend_stack       = active/reference
frontend_stack_ts    = feature complete/testing

Phase 3
frontend_stack_ts    = validated replacement

Phase 4
deployment switches to frontend_stack_ts

Phase 5
old frontend confirmed unnecessary

Phase 6
frontend_stack removed
legacy dependencies removed
legacy deployment references removed
repository cleaned
```

---

# Final Cleanup Requirement

After successful cutover, the target repository should not permanently contain two frontend applications.

The desired final state is effectively:

```text
boe_app/
├── backend_controller
├── frontend_stack_ts
├── packages
├── release_manager
├── test_e2e
└── ...
```

The exact final naming may later be normalized—for example, `frontend_stack_ts` could eventually become the canonical `frontend_stack`—but **do not perform that rename during the initial greenfield build**.

First maintain isolation and prove the replacement works.

---

# Documentation Requirement for This Boundary

In the architecture documentation, explicitly record:

1. that `frontend_stack` is the legacy/current frontend;
2. that it must remain untouched during the new build;
3. that `frontend_stack_ts` is a greenfield replacement;
4. that the old frontend is used only for behavior/API discovery;
5. that the backend is the canonical integration target;
6. that compatibility with old frontend architecture is not a requirement;
7. that feature parity matters, implementation parity does not;
8. that old frontend deletion occurs only after successful cutover;
9. that no permanent dual-frontend architecture should remain afterward.

The core principle is:

> **Understand the old frontend. Do not inherit it.**

And:

> **Build the frontend the application should have today, not the frontend that historical development happened to produce. No need to complete works in the folder release_manager/docs/complexity* folder, redesign this first then we will move to testing and fixing if anything is broken from the backend side. And once done, just retire the frontend_stack folder from the repo but git history can keep the old one.**
