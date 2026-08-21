# SPECIAL NOTE — STRICT INSTRUCTIONS FOR AI AGENTS

The following instructions are mandatory and must be treated as hard constraints throughout the entire task. Do not ignore, reinterpret, relax, or override them unless explicitly instructed by the user.

## 1. Do Not Write Comments in Source Code

Do not add comments to any source code file.

This includes, but is not limited to:

* Inline comments
* Block comments
* Explanatory comments
* TODO comments
* FIXME comments
* NOTE comments
* Temporary debugging comments
* Comments describing obvious code behavior
* Comments explaining implementation decisions
* Commented-out code
* Documentation-style comments embedded directly in source files
* AI-generated explanatory notes inside code

Examples of prohibited additions include:

```text
// Fetch user from database
// TODO: improve this later
// Validate token before continuing
/* Handles authentication logic */
# Temporary workaround
```

Source code should remain self-explanatory through:

* Clear function names
* Clear variable names
* Proper module boundaries
* Small and focused functions
* Appropriate types and interfaces
* Good architectural structure

If an implementation requires explanation, provide that explanation in the agent's final response, implementation summary, documentation file, or task report instead of inserting comments into source code.

Do not modify existing comments solely for stylistic reasons unless they are directly involved in the requested change.

Do not introduce commented-out legacy code as a backup. Use version control for historical code.

---

## 2. Do Not Create Tests by Default

Do not create new test files for ordinary functionality.

Do not automatically generate tests simply because:

* A function was added
* A component was modified
* A bug was fixed
* An API endpoint was changed
* A service was refactored
* Validation logic was updated
* A UI flow was modified
* A new feature was implemented

Avoid unnecessary test-file proliferation.

Tests should only be created when they provide significant protection against a genuinely critical failure.

---

## 3. Create Tests Only for Highly Critical or Security-Sensitive Logic

New tests may be written only when the affected logic is highly critical, security-sensitive, or capable of causing severe consequences if it fails.

Examples where tests are justified include:

### Authentication and Authorization

* Login authentication
* Access-token validation
* Refresh-token handling
* Session validation
* Role-based access control
* Permission enforcement
* Privilege escalation prevention
* Admin-only operations

### Payment and Financial Logic

* Payment verification
* Payment gateway webhook authentication
* Transaction-state transitions
* Duplicate payment prevention
* Refund processing
* Balance updates
* Ledger integrity
* Investment allocation
* Fund movement
* Financial calculations where incorrect results could cause monetary loss

### Security-Critical Validation

* Signature verification
* HMAC/SHA verification
* Cryptographic validation
* API request authentication
* Webhook authenticity verification
* Secret handling
* Replay-attack prevention
* CSRF/security-token validation
* Authorization boundaries

### Data Integrity

* Operations capable of corrupting persistent data
* Destructive database actions
* Irreversible state transitions
* Idempotency guarantees for critical operations
* Race-condition-sensitive financial operations
* Concurrency logic that could duplicate or lose transactions

### Critical Infrastructure Logic

* Production deployment safety mechanisms
* Rollback mechanisms
* Secrets or credential handling
* Critical configuration validation
* Backup/restore integrity
* Infrastructure controls where failure could expose the system or cause significant downtime

---

## 4. Do Not Create Tests for Low-Risk Changes

Do not create dedicated tests for changes such as:

* Styling
* Layout
* UI spacing
* Typography
* Icons
* Labels
* Text changes
* Basic component rendering
* Simple data formatting
* Non-critical helper functions
* Minor refactoring
* File reorganization
* Simple CRUD functionality
* Cosmetic bugs
* Navigation adjustments
* Logging changes
* Non-security-sensitive validation
* Straightforward configuration changes

Existing test files may be updated only when the requested implementation directly causes an existing relevant test to become invalid or when preserving existing critical coverage requires an update.

---

## 5. Prefer Minimal and Targeted Critical Tests

When a test is genuinely necessary, create only the minimum number of tests required to protect the critical behavior.

Do not create large test suites unnecessarily.

Tests should focus on:

* Security boundaries
* Failure conditions
* Invalid or malicious inputs
* Unauthorized access
* Duplicate operations
* Incorrect state transitions
* Financial integrity
* Authentication failures
* Signature-validation failures
* Critical edge cases

Avoid testing implementation details that do not affect system correctness or security.

---

## 6. Existing Tests Must Not Be Removed Without Reason

Do not delete, disable, skip, or weaken existing tests merely to make an implementation pass.

If an existing test fails after a legitimate change:

1. Determine whether the implementation is incorrect.
2. Determine whether the test represents outdated behavior.
3. Update the test only when the expected system behavior has intentionally changed.
4. Do not bypass the test with mocks, skips, ignored assertions, or weakened conditions merely to obtain a passing result.

Security-related tests must receive additional scrutiny before modification.

---

## 7. Do Not Add Placeholder Tests

Never create meaningless tests solely to increase coverage or satisfy tooling.

Do not add tests such as:

```text
expect(true).toBe(true)
```

or equivalent placeholder assertions.

Every new test must protect a specific, meaningful, critical behavior.

---

## 8. Final Decision Rule

Before creating any new test file, ask:

> "Could failure of this logic realistically cause a security vulnerability, unauthorized access, financial loss, corrupted critical data, irreversible incorrect state, or severe production impact?"

If the answer is **no**, do not create the test file.

If the answer is **yes**, create only the smallest targeted test necessary to protect that critical behavior.

---

# NON-NEGOTIABLE SUMMARY

These rules take priority during implementation:

1. **Do not add comments to source code files.**
2. **Do not create tests for normal functionality.**
3. **Create tests only for highly critical, security-sensitive, financial, authentication, authorization, data-integrity, or similarly high-risk logic.**
4. **Keep any necessary tests minimal and directly targeted at the critical risk.**
5. **Do not remove or weaken existing meaningful tests merely to make changes pass.**
6. **Keep source code clean and self-explanatory through naming, structure, typing, and modular design instead of comments.**

These constraints must be followed throughout repository inspection, implementation, refactoring, debugging, and finalization.
