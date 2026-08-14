# Task: Rebuild Client Onboarding, Approval, App Distribution, and Email Verification Flow

You are working on the **BeOnEdge client application ecosystem**.

The system currently consists of:

* Public landing/signup website: `beonedge.in`
* Admin application/panel
* Client mobile application
* Backend/API services
* Development deployment stack located on the BeOnEdge VPS

The VPS can be accessed using:

```bash
ssh beonedge
```

The development application stack is located at:

```bash
/srv/dev_stack/BOE_APP/dev_release/
```

The development environment configuration is located at:

```bash
/srv/dev_stack/BOE_APP/dev_release/.env
```

The `.env` contains the SMTP configuration currently being used with **Zoho Mail**, including the SMTP service running over **port 465**.

Do not expose, print, log, commit, or otherwise reveal any SMTP credentials, passwords, API keys, secrets, or tokens found inside `.env`.

---

# Objective

Replace the existing client onboarding/email-verification logic with **one single canonical onboarding flow**.

The desired flow is:

```text
beonedge.in signup
        ↓
Admin Approval Page
        ↓
   ┌───────────────┐
   │               │
Reject          Approve
   │               │
End          Approval Email
                   │
                   ↓
             Download Client APK
                   │
                   ↓
              Install App
                   │
                   ↓
          Login with signup credentials
                   │
                   ↓
              Verify Email
                   │
                   ↓
             6-character OTP
                   │
                   ↓
             KYC/Verified State
                   │
                   ↓
          Investing/App Access
```

This must become the **only supported onboarding flow**.

The application is still in development/testing and **there are currently no real onboarded clients**, so backward compatibility with old onboarding flows is not required.

---

# 1. Website Signup

The client initially submits their signup request through:

```text
https://beonedge.in
```

Use the existing signup mechanism unless changes are necessary to support the target flow.

The submitted signup request should create a pending client/user request that appears in the:

```text
Admin Panel → Approvals
```

Do not perform email verification during website signup.

Do not automatically activate the user's client account.

The user should remain pending until an administrator explicitly approves them.

---

# 2. Admin Approval Page

For every pending client request, the administrator must have **exactly two onboarding actions**:

```text
Approve
Reject
```

Remove any other onboarding-related actions that currently exist.

## Reject

When the administrator clicks:

```text
Reject
```

the request should be rejected.

The administrator must NOT be required to:

* enter a rejection reason;
* write a message;
* select a rejection template;
* provide comments;
* provide notes;
* provide any additional input.

No rejection message needs to be supplied by the administrator.

Remove existing rejection-message/rejection-reason flows if they exist.

Clean up backend endpoints, frontend state, schemas, database fields, validation logic, components, and related code that exist solely to support those removed workflows where safe to do so.

---

# 3. Approve

When the administrator clicks:

```text
Approve
```

the backend should:

1. Mark the signup/application as approved.
2. Allow the client to authenticate using the credentials originally created through `beonedge.in`.
3. Send an approval/welcome email to the client's registered email address.
4. Include the official client APK download link in that email.

The approval action should not automatically mark the client's email as verified.

Approval and email verification are separate states.

Conceptually:

```text
pending
    ↓ admin approves
approved + email_unverified
    ↓ OTP verification
approved + email_verified
```

Adapt this to the project's existing data model rather than introducing unnecessary architecture.

---

# 4. Approval Email

After successful approval, send an email to the client's registered email address.

The email should contain an appropriate professional message such as:

* thanking them for signing up with BeOnEdge;
* informing them that their account/application has been approved;
* telling them that they can now download the BeOnEdge client application;
* providing the official APK download link;
* explaining that after installation they should log in using the **same email and credentials used while signing up on `beonedge.in`**;
* informing them that they will need to verify their email inside the application before gaining access to investment-related services.

Do not hardcode an arbitrary APK URL before inspecting how application releases are currently distributed.

---

# 5. Determine the Existing APK Distribution Mechanism

Before implementing the approval email, inspect the existing system and determine **how client application updates are currently delivered/notified to users**.

Specifically inspect:

* how new application versions are detected;
* how users are notified about updates;
* where APK files are stored;
* where APK files are served from;
* whether a backend download endpoint already exists;
* whether Nginx serves the APK;
* whether version metadata contains the APK URL/path;
* how production/dev APK versions are differentiated;
* whether `manifest.json` or the release `*-version.json` files participate in update delivery;
* how the mobile application's existing updater downloads new APK versions.

Relevant development-stack files/directories may include:

