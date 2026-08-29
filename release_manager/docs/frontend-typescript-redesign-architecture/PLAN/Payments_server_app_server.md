````md
# IMPLEMENTATION CONTEXT — CENTRALIZED PAYMENT SERVICE ON `beonedge.in`

## Status

This document supersedes the earlier interpretation of the PhonePe relay architecture.

The architecture is now intentionally broader than a simple one-time-payment relay.

The final goal is:

> **ALL PhonePe-related functionality — one-time payments, AutoPay, mandates, recurring collections, refunds, status checks, callbacks, reconciliation with PhonePe, OAuth, credentials, and any future PhonePe payment feature — must live behind the approved `beonedge.in` payment service.**

Neither:

- `dev-app.beonedge.in`
- `app.beonedge.in`

should contain or directly execute **anything PhonePe-specific** after the migration.

The BOE applications should only understand our own internal payment contract.

They should not know or care whether the underlying provider is PhonePe.

---

# 1. CURRENT DOMAIN STRUCTURE

The organization owns and controls:

```text
beonedge.in
www.beonedge.in
dev-app.beonedge.in
app.beonedge.in
````

Current roles:

```text
beonedge.in / www.beonedge.in
    Landing website
    PhonePe-approved domain
    Future centralized payment service entry point

dev-app.beonedge.in
    Development/testing BOE application

app.beonedge.in
    Production BOE application
```

PhonePe has currently approved:

```text
beonedge.in
```

The BOE application currently attempts payments from:

```text
dev-app.beonedge.in
```

and PhonePe reports:

```text
INTERNAL_SECURITY_BLOCK_1
Transacting_URL: https://dev-app.beonedge.in/
```

`app.beonedge.in` is intended for production but is not currently separately approved.

Getting additional approval from PhonePe is possible, but it may take approximately 7+ days, while the current production deadline is before 3 September 2026.

---

# 2. CURRENT PHONEPE WEBHOOK STATE

The PhonePe webhook has already been moved to the approved domain.

The currently enabled PhonePe webhook is:

```text
https://www.beonedge.in/api/v1/provider-events/phonepe/payment
```

This is configured directly inside the PhonePe Business dashboard.

Therefore this path already exists conceptually:

```text
PhonePe
   |
   v
www.beonedge.in
```

Previous testing showed that changing the webhook alone did not change:

```text
Transacting_URL
```

This only proves:

```text
Moving the webhook alone is insufficient.
```

It does NOT prove:

```text
Moving the entire PhonePe integration to beonedge.in cannot work.
```

That distinction is important.

---

# 3. IMPORTANT CORRECTION TO THE PREVIOUS PLAN

Any previous report containing a conclusion similar to:

```text
Phase 0 failed, therefore the relay will achieve nothing.
```

must be treated as premature.

Phase 0 changed the webhook/callback topology.

It did NOT completely test an architecture where:

```text
checkout creation
redirect URLs
callbacks
refunds
status calls
AutoPay
mandates
recurring collections
provider reconciliation
PhonePe OAuth
PhonePe credentials
```

all originate from or terminate at the approved `beonedge.in` payment service.

The old experiment and logs must be preserved, but the conclusion should be corrected.

---

# 4. THE FINAL ARCHITECTURAL RULE

The architecture should follow one simple rule:

> **Only the `beonedge.in` payment service may communicate with PhonePe.**

Everything else communicates with our own payment service.

Conceptually:

```text
                         PHONEPE
                            ^
                            |
                            |
                  PhonePe-specific protocol
                            |
                            |
                 +----------+-----------+
                 |                      |
                 |   PAYMENT SERVICE    |
                 |                      |
                 |    beonedge.in       |
                 |                      |
                 +----------+-----------+
                            ^
                            |
                  internal BOE protocol
                            |
             +--------------+--------------+
             |                             |
             |                             |
    dev-app.beonedge.in           app.beonedge.in
        development                   production