```text
/srv/dev_stack/BOE_APP/
├── manifest.json
├── dev_release/
│   ├── dev_apk/
│   ├── dev_admin_apk/
│   ├── dev-version.json
│   ├── docker-compose.dev_app.yml
│   ├── .env
│   └── ...
├── prod_release/
│   ├── prod_apk/
│   ├── admin_apk/
│   ├── prod-version.json
│   └── ...
└── monitor_service/
```

Trace the actual implementation instead of assuming the filenames above define the complete mechanism.

The approval email should use the **same canonical APK source/distribution infrastructure used by the app's update system** wherever practical.

Do not create a second unrelated APK-hosting mechanism unless the current architecture genuinely requires it.

The download URL sent to a client must be appropriate for the **client application**, not the admin APK.

---

# 6. Authentication After Installation

After downloading and installing the client application, the client must authenticate using:

```text
same email + same credentials used during signup on beonedge.in
```

Do not create a second registration/account-creation flow inside the mobile application.

The signup website and mobile application must refer to the same user/client identity.

The client should only be able to reach the email-verification/onboarding stage after:

```text
Admin approval → successful login
```

Pending or rejected applications must not gain normal client application access.

---

# 7. Email Verification

After the approved client signs in to the mobile application, an unverified client should see an option/workflow to:

```text
Verify Email
```

Email verification must happen **inside the client application**, not on the website.

Use a simple OTP-based verification system.

---

# 8. OTP Format

The verification OTP must contain exactly:

```text
6 characters
```

Allowed characters:

```text
a-z
A-Z
0-9
```

Therefore the alphabet is:

```text
abcdefghijklmnopqrstuvwxyz
ABCDEFGHIJKLMNOPQRSTUVWXYZ
0123456789
```

Example valid OTPs:

```text
A7d9Q2
kP4x8M
7AbC91
```

Do not restrict the OTP to numeric digits.

OTP generation must use a cryptographically secure random generator available in the project's backend language/runtime.

Do not use predictable pseudo-random generation.

OTP comparison must be case-sensitive.

For example:

```text
Ab12Cd != ab12cd
```

---

# 9. OTP Email

When the user requests email verification:

1. Generate a new 6-character OTP.
2. Associate it with the correct client/user.
3. Send the OTP to the client's registered email address using the configured Zoho SMTP service.
4. Present the OTP input UI inside the client application.
5. Validate the submitted OTP on the backend.
6. Mark the email/client verification state only after successful OTP validation.

SMTP configuration must be taken from the existing environment configuration.

Inspect:

```bash
/srv/dev_stack/BOE_APP/dev_release/.env
```

The existing SMTP service uses Zoho Mail and SMTP port:

```text
465
```

Port 465 normally means implicit TLS/SMTPS, so use the SMTP library/configuration mode appropriate to the existing environment.

Do not place SMTP credentials directly in source code.

Do not expose SMTP secrets through frontend/mobile APIs.

---

# 10. OTP Security and Lifecycle

Implement a sane OTP lifecycle.

At minimum:

* OTPs must expire.
* OTPs must become invalid after successful verification.
* A newly issued OTP should invalidate or supersede the previous active OTP for that verification flow.
* OTP verification should happen server-side.
* Do not send the expected OTP back through the API response.
* Do not include the OTP in normal application logs.
* Prevent unlimited rapid OTP generation.
* Prevent unlimited OTP guessing.

Use the project's existing security/rate-limiting infrastructure if one already exists.

Do not introduce a large authentication framework merely for OTP verification if a simple implementation fits the existing architecture.

Prefer storing a secure representation/hash of the OTP rather than plaintext if this fits the existing persistence architecture.

---

# 11. Verification as the KYC Gate

For the current version of the application, successful email verification represents the required **KYC/onboarding verification gate** before investment functionality becomes available.

The required progression is:

```text
Signup submitted
    ↓
Pending admin approval
    ↓
Admin approved
    ↓
Client receives APK email
    ↓
Client installs application
    ↓
Client signs in
    ↓
Email not verified
    ↓
OTP verification
    ↓
Verified/KYC-complete state
    ↓
Investment features enabled
```

Before verification, prevent access to functionality that requires an onboarded/verified client.

After successful verification, enable the normal services intended for verified clients.

Do not accidentally block harmless screens needed for:

* login;
* verification;
* account/onboarding status;
* logout;
* required application-update handling.

Use the application's existing authorization/state architecture where appropriate.

---

# 12. Remove Existing Conflicting Flows

This is important.

Search the entire relevant codebase for previous onboarding, approval, rejection, email-verification, account-activation, invite, OTP, signup-confirmation, and client-activation implementations.