```

The BOE applications must never communicate directly with PhonePe after migration.

---

# 5. ZERO PHONEPE KNOWLEDGE INSIDE BOE APP

After the migration, neither the development nor production BOE backend should contain:

```text
PhonePe SDK
PhonePe API client
PhonePe OAuth implementation
PhonePe credentials
PhonePe callback credentials
PhonePe webhook verification
PhonePe-specific refund logic
PhonePe-specific status calls
PhonePe-specific AutoPay API logic
PhonePe-specific mandate logic
PhonePe-specific recurring collection logic
PhonePe-specific provider URLs
PHONEPE_* environment variables
```

The BOE application should instead contain only generic payment-service integration such as:

```text
PAYMENTS_SERVICE_URL
PAYMENTS_SERVICE_SECRET
```

or another equivalent internal-service authentication mechanism.

The application's business code should communicate through abstractions such as:

```text
PaymentGateway
RecurringPaymentGateway
PaymentService
```

but their implementations should speak only to our own centralized payment service.

---

# 6. WHAT `beonedge.in` PAYMENT SERVICE OWNS

The payment service on `beonedge.in` owns the complete provider-facing payment process.

This includes:

## One-time payments

```text
create checkout
obtain PhonePe checkout URL
manage provider order IDs
query payment status
process provider responses
verify callbacks
refund
refund status
provider reconciliation
```

## AutoPay / recurring payments

```text
mandate creation
mandate authorization
mandate status
mandate callbacks
recurring collection initiation
collection status
subscription events
AutoPay provider callbacks
pause/cancel/revoke operations where applicable
provider reconciliation
```

## Provider infrastructure

```text
PhonePe credentials
PhonePe OAuth/access tokens
PhonePe API URLs
PhonePe SDK/API client
PhonePe callback verification
PhonePe signature verification
PhonePe-specific request schemas
PhonePe-specific response schemas
PhonePe-specific error handling
PhonePe-specific retry handling
PhonePe provider identifiers
```

The BOE applications should never need these details.

---

# 7. IMPORTANT DISTINCTION — PAYMENT PROCESS VS FINANCIAL RECORDS

The `beonedge.in` payment service owns the **payment-provider process**.

The BOE application remains the owner of **business and financial records**.

That means BOE continues storing authoritative application records such as:

```text
investment_orders
payments
payment_attempts
investment_allocations
SIP records
client investment records
transaction history
statements
audit records
business-level payment state
idempotency records
```

The payment service should not become a competing financial ledger.

Conceptually:

```text
BOE APP
    owns:
        who is paying
        what they are paying for
        investment order
        amount
        payment attempt
        SIP instruction
        allocation
        client account
        accounting/business status

PAYMENT SERVICE
    owns:
        how the payment is executed through PhonePe
        provider authentication
        provider request
        provider response
        callback validation
        mandate handling
        collection handling
        refund execution
        provider status/reconciliation
```

---

# 8. PAYMENT SERVICE MAY KEEP OPERATIONAL STATE

The payment service is not required to be literally memoryless.

It may maintain operational/provider state required to safely operate PhonePe.

Examples include:

```text
OAuth token cache
provider request correlation
nonce/replay cache
short-lived checkout context
provider mandate identifiers
provider order identifiers
provider refund identifiers
provider event deduplication metadata
retry metadata
```

However, it must not become the authoritative source for client financial/accounting records.

If persistent provider metadata is required for AutoPay or reconciliation, it may be stored inside the payment service, but BOE remains the authoritative business/financial system of record.

---

# 9. GENERIC INTERNAL PAYMENT CONTRACT

The BOE application should not call endpoints named around PhonePe wherever avoidable.

Prefer provider-neutral APIs.

For example:

```text
POST /internal/v1/payments/checkout
POST /internal/v1/payments/status
POST /internal/v1/payments/refund
POST /internal/v1/payments/refund-status
```

AutoPay:

```text
POST /internal/v1/autopay/mandates
POST /internal/v1/autopay/mandates/status
POST /internal/v1/autopay/mandates/cancel
POST /internal/v1/autopay/collections
POST /internal/v1/autopay/collections/status
```

The BOE application should send business/payment identifiers and required details.

The payment service translates these into PhonePe-specific requests.

---

# 10. ONE-TIME PAYMENT FLOW

Target flow:

```text
Client
   |
   v