Remove or refactor anything that conflicts with the required flow.

The objective is **not** to keep multiple onboarding implementations and simply add this one.

There should be one clear canonical flow.

Look for and eliminate obsolete code such as:

* alternative approval methods;
* admin-written rejection messages;
* rejection reason requirements;
* website email verification;
* verification links if they are part of the old onboarding flow;
* duplicate registration flows inside the mobile app;
* automatic client activation before admin approval;
* automatic email verification;
* alternative OTP schemes;
* numeric-only OTP assumptions;
* old invitation flows;
* duplicate account creation after approval;
* unused onboarding endpoints;
* obsolete UI screens;
* obsolete database fields;
* dead DTOs/types/interfaces;
* obsolete state transitions;
* unused email templates;
* old verification services.

Do not blindly delete code based only on filenames. Trace usages before removal.

Preserve unrelated functionality.

---

# 13. Inspect Before Modifying

Before making changes, inspect the complete flow across:

```text
Landing website
      ↓
Backend/API
      ↓
Database/user state
      ↓
Admin approval interface
      ↓
Email service
      ↓
APK/update distribution
      ↓
Client mobile application
      ↓
Authentication
      ↓
OTP verification
      ↓
Investment authorization
```

Determine:

* where signup requests are created;
* where pending status is stored;
* how admin approval currently works;
* how authentication accounts are created/stored;
* whether signup already creates credentials;
* how client status is represented;
* how email verification is currently represented;
* where email sending logic lives;
* how APK URLs are generated;
* how app versions and updates are handled;
* where investment access is authorized;
* whether frontend checks alone are being used where backend authorization is required.

Do not make assumptions when the implementation can be inspected.

---

# 14. Preserve Existing Architecture

Do not unnecessarily rewrite the whole application.

Reuse:

* existing authentication;
* existing database structure where reasonable;
* existing SMTP/email abstractions;
* existing application-update/APK distribution;
* existing authorization middleware;
* existing API patterns;
* existing UI architecture;
* existing deployment configuration.

Modify architecture only where necessary to create the intended flow cleanly.

---

# 15. State Model

There must be an unambiguous distinction between at least these logical states:

```text
PENDING_APPROVAL
REJECTED
APPROVED_UNVERIFIED
APPROVED_VERIFIED
```

These do not necessarily need to be literal enum values if the current database models status differently.

However, the application behavior must clearly represent these four conditions.

Expected behavior:

### PENDING_APPROVAL

* signup exists;
* admin can Approve or Reject;
* client cannot use normal client services.

### REJECTED

* request is no longer pending;
* user cannot become an active client through that rejected application.

### APPROVED_UNVERIFIED

* admin has approved the client;
* approval/download email has been sent;
* client can authenticate;
* client must complete email OTP verification;
* investment services remain unavailable.

### APPROVED_VERIFIED

* email OTP verification completed;
* client is considered verified/KYC-complete for this implementation;
* normal authorized client services become available.

---

# 16. API Behavior

Adapt endpoint naming to the current project conventions.

Conceptually the backend will need operations equivalent to:

```text
POST /admin/approvals/{id}/approve
POST /admin/approvals/{id}/reject

POST /auth/email-verification/request
POST /auth/email-verification/verify
```

Do NOT introduce these exact routes if equivalent routes already exist or the project's routing/versioning conventions require another structure.

Inspect and reuse the existing API design.

All security-sensitive state transitions must be enforced by the backend.

Do not rely solely on mobile/admin UI visibility to enforce permissions.

---

# 17. Admin UI Requirements

The Approvals page should be simplified.

For a pending client, the actionable controls should effectively be:

```text
[ Approve ] [ Reject ]
```

No rejection text box.

No rejection modal asking for a reason.

No mandatory notes.

No additional approval workflow unless required for an unrelated essential feature.

Approval should provide appropriate loading/success/error feedback.

Prevent accidental duplicate processing caused by repeated button clicks.

---

# 18. Client UI Requirements

For an approved but unverified client:

After login, clearly present email verification.

A suitable interaction is:

```text
Verify your email
[ Send verification code ]

Code sent to: <registered email>

[ _ _ _ _ _ _ ]

[ Verify ]
```

Because OTP characters can include lowercase and uppercase letters, the UI must use a normal alphanumeric input rather than a numeric-only keyboard/input mode.

The client must be able to enter exactly six characters.

Do not automatically lowercase or uppercase the user's input.

After successful verification:

* update application state immediately;
* persist the verification state server-side;
* unlock the appropriate verified-client experience;
* prevent unnecessary repeated verification prompts.