dev-app / app
   |
   v
BOE backend
   |
   | create internal payment record
   | generate merchantOrderId
   |
   v
beonedge.in payment service
   |
   | PhonePe checkout API
   |
   v
PhonePe
   |
   | checkout URL
   |
   v
beonedge.in payment service
   |
   | normalized acknowledgement
   |
   v
BOE backend
   |
   v
Client
```

The payment service may return:

```text
checkout created
checkout URL
provider reference
expiration
normalized provider state
```

The BOE application then stores whatever business-side record is required.

---

# 11. `merchantOrderId` OWNERSHIP

`merchantOrderId` must remain BOE-owned.

Example:

```text
BOE generates:

BOE-ORDER-123456
```

Then:

```text
BOE
  |
  | BOE-ORDER-123456
  v
Payment Service
  |
  | BOE-ORDER-123456
  v
PhonePe
```

The payment service must never silently replace it with another merchant order ID.

This preserves:

```text
idempotency
retry safety
payment_attempt dispatch claims
migration 043 behavior
reconciliation
auditability
duplicate-payment protection
```

Provider-specific IDs may also exist, but they are separate from the BOE merchant order ID.

---

# 12. CHECKOUT ACKNOWLEDGEMENT IS NOT PAYMENT SUCCESS

The following:

```text
PhonePe created checkout successfully
```

must never be treated as:

```text
payment completed
```

A response such as:

```text
CHECKOUT_CREATED
checkoutUrl
providerOrderId
expiresAt
```

means only that the provider accepted the payment initiation.

Final payment success must come from trusted provider evidence handled by the payment service, such as:

```text
verified PhonePe callback
PhonePe order-status query
provider reconciliation
```

The payment service then sends the normalized final result to BOE.

---

# 13. CALLBACK OWNERSHIP CHANGES COMPLETELY

Because BOE must contain no PhonePe-specific implementation, callback verification belongs entirely inside the centralized payment service.

Target:

```text
PhonePe
   |
   | PhonePe callback
   v
beonedge.in payment service
   |
   | verify PhonePe authentication/signature
   | validate payload
   | perform provider-level deduplication where required
   |
   v
normalized authenticated BOE event
   |
   v
BOE backend
```

BOE should NOT need to verify PhonePe signatures after the migration.

BOE verifies only that:

```text
this event genuinely came from our payment service
```

For example using:

```text
HMAC
mTLS
private service network
or equivalent service authentication
```

The payment service verifies:

```text
this event genuinely came from PhonePe
```

This maintains a clean provider abstraction boundary.

---

# 14. NORMALIZED CALLBACK / EVENT MODEL

PhonePe-specific webhook bodies should not leak throughout BOE business logic.

The payment service should normalize provider events into our internal schema.

Conceptually:

```json
{
  "eventId": "internal-event-id",
  "paymentId": "BOE-payment-id",
  "merchantOrderId": "BOE-ORDER-123",
  "type": "PAYMENT_COMPLETED",
  "status": "SUCCESS",
  "providerReference": "...",
  "occurredAt": "...",
  "metadata": {}
}
```

AutoPay example:

```json
{
  "eventId": "...",
  "mandateId": "BOE-MANDATE-123",
  "type": "MANDATE_ACTIVATED",
  "status": "ACTIVE",
  "providerReference": "...",
  "occurredAt": "..."
}
```

Recurring collection example:

```json
{
  "eventId": "...",
  "collectionId": "BOE-COLLECTION-123",
  "type": "AUTOPAY_COLLECTION_COMPLETED",
  "status": "SUCCESS",
  "providerReference": "...",
  "occurredAt": "..."
}
```

BOE business logic should respond to our internal event vocabulary, not PhonePe-specific status names.

---

# 15. CALLBACK DELIVERY TO BOE

The payment service should securely deliver payment events back to the appropriate BOE backend.

Conceptually:

```text
PhonePe
   |
   v
beonedge.in payment service
   |
   +------------------------+
   |                        |
   v                        v
dev BOE backend        prod BOE backend
```

The destination must be determined from trusted transaction/service context.

Do not allow arbitrary callback destination URLs supplied by clients.

---

# 16. CALLBACK DURABILITY

Payment events must not disappear just because BOE is temporarily unavailable.

The implementation should determine the simplest reliable mechanism compatible with the current codebase.

Possible approaches include:

```text
synchronous forwarding + upstream provider retries
```

or, if necessary:

```text
small durable delivery/retry mechanism in payment service
```

Do not introduce large infrastructure without need.

However, because the payment service now takes ownership of the provider-facing payment process, it is acceptable for it to maintain enough delivery state to ensure that a verified provider event eventually reaches BOE.

BOE idempotency must make duplicate internal events safe.

---

# 17. PAYMENT STATUS / RECONCILIATION

No BOE worker may directly call PhonePe after migration.

If BOE needs a payment status:

```text
BOE
   |
   v
Payment Service
   |
   v
PhonePe
```

Never:

```text
BOE
   |
   v
PhonePe
```

The same applies to:

```text
order status
refund status
mandate status
AutoPay collection status
subscription status
```

The payment service owns provider reconciliation.

BOE may request reconciliation using its own identifiers.

Example:

```text
POST /internal/v1/payments/status

{
    "merchantOrderId": "BOE-ORDER-123"
}
```

The service resolves whatever PhonePe-specific data is required.

---

# 18. AUTOPAY MUST MOVE AS PART OF THIS ARCHITECTURE

AutoPay is no longer considered optional or a later unrelated migration.

The final architecture requires:

> **All PhonePe AutoPay functionality must also live at `beonedge.in`.**

Existing code should be inspected for components such as:

```text
phonePeRecurringGateway
mandates
subscription callbacks
collections worker
SIP workers
AutoPay status logic
recurring collection logic
PHONEPE_AUTOPAY_ENABLED
PhonePe mandate environment variables
```

Determine exactly what exists and what is currently active.

Then migrate the PhonePe-specific portion behind the centralized payment service.

---

# 19. SIP / AUTOPAY BUSINESS FLOW

The BOE application may still decide:

```text
which client has a SIP
when a SIP is due
how much is due
what fund/investment it belongs to
whether the SIP is active
business-level scheduling
```

But when payment execution is required:

```text
BOE SIP worker
   |
   | internal collection instruction
   v
beonedge.in payment service
   |
   | PhonePe AutoPay API
   v
PhonePe
```

Then:

```text
PhonePe
   |
   | collection/mandate callback
   v
beonedge.in payment service
   |
   | verified + normalized
   v
BOE backend
   |
   v
SIP/payment/investment records updated
```

---

# 20. MANDATE FLOW

Conceptually:

```text
BOE
   |
   | create mandate request
   v
Payment Service
   |
   | PhonePe mandate API
   v
PhonePe
   |
   | mandate authorization / callback
   v
Payment Service
   |
   | normalized mandate event
   v
BOE
```

BOE should not need to understand PhonePe mandate request/response formats.

---

# 21. REFUNDS

Refunds must follow the same abstraction.

BOE:

```text
refund this payment
```

Payment service:

```text
determine provider information
construct PhonePe refund request
authenticate
submit refund
track provider refund
normalize result
```

BOE never calls PhonePe directly.

---

# 22. BROWSER RETURN URL

PhonePe should preferably receive only an approved-domain return URL.

For example:

```text
https://www.beonedge.in/payment-return
```

not:

```text
https://dev-app.beonedge.in/payment-status
```

and not:

```text
https://app.beonedge.in/payment-status
```

Target:

```text
PhonePe
   |
   v
https://www.beonedge.in/payment-return
   |
   +---- development payment
   |         |
   |         v
   |   https://dev-app.beonedge.in/payment-status
   |
   +---- production payment
             |
             v
       https://app.beonedge.in/payment-status