---

# 19. Email Templates

Create or update two relevant email paths if appropriate:

### Approval / Welcome Email

Triggered by:

```text
Admin → Approve
```

Contains:

* BeOnEdge welcome/thank-you message;
* confirmation of approval;
* client APK download link;
* instructions to login using existing website signup credentials;
* instructions that email verification will happen inside the app.

### OTP Verification Email

Triggered by:

```text
Client → Verify Email / Send Code
```

Contains:

* the six-character verification code;
* a brief explanation;
* expiration information;
* instruction to ignore the email if they did not request verification.

Follow the existing email styling/templates if available.

Do not expose internal infrastructure information in client emails.

---

# 20. Error Handling

Handle at least:

* SMTP connection failure;
* approval succeeds but email delivery fails;
* invalid APK URL/configuration;
* expired OTP;
* incorrect OTP;
* malformed OTP;
* repeated OTP request;
* repeated verification submission;
* already verified account;
* rejected account trying to authenticate;
* pending account trying to access client services;
* admin approving an already processed request;
* admin rejecting an already processed request.

Choose sensible idempotency behavior.

For example, repeated approval requests should not create duplicate accounts or corrupt state.

If email delivery fails after approval, do not silently claim that the email was successfully sent.

Use the project's existing retry/error-reporting architecture where appropriate.

---

# 21. Database Changes

Inspect the current database schema before adding fields.

Reuse existing fields where they correctly represent:

* approval status;
* email verification;
* client activation;
* OTP expiration;
* account state.

If migrations are necessary, create them using the project's established migration mechanism.

Since there are currently no real production clients, unnecessary legacy compatibility logic can be removed.

Do not destroy unrelated application data.

---

# 22. Testing

After implementation, test the complete flow.

At minimum verify:

### Signup

```text
Website signup
→ pending request appears in Admin Approvals
```

### Rejection

```text
Pending request
→ Reject
→ no rejection reason required
→ request becomes rejected
```

### Approval

```text
Pending request
→ Approve
→ account becomes approved but unverified
→ approval email is sent
→ email contains valid client APK download URL
```

### Client Authentication

```text
Install APK
→ login using website signup credentials
→ login succeeds only after approval
```

### Verification

```text
Approved unverified user
→ request OTP
→ receives 6-character alphanumeric OTP
→ submit correct OTP
→ email becomes verified
```

Also verify:

```text
incorrect OTP → rejected
expired OTP → rejected
different case → rejected
new OTP invalidates previous OTP
verified user cannot unnecessarily re-verify
```

### Authorization

```text
approved + unverified
→ investment functionality blocked

approved + verified
→ investment functionality enabled
```

### APK

Confirm the download link from the approval email actually downloads/opens the correct **client APK** through the same source used by the application's update/release mechanism.

---

# 23. Build and Regression Verification

Run the relevant:

* backend tests;
* frontend/admin tests;
* client app tests;
* type checking;
* linting;
* builds;
* database migration checks.

Also inspect for dead references after removing legacy onboarding code.

Search for obsolete routes/types/functions/components remaining after refactoring.

Do not leave the repository in a state where removed frontend flows still call removed backend endpoints.

---

# 24. Security Requirements

Do not:

* expose `.env` contents;
* commit SMTP credentials;
* send SMTP credentials to frontend/mobile code;
* log OTP values;
* return OTP values in API responses;
* trust client-supplied verification status;
* allow mobile UI state alone to grant investment access;
* generate predictable OTPs;
* let pending/rejected users bypass approval;
* mark users verified merely because an email was successfully delivered.

All critical authorization and verification state must be enforced server-side.

---

# 25. Expected Final Result

There should be only one client onboarding flow:

```text
1. Client signs up through beonedge.in

2. Signup appears in:
   Admin → Approvals

3. Admin sees only:
   Approve
   Reject

4. Reject:
   → reject immediately
   → no message/reason required

5. Approve:
   → client becomes approved but unverified
   → approval email sent
   → email contains client APK download link

6. Client downloads and installs BeOnEdge app

7. Client logs in using the exact credentials created during website signup

8. Client selects Verify Email

9. Backend sends a cryptographically secure:
   6-character
   case-sensitive
   alphanumeric OTP

10. Client submits OTP

11. Backend verifies OTP

12. Client becomes:
    approved + email verified / KYC complete

13. Investment and other verified-client services become available
```

All alternative or obsolete onboarding methods that conflict with this flow should be removed.

---

# 26. Final Report

Once implementation is complete, provide a concise technical report containing:

1. **Existing flow discovered**

   * explain how onboarding worked before modification.

2. **Files changed**

   * list files/modules changed.

3. **Legacy code removed**

   * identify obsolete onboarding/email-verification flows removed.

4. **State model**

   * explain how pending, rejected, approved-unverified, and approved-verified are represented.

5. **Approval flow**

   * explain what happens transactionally when Approve is clicked.

6. **APK distribution**

   * explain where the client APK comes from;
   * explain how the download URL is generated;
   * explain how it relates to the existing application-update mechanism.

7. **SMTP implementation**

   * explain which existing SMTP configuration was reused;
   * DO NOT reveal credentials.

8. **OTP implementation**

   * generation mechanism;
   * expiration;
   * storage;
   * invalidation;
   * retry/rate-limit behavior.

9. **Authorization**

   * explain where investment access is blocked until verification.

10. **Tests performed**

    * commands/tests/builds executed and their results.

11. **Remaining issues**

    * mention anything that could not safely be removed or any assumptions that remain.

Do not stop after merely documenting the implementation.

Inspect the repository, modify the necessary components, remove conflicting legacy flows, run the relevant tests/builds, and leave the development stack with this onboarding flow implemented end-to-end.


# Additional Execution Instructions

## Use Installed Skills

This environment has multiple development/engineering skills already installed.

Before modifying the application:

* Inspect the available skills relevant to this task.
* Use applicable skills for backend, frontend, database, testing, security, deployment, infrastructure, and code inspection.
* Follow the instructions defined by those skills.
* Prefer existing skills and project tooling over introducing unnecessary new tools.
* Use skills selectively based on the task being performed.

---

## IMPORTANT: Preserve the Existing Signup Request Pipeline

The following pipeline is already working correctly:

```text
Client signs up on beonedge.in
        ↓
Signup request reaches the application
        ↓
Request appears in:
Admin Panel → Approvals
```

**Do NOT modify this pipeline.**

Specifically, do not unnecessarily change:

* the landing-page signup flow;
* how `beonedge.in` submits signup requests;
* how those requests reach the backend/application;
* how pending signup requests are delivered to the Admin Approvals page.

Treat this as the established working boundary:

```text
New signup request → visible in Admin Approvals
```

Everything **after the request reaches the Approvals page** is part of this task.

Do NOT assume that the current Approve or Reject functionality works correctly.

Inspect, replace, fix, or remove the existing approval/rejection implementation as necessary to produce the required flow:

```text
Pending request in Approvals
        ↓
   Approve / Reject
        ↓
Approval workflow / Rejection workflow
```

The approval behavior described in the main task must therefore be implemented and verified, not merely reused without inspection.

---

## IMPORTANT: Inspect SMTP Before Implementing Email Logic

Before changing or implementing email functionality, inspect the currently deployed SMTP configuration.

Connect to the VPS using:

```bash
ssh beonedge
```

Inspect:

```text
/srv/dev_stack/BOE_APP/dev_release/.env
```

Never print, expose, log, or commit secrets found there.

Verify:

* SMTP host;
* SMTP port;
* SMTP username/sender configuration;
* SSL/TLS mode;
* relevant environment variable names;
* which service/container consumes those variables;
* whether an existing backend mail module already exists.

The expected provider is **Zoho Mail** using port `465`, but verify the actual deployed configuration.

---

## Verify SMTP Runtime Health

Do not stop at reading `.env`.

Determine whether SMTP/email delivery is currently operational.

Check, where appropriate:

* relevant containers/services;
* container health/status;
* backend startup/runtime logs;
* SMTP initialization errors;
* network connectivity to the configured SMTP host and port;
* SSL/TLS negotiation configuration;
* authentication/configuration errors;
* existing mail-service implementation and its current usage.

If safe, perform a non-destructive connectivity/configuration test.

Do not expose credentials and do not send uncontrolled test emails to real clients.

If SMTP is broken, identify and fix the application/configuration issue required for this onboarding flow.

Include SMTP health and findings in the final implementation report.

---

## Exact Scope Boundary

Preserve:

```text
beonedge.in signup
        ↓
Request reaches Admin Approvals
```

Implement/fix everything from here onward:

```text
Admin Approvals
        ↓
Approve / Reject
        ↓
Approval Email
        ↓
Client APK Download
        ↓
Client Login
        ↓
OTP Email Verification
        ↓
Verified / KYC Complete
        ↓
Investment Services Enabled
```

Do not modify the already-working signup-request delivery pipeline unless inspection reveals a change is strictly necessary to support the required downstream behavior.