```

---

# 23. DO NOT IMPLEMENT AN OPEN REDIRECT

Never accept something like:

```text
?returnUrl=https://anything.example
```

The return destination must come from trusted server-side state or a hardcoded/configured allowlist.

Currently valid destinations are:

```text
https://dev-app.beonedge.in
https://app.beonedge.in
```

The payment service should decide the final application destination based on trusted transaction context.

---

# 24. FRONTEND MUST NOT TALK DIRECTLY TO PAYMENT SERVICE

The preferred path is:

```text
Frontend
   |
   v
BOE backend
   |
   v
Payment Service
   |
   v
PhonePe
```

Do not expose the internal payment initiation API directly to browsers unless there is a very specific requirement.

The BOE backend owns client authentication and business authorization.

The payment service trusts authenticated BOE services, not arbitrary browsers.

---

# 25. CURRENT SAME-VPS ARCHITECTURE

Currently:

```text
beonedge.in
dev-app.beonedge.in
future app.beonedge.in
```

are deployed on the same VPS/machine.

Therefore internal requests do not need to travel through the public internet.

Use a shared private Docker/internal network.

Example:

```text
BOE backend
    |
    | private Docker network
    v
payment-service
```

Conceptual URL:

```text
http://payment-service:<port>/internal/v1/payments/checkout
```

The internal initiation APIs should not be publicly exposed.

---

# 26. PUBLIC VS PRIVATE ROUTES

Public routes may include only things that genuinely require internet access.

For example:

```text
/api/v1/provider-events/phonepe/payment
/api/v1/provider-events/phonepe/subscription
/payment-return
```

because:

```text
PhonePe needs callback access
browser needs redirect-return access
```

Private routes include:

```text
/internal/v1/payments/*
/internal/v1/autopay/*
```

These should not be reachable from the public internet.

---

# 27. PAYMENT SERVICE SHOULD BE SEPARATE FROM LANDING WEBSITE PROCESS

Although the payment service uses the approved `beonedge.in` domain, it does not have to run inside the same application process as the marketing landing page.

Preferred deployment:

```text
                       nginx
                         |
              +----------+----------+
              |                     |
              v                     v

        normal website        payment routes
              |                     |
              v                     v

        boe_landing          payment-service
        container              container
```

For example:

```text
https://www.beonedge.in/
    -> landing site

https://www.beonedge.in/payment-return
    -> payment service

https://www.beonedge.in/api/v1/provider-events/phonepe/*
    -> payment service
```

This keeps payment logic isolated while still presenting the approved domain to PhonePe.

---

# 28. FUTURE DISTRIBUTED ARCHITECTURE

The internal contract should be designed so that moving services to different machines later does not require redesigning payment logic.

Today:

```text
same VPS
private Docker network
```

Future:

```text
BOE application server
        |
        | private authenticated connection
        v
Payment infrastructure server
```

Possible future transport:

```text
WireGuard
Tailscale
private VLAN
mTLS
private cloud network
```

Do not couple the contract to Docker-specific assumptions.

---

# 29. SERVICE AUTHENTICATION

Do not rely on browser `Origin`.

This is server-to-server communication.

Current recommended model:

```text
private network
+
HMAC authentication
+
timestamp
+
nonce / replay protection
```

Conceptual headers:

```text
X-BOE-Service
X-BOE-Timestamp
X-BOE-Nonce
X-BOE-Signature
```

Possible signature:

```text
HMAC-SHA256(
    secret,
    METHOD +
    PATH +
    TIMESTAMP +
    NONCE +
    SHA256(RAW_BODY)
)
```

Reject:

```text
invalid signature
stale timestamp
reused nonce
unknown service
malformed payload
```

---

# 30. DEVELOPMENT AND PRODUCTION SEPARATION

Do not allow an arbitrary browser field such as:

```json
{
    "environment": "prod"
}
```

to decide which credentials or backend receives an event.

Environment must come from trusted service identity/configuration.

Conceptually:

```text
dev BOE backend
    |
    | DEV service credentials
    v
payment service
    |
    v
development/sandbox configuration
```

and:

```text
prod BOE backend
    |
    | PROD service credentials
    v
payment service
    |
    v
production configuration
```

Development and production identifiers must not collide.

---

# 31. PHASE 0.5 — DECISIVE DOMAIN TEST

Before performing a very large refactor, run the strongest possible minimal test of the approved-domain hypothesis.

The existing PhonePe webhook is already:

```text
https://www.beonedge.in/api/v1/provider-events/phonepe/payment
```

For one ₹1 transaction, ensure that every PhonePe-visible URL in checkout creation is also on:

```text
beonedge.in
```

For example:

```text
redirectUrl:
https://www.beonedge.in/payment-return
```

Do NOT send:

```text
dev-app.beonedge.in
```

inside the PhonePe checkout request.

The BOE backend may still internally initiate the test.

Then inspect:

```text
Transacting_URL
```

---

# 32. PHASE 0.5 POSSIBLE RESULTS

## Result A

PhonePe reports:

```text
Transacting_URL: https://www.beonedge.in/
```

or:

```text
Transacting_URL: https://beonedge.in/
```

This strongly confirms that moving the complete PhonePe-facing integration to the approved domain solves the current domain issue.

Proceed with the architecture immediately.

## Result B

PhonePe still reports:

```text
Transacting_URL: https://dev-app.beonedge.in/
```

Then search for the remaining source.

Investigate:

```text
runtime environment variables
merchant URLs
PhonePe merchant configuration
dashboard configuration
application registration
database values
checkout request construction
redirect URL construction
deployment configuration
provider config
frontend-generated values
backend-generated values
```

Do not guess.

Determine exactly where the value originates.

---

# 33. SEARCH THE CURRENT CODE FOR `dev-app.beonedge.in`

Before migration, perform a complete runtime-oriented search for:

```text
dev-app.beonedge.in
```

Also inspect variables that can generate it indirectly.

Find all usages in:

```text
frontend
backend
environment variables
docker compose
nginx
database configuration
payment provider code
checkout code
redirect code
callback code
tests
deployment scripts
release config
documentation
```

Classify every occurrence as:

```text
runtime active
runtime inactive
test only
documentation only
stale/dead
```

The purpose is to find all possible inputs into the PhonePe checkout process.

---

# 34. MAINTENANCE PHILOSOPHY

BeOnEdge is currently a small firm.

Do NOT build unnecessary infrastructure such as:

```text
Kubernetes
multi-region active-active
Kafka for trivial events
large HA clusters
complex orchestration
enterprise-scale payment infrastructure
```

Scheduled payment maintenance is acceptable.

Clients may be informed ahead of time.

Terms may state that payment initiation can temporarily be unavailable during scheduled maintenance.

---

# 35. PAYMENT MAINTENANCE GUARD

Implement a simple payment maintenance state.

Recommended:

```text
NORMAL
    |
    v
PAYMENTS_DRAINING
    |
    v
MAINTENANCE
    |
    v
RECONCILING
    |
    v
NORMAL
```

Approximately 30-60 minutes before planned maintenance:

```text
disable creation of new payment sessions
```

Existing payments should be allowed time to complete.

During maintenance:

```text
reject new one-time payments
reject new AutoPay setup where appropriate
reject new manual collection initiation where appropriate
```

After maintenance:

```text
reconcile unresolved provider transactions
process pending provider events
confirm pending payment status
confirm pending AutoPay collections
confirm pending mandate state
```

Then:

```text
re-enable payments
```

---

# 36. CLIENT MAINTENANCE NOTICE

The application can display something such as:

```text
Scheduled payment maintenance

New payment requests will be temporarily unavailable between
[START TIME] and [END TIME].

Existing account and investment records remain unaffected.
```

Relevant terms can also disclose planned temporary payment unavailability.

However:

```text
Terms = client expectation

Reconciliation + idempotency + maintenance guard
= financial correctness
```

Do not use contractual wording as a replacement for safe payment handling.

---

# 37. MONITORING REQUIREMENTS

Do not create "DevOps hell".

Current baseline is sufficient:

```text
health endpoint
Docker restart policy
structured logs
persistent logs where already supported
basic monitoring
payment failure/error counters
reconciliation
maintenance mode
```

Do not block the production deadline on unnecessary high-availability infrastructure.

---

# 38. LOGGING REQUIREMENTS

Never log:

```text
PhonePe client secret
OAuth token
callback password
HMAC secret
API credentials
authorization headers
sensitive financial credentials
```

Safe logging may include:

```text
BOE merchantOrderId
BOE payment ID
BOE mandate ID
BOE collection ID
provider reference
provider status
HTTP status
internal event ID
correlation ID
timestamps
state transition
retry count
```

Redact sensitive provider payload fields.

---

# 39. IDEMPOTENCY

Every payment-related internal operation must be safe against retries.

This includes:

```text
checkout creation
PhonePe callback delivery
internal event delivery
refund requests
mandate callbacks
AutoPay collections
status reconciliation
```

Existing BOE idempotency behavior must be preserved.

The payment service must add provider-level idempotency/deduplication where required without defeating BOE's existing guarantees.

---

# 40. INTERNAL EVENT DELIVERY MUST ALSO BE IDEMPOTENT

The payment service may deliver the same event more than once.

BOE must safely detect duplicates.

Use stable identifiers such as:

```text
internal event ID
merchantOrderId
payment ID
mandate ID
collection ID
provider event/reference ID
```

depending on event type.

Never assume callbacks are delivered exactly once.

---

# 41. TARGET END STATE

After this migration, the architecture should look like:

```text
                    PHONEPE
                       |
                       |
            +----------+-----------+
            |                      |
            |   PAYMENT SERVICE    |
            |                      |
            |    beonedge.in       |
            |                      |
            | PhonePe credentials  |
            | PhonePe OAuth        |
            | One-time checkout    |
            | Payment status       |
            | Refunds              |
            | Webhooks             |
            | AutoPay              |
            | Mandates             |
            | Collections          |
            | Provider reconcile   |
            | Provider retries     |
            | Callback validation  |
            |
            +----------+-----------+
                       |
             normalized BOE API
                       |
          +------------+-------------+
          |                          |
          v                          v

 dev-app.beonedge.in          app.beonedge.in
      DEV BOE                    PROD BOE

          |                          |
          |                          |
          +------------+-------------+
                       |
                       v

             BOE BUSINESS DATA

             investment_orders
             payments
             payment_attempts
             SIPs
             mandates/business state
             investment_allocations
             statements
             client records
             audit
```

---

# 42. MOST IMPORTANT BOUNDARY

The final conceptual boundary is:

```text
BOE:
"Collect ₹X against payment/order ID Y."

Payment Service:
"I know how to make that happen through PhonePe."
```

For AutoPay:

```text
BOE:
"Create a mandate for customer/payment instruction X."

Payment Service:
"I know how to create and manage that through PhonePe."
```

For recurring collection:

```text
BOE:
"Collect ₹X for SIP collection Y using mandate Z."

Payment Service:
"I know how to execute that through PhonePe."
```

For refund:

```text
BOE:
"Refund ₹X against payment Y."

Payment Service:
"I know how to execute the provider refund."
```

BOE should not care about PhonePe protocol details.

---

# 43. PROVIDER REPLACEMENT SHOULD BECOME POSSIBLE

Although PhonePe is currently the provider, structure the internal interface so the application is not permanently coupled to it.

Future conceptual possibility:

```text
BOE
 |
 v
Payment Service
 |
 +---- PhonePe
 |
 +---- another provider
```

Do NOT build multi-provider support right now unless necessary.

Simply avoid unnecessarily leaking PhonePe-specific schemas into BOE.

---

# 44. IMPLEMENTATION ORDER

Proceed in this order.

## Step 1 — Investigate runtime

Find exactly:

```text
how current one-time payment works
how current AutoPay works
where PhonePe credentials live
where redirect URL is generated
where dev-app.beonedge.in enters the flow
where callbacks are handled
where refunds are handled
where status checks occur
where recurring collections occur
where mandate state is handled
which workers directly talk to PhonePe
```

Produce a code-accurate map.

## Step 2 — Run Phase 0.5

Use:

```text
beonedge.in webhook
beonedge.in redirect URL
no dev-app URL inside PhonePe checkout request
```

Perform ₹1 test.

Record:

```text
request shape
safe relevant configuration
HTTP result
PhonePe error
Transacting_URL
```

Do not log secrets.

## Step 3 — Build centralized payment service

Move:

```text
PhonePe OAuth
credentials
checkout
status
refunds
callback verification
provider handling
```

to the payment service.

## Step 4 — Migrate one-time payments

BOE should call only the generic payment service.

Remove direct PhonePe path once verified.

Do not keep two production paths unnecessarily.

## Step 5 — Migrate AutoPay completely

Move:

```text
PhonePe recurring gateway
mandate provider operations
subscription callbacks
collection provider calls
AutoPay provider status
provider-specific reconciliation
```

to the payment service.

BOE SIP/business scheduling may remain inside BOE.

## Step 6 — Remove PhonePe from BOE

After all required functionality is migrated, remove:

```text
PhonePe provider implementations
PhonePe SDK dependencies
PHONEPE_* environment variables
PhonePe callback verification
PhonePe-specific routes that are no longer needed
direct PhonePe status/refund calls
direct PhonePe recurring calls
```

Do not remove BOE business abstractions or business tables.

## Step 7 — Verification

Verify:

```text
one-time checkout
successful payment
failed payment
cancelled payment
duplicate callback
payment status reconciliation
refund
refund status
mandate creation
mandate activation
mandate failure
AutoPay collection
collection failure
duplicate recurring callback
maintenance mode
post-maintenance reconciliation
DEV/PROD routing
```

---

# 45. DO NOT BREAK EXISTING BUSINESS LOGIC

The goal is to move the provider integration boundary.

Do NOT rewrite unrelated BOE business logic unless required.

Preserve:

```text
order state machine
payment state machine
investment allocation logic
SIP business logic
existing idempotency
existing transaction semantics
audit behavior
client authorization
payment amount validation
database guarantees
```

Where existing logic is flawed, report it separately rather than silently redesigning unrelated behavior.

---

# 46. DOCUMENT EVERYTHING FOUND

Update or create architecture documentation recording:

```text
previous architecture
actual runtime code paths
Phase 0 result
why Phase 0 was inconclusive
Phase 0.5 result
new payment-service boundary
one-time payment flow
AutoPay flow
callback flow
internal authentication
maintenance flow
DEV/PROD routing
files changed
files removed
environment variables removed
environment variables added
nginx changes
Docker network changes
migration considerations
security assumptions
known limitations
```

Preserve previous investigation history rather than rewriting history.

---

# 47. PRIMARY OBJECTIVE

The final objective is not merely:

```text
"make the current ₹1 test pass"
```

The objective is:

> Create one centralized payment infrastructure under the approved `beonedge.in` domain that owns all interaction with PhonePe, while `dev-app.beonedge.in` and `app.beonedge.in` communicate only with our own internal payment API and retain the authoritative BOE business/financial records.

After completion:

```text
dev-app.beonedge.in
app.beonedge.in
```

must have:

```text
ZERO direct PhonePe communication
ZERO PhonePe credentials
ZERO PhonePe SDK/API client
ZERO PhonePe callback verification
ZERO PhonePe-specific AutoPay implementation
ZERO direct PhonePe reconciliation
```

They should only understand:

```text
our payment
our order
our mandate
our collection
our refund
our normalized payment events
our payment service
```

while:

```text
beonedge.in payment service
```

owns the entire external PhonePe payment lifecycle.

That is the target architecture.

```
```
Also don't immediately retire the payment gateway from this repo currently, build the payment server in the boe_landing repo we will test payments and if it succeeds then we will retire the payments gateway from this repo.
