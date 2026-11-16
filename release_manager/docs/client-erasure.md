# Client erasure (Phase G)

Status: built on lane `g-erasure` (tally `M11-phase-g:G-L1-erasure`), reviewed three times and fixed, landed on local `main` at `e29ff37` (2026-11-14), not released. No client has been erased anywhere.
Decision: DEC-29 (behaviour) and DEC-33 (go-ahead), group `admin-improvements`.
This is a destructive change under `RULES.md` rule 11: it deletes and overwrites existing
production rows for the one client an administrator erases. It touches no other client.

## The command

| Item | Behaviour |
| --- | --- |
| Read | `GET /v1/admin/clients/{userId}/erase-check` returns `state` (`erasable`, `blocked`, `already_erased`), the `path` that would run (or ran), `keptBecause`, and every blocking reason. |
| Write | `POST /v1/admin/clients/{userId}/erase` with `Idempotency-Key` and body `{ "confirm": "ERASE", "expectedPath": "deleted" \| "kept_as_record" }`. |
| Permission | `users.close` for both. Only `superadmin` holds it by default, and the closest existing action (A8 contact release) uses it. No new permission was seeded. |
| Confirmation | The literal `ERASE` proves intent; the client id is already in the URL, so retyping it would prove only copy and paste. `expectedPath` binds the confirmation to the outcome the administrator was shown: if the client verified their email, or money was recorded, between the check and the confirm, the command refuses with `STATE_CONFLICT` and changes nothing. The screen then clears the typed word, so a changed outcome must be confirmed again. |
| Transaction | One transaction. Lock order: identity advisory locks for the current email and phone, then the client-position advisory lock of every fund with a ledger row, then `users` `FOR UPDATE`, then the client's `email_deliveries` and their outbox rows `FOR UPDATE` (the order the email worker uses). This is the order `recordContribution`, reversals, maturities and contact corrections already use, so concurrent recording either commits first (and erasure is refused because money is held) or waits and is refused because the account is erased. Sign-in also locks the user row and re-checks the account state. Every client write that creates or changes the client's own rows locks the `users` row first and refuses with `ACCOUNT_NOT_ACTIVE` unless the account is active and not tombstoned, so a write racing an erasure either commits first (and is erased with the rest) or waits and is refused: support tickets, reviews, statement links, the app version report, marking a notification read, and the email verification code request and check (the check now takes the user row before the code row, the order erasure uses). Profile contact changes, password changes and resets, nominee requests and order creation already lock the row; a maturity choice changes only an open offer, which blocks erasure. |
| Idempotency | Durable admin receipt. A replay with the same key returns the first answer. A new key on an erased client answers `200` with `outcome: "already_erased"` and the original time and path, found from the erasure audit row (so it also works after a complete deletion). |
| Audit | Exactly one `client.erased` row per erasure: actor admin, time, entity the erased user id, `metadata: { path, keptBecause }`. No name, email or phone. |
| After erasure | Recording, monthly recordings, SIP schedules and maturity dates refuse an erased client (`requireRecordableClient`), and so do ledger reversals and individual value updates. Collective value updates only touch positions with a value above zero, which an erased client never has. A contact release on an erased account is refused. |

## G1. Guard

Refused with `STATE_CONFLICT`, naming every reason (in `message` and in `fields`, keyed by code), and nothing changes, unless all hold:

| Code | Refused when |
| --- | --- |
| `staff_account` | The account has any `user_roles` row, active or revoked. Staff are never erasable here. |
| `legal_hold` | An unreleased, unexpired `legal_holds` row on any of the client's entities: the user, the linked and matched applications, their email deliveries and those deliveries' provider events, audit rows about the client, and the client's orders, payments, payment attempts, ledger entries, payouts, maturities, schedules, offers, sessions, tickets, reviews, nominee requests (072), refunds, receipts and SIP plans. A hold of type `mandate` is matched through the existing mandate lookup (`findMandateForAdmin`), so the erasure code does not read the mandate tables. |
| `holds_money` | In any fund, the sum of `principal_delta_paise` or of `value_delta_paise` over non-reversal, non-reversed `client_value_entries` is not zero (the same basis as the portfolio position queries). |
| `open_orders` | An order in `submitted`, `payment_pending`, `review_pending`, `refund_pending` or `refund_failed`. |
| `open_payments` | A payment in `created`, `provider_pending`, `refund_pending`, `refund_failed` or `reconciliation_required`; a payment attempt in `created`, `provider_pending` or `reconciliation_required`; or a provider webhook still `received` or `processing`. |
| `open_refunds` | A refund operation `pending` or `provider_pending`. |
| `open_withdrawals` | A withdrawal payout `pending`. |
| `failed_withdrawals` | A withdrawal payout `failed`. The ledger is already debited and the client is still owed the money, so a zero balance does not mean nothing is owed. |
| `unsettled_maturities` | A `client_position_maturities` row `pending`. |
| `active_sip_schedules` | An admin SIP schedule `active`. |
| `scheduled_maturities` | A maturity schedule `scheduled`. |
| `open_maturity_offers` | A Phase F `client_maturity_offers` row `open`. F closes an open offer whenever its maturity is resolved or cancelled, so this also follows from the previous row; it is checked on its own so the reason is named. |
| `active_sip_plans` | A SIP plan in `draft`, `pending_mandate`, `active`, `paused` or `cancel_pending`. The database's deferred SIP and mandate constraint ties every non-final AutoPay mandate to one of these SIP states. |
| `mail_in_flight` | A delivery for the client is `sending`, or its outbox event is `processing` or `sending`. Checked once before and once again after the delivery and outbox rows are locked. Cancelling such mail could record "cancelled" for mail that went out, so erasure waits a minute instead. |

## Paths

- **G2, kept as a record** (`kept_as_record`): the client completed email verification (`users.email_verification_state = 'verified'`, or `email_verified_at` set, or an `email_verification.completed` audit row), or any money row exists. `keptBecause` says which.
- **G3, deleted** (`deleted`): never verified and no row in `client_value_entries`, `investment_orders`, `investment_allocations`, `payments`, `payment_attempts`, `provider_payment_details`, `provider_events`, `withdrawal_operations`, `client_position_maturities`, `client_maturity_schedules`, `client_maturity_offers`, `admin_sip_schedule_months`, `sip_early_exits` or `sip_plans`. Money records are never deleted; their presence falls back to G2 and the answer says `keptBecause: "money_records"`.

Placeholders: the live `users` columns are unique, so the email becomes `released+<id>@released.invalid` and the phone a `+999` number from the A8 release sequence (both refused on every creation and correction path, and already proven against the previous release's lookups by the A8 tests); a test erases two clients and checks both are distinct. Everywhere else the existing tombstone values are used: `tombstone+<id>@invalid.example`, `tombstone`, `Tombstoned`. Contact-history rows get `tombstone-previous` and `tombstone-new` as phones, because `user_contact_history_changed` requires the two sides to differ.

### Known contacts and the text pass

"Known contacts" for one client are: the live email and phone, every email and phone in the contact history, the linked application's email, phone and name, every email typed at a sign-in recorded against the client, and every recipient address and pending email-change target that the current recipient key can decrypt. **Any email or phone that another user holds right now is dropped**, so a contact that was released and reused by someone else is never rewritten anywhere.

The pass then works only on the client's own rows (listed in the table map) and:

- replaces whole emails, case-insensitively and only where no further address characters touch them, and their masked `x***@domain` form;
- replaces phones as `+E.164`, digits without `+`, and the ten-digit national number for `+91`, only between digit boundaries, so no longer number is cut;
- in free text, also replaces the client's full name, case-insensitively and only as whole words;
- in JSON, replaces emails as above but a phone only in its stored `+91…` form, so amounts and other numbers are never hit; sets string values equal to the client's name or nominee to `Tombstoned`; and sets the `name` and `relation` fields directly inside any object under a `nominee` key to `Tombstoned`. A name inside a longer JSON sentence, a national-format phone, and a name or relation nested one object deeper are not replaced.

Phone endings (last four digits) in audit metadata are left: the code already treats them as redactions. Financial identifiers are never rewritten: `withdrawal_operations.transfer_reference` and `provider_payment_details.provider_reference` stay as they are.

**G2 rewrites contact text inside the client's own ledger, withdrawal and maturity notes** (`client_value_entries.note`, `withdrawal_operations.note`, `client_position_maturities.note`, and `fund_receipt_acknowledgements.private_note`), replacing only email, phone and name text. Amounts, dates and ids are unchanged. This is in scope of DEC-29 ("emails and phones erased everywhere").

### Matched applications

Besides the application linked to the account, erasure matches earlier applications **by email only**: not `submitted`, email equal to one of the client's own current or historical emails (which no other user holds, as above), and not linked to another user. A phone alone never matches, since a family can share one. Matched applications are tombstoned in both paths (not deleted, since they are matched by contact only), and their ids join the linked one for the mail erasure or deletion, the review text pass, the outbox, and the audit rows.

## Table map

"Client rows" means rows whose user id, linked or matched application id, delivery, or audit subject is this client, as listed.

| Table | Client data held | G2 kept as a record | G3 deleted |
| --- | --- | --- | --- |
| `users` | email, phone, name, nominee | email and phone to the release placeholders (kept if already released), name `Tombstoned`, nominee cleared by the 063 trigger, `pii_tombstoned_at`, closed (an `invited` account stays invited, since closing needs an activation time), `email_revision` and `version` bumped | deleted |
| `applications`, linked | email, phone, name, password hash | tombstoned under the 024 constraint (placeholders, `password_hash` null) | deleted |
| `applications`, matched by email | same | tombstoned | tombstoned, not deleted |
| `application_consents` (linked and matched applications) | consent IP HMAC, user agent | `user_agent` nulled; the IP HMAC (a keyed hash, required, and the consent's evidence) is kept | deleted |
| `application_reviews` (linked and matched) | admin reason text | contact and name text replaced | linked application's deleted; matched ones' text replaced |
| `user_contact_history` | previous and new emails and phones | all four overwritten through the 069 erase path; `reason_detail` nulled if it names a contact | deleted through the 069 erase path |
| `user_credentials` | password hash | `password_hash` nulled, lockout counters reset, `version` bumped | deleted |
| `auth_sessions`, `auth_refresh_tokens` | IP, user agent | revoked | deleted |
| `auth_login_events` | email typed at sign-in | email to the tombstone placeholder: the client's rows, and rows with no user whose email is one of the client's and is held by no other account | deleted (same selection) |
| `password_credential_tokens`, `email_verification_codes` | link and code hashes | consumed | deleted |
| `client_statement_links` (070, Phase H) | one statement link per client: token hash, covered months, expiry | deleted | deleted. A link needs ledger rows, which force G2, so a G3 client has one only if it was inserted by hand; the delete keeps the 070 `ON DELETE RESTRICT` key from blocking |
| `email_change_requests` | encrypted target email | retired; target re-encrypted as the placeholder | deleted |
| `email_deliveries` (user, linked or matched application, every template including Phase F `maturity_options` and Phase I `sip_early_exit`) | encrypted recipient, recipient HMAC, masked recipient, encrypted failure detail | locked; queued and retryable cancelled (with their outbox events); recipient and failure envelopes nulled, HMAC and masked value set to the placeholder's, `erased_at` | deleted |
| `email_delivery_payloads` | sealed names, links and nominee decline reasons | scrubbed (`scrubbed_at`) | deleted |
| `email_provider_events` (those deliveries, and unmatched events correlated to them) | encrypted SES payload | payload erased (`erased_at`) | deleted; a row a suppression references is detached from the delivery and its payload erased |
| `email_send_attempts` | worker ids | kept | deleted |
| `outbox_events` (those deliveries, aggregate user or application) | JSON payload | contact and name values replaced; pending cancelled | deleted |
| `email_suppressions` | recipient HMAC, reason | kept: it protects the mailbox, not the person | kept |
| `admin_email_messages` | references only | kept | deleted |
| `notifications` | title, body, payload | contact and name text replaced | deleted |
| `support_requests` | subject, body, resolution note | contact and name text replaced | deleted |
| `client_reviews` | comment, moderation note | cleared by the 067 trigger on tombstone | deleted |
| `client_nominee_requests` (072, Phase I) | requested nominee name and relation, admin decline reason | name and relation set to `Tombstoned`, reason nulled and a pending request closed as `withdrawn` by the 072 trigger when the tombstone is set; the requested names also join the names the scrubber replaces in the client's other text | deleted |
| `admin_sip_schedules` | none | kept (guard requires none active) | deleted |
| `admin_sip_schedule_months`, `client_maturity_schedules` | none | kept | never present (they need ledger rows, so G2 applies) |
| `sip_early_exits` (073, Phase I) | schedule, ledger entry, payout and cancelled maturity links, amounts; no contact or free-text column | kept unchanged: it links ledger and payout rows that stay | never present: an early exit writes a withdrawal ledger row and a payout, and any early-exit row forces G2; G3 still deletes the client's rows before `admin_sip_schedules`, so the 073 `ON DELETE RESTRICT` key can never block it |
| `client_maturity_offers` (068, append-only, deletes refused by trigger) | figures, chosen option, states; no contact columns | kept unchanged (guard requires none open) | never present: an offer needs a maturity schedule, which needs a ledger position, and any offer row forces G2; its trigger therefore needs no erase path |
| `audit_events` about the client (entity the user, an application or one of the client's rows above, actor the client, or `metadata.userId` the client) | metadata, reason text | contact and name text replaced | deleted; the one erasure row is written after |
| `audit_events`, all others | | untouched | untouched |
| `idempotency_records`: the client's own scope, and receipts whose body contains the client's id | response bodies (contact corrections, nominee changes, nominee request decisions) | contact, name and nominee values replaced; receipts kept so replays still answer | client-scope rows deleted; others kept with contacts replaced |
| `client_value_entries`, `withdrawal_operations`, `client_position_maturities`, `fund_receipt_acknowledgements` | money; free-text notes | kept; amounts, dates and ids untouched; contact and name text in the notes replaced | presence forces G2 |
| `investment_orders`, `investment_allocations`, `payments`, `payment_attempts`, `refund_operations`, `provider_payment_details` | money; financial identifiers | kept unchanged | presence forces G2 |
| `provider_events` | encrypted webhook payload | payload erased (`erased_at`) | presence forces G2 |
| `sip_plans`, `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands` | no contact columns | kept | presence forces G2 (through `sip_plans`) |
| `legal_holds` | | an active hold on any client entity blocks erasure | blocks |
| `rate_limit_windows` | keyed hashes that expire | untouched | untouched |

No client data: `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, `fund_aum_snapshots`, `aum_growth_batches`, `client_growth_batches`, `consent_documents`, `content_items`, `app_config_versions`, `app_update_announcements`, `email_templates`, `email_template_revisions`, `roles`, `permissions`, `role_permissions`, `user_roles` (staff are refused), `finance_policy_versions`, `worker_heartbeats`, `schema_migrations`.

The coverage test (`clientErasureCoverage.integration.test.ts`) holds this classification in code: every foreign key to `users` or `applications` must be listed as a client subject or a staff actor, and every `text`, `varchar` or `jsonb` column of a table the client can own must be listed as handled or exempt with a reason. A new table, foreign key or column fails it until someone reviews it.

Kept on purpose in G2 and worth the maintainer's review: IP addresses and user agents on sessions, consents and audit rows. DEC-29 names contact details; these are not contacts.

Also kept in both paths: the admin's accept or decline receipt for a nominee request (072), which outlives the client. Its body holds only the request: the scrub sets the requested name and relation (`request.nominee`) to `Tombstoned` and replaces `clientName`, a whole-value name. The decline reason stays. Inside it, the scrub replaces an email and its masked form, but a phone only in its stored `+91…` form: a ten-digit national number, or a name, written in the reason stays readable. DEC-29 reads "emails and phones erased everywhere", so this one free-text field is worth the maintainer's review.

## Cost inside the locked transaction

- Audit rows are found through the existing indexes: `(entity_type, entity_id)` with the client's entity types and ids, `actor_user_id`, and the 066 `metadata.userId` index.
- Receipts: the client's own scope uses the `idempotency_records_scope_uk` index; receipts naming the client's id need one sequential scan of `idempotency_records` (`response_body::text LIKE`), about one scan per erasure. Durable receipts accumulate, so this grows with the table; at tens of thousands of rows it stays well under a second, and erasure is a rare admin action.
- Provider events, outbox events and unlinked sign-in events use the indexes 069 adds.

## Pre-flight (read-only)

Run against production by the maintainer only, in `psql`, before an erasure. It changes nothing.

```sql
\set user_id '00000000-0000-0000-0000-000000000000'
BEGIN READ ONLY;
WITH subject AS (
  SELECT u.id, u.application_id, u.email_normalized,
         (u.email_verification_state = 'verified' OR u.email_verified_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type = 'user' AND a.entity_id = u.id
                     AND a.command = 'email_verification.completed')) AS email_verified
  FROM users u WHERE u.id = :'user_id'
), known_emails AS (
  SELECT k.e FROM (
    SELECT email_normalized AS e FROM subject
    UNION SELECT previous_email_normalized FROM user_contact_history WHERE user_id = :'user_id'
    UNION SELECT new_email_normalized FROM user_contact_history WHERE user_id = :'user_id'
    UNION SELECT email_normalized FROM auth_login_events WHERE user_id = :'user_id'
    UNION SELECT a.email_normalized FROM applications a JOIN subject s ON a.id = s.application_id
  ) k
  WHERE k.e LIKE '%@%' AND k.e NOT LIKE '%@released.invalid'
    AND NOT (k.e LIKE 'tombstone+%' AND k.e LIKE '%@invalid.example')
    AND NOT EXISTS (SELECT 1 FROM users o WHERE o.email_normalized = k.e AND o.id <> :'user_id')
), apps AS (
  SELECT s.application_id AS id FROM subject s WHERE s.application_id IS NOT NULL
  UNION
  SELECT a.id FROM applications a, subject s
  WHERE a.state <> 'submitted' AND a.email_normalized IN (SELECT e FROM known_emails)
    AND a.id IS DISTINCT FROM s.application_id
    AND NOT EXISTS (SELECT 1 FROM users h WHERE h.application_id = a.id AND h.id <> s.id)
), funds AS (
  SELECT e.fund_id, sum(e.principal_delta_paise) AS principal, sum(e.value_delta_paise) AS value
  FROM client_value_entries e
  WHERE e.user_id = :'user_id' AND e.entry_type <> 'reversal'
    AND NOT EXISTS (SELECT 1 FROM client_value_entries r WHERE r.reverses_entry_id = e.id)
  GROUP BY e.fund_id
), mail AS (
  SELECT d.id, d.state, d.outbox_event_id, o.state AS outbox_state FROM email_deliveries d
  LEFT JOIN outbox_events o ON o.id = d.outbox_event_id
  WHERE d.user_id = :'user_id' OR d.application_id IN (SELECT id FROM apps)
), owned (entity_type, id) AS (
  SELECT 'user', :'user_id'::uuid
  UNION ALL SELECT 'application', id FROM apps
  UNION ALL SELECT 'support_request', id FROM support_requests WHERE user_id = :'user_id'
  UNION ALL SELECT 'client_review', id FROM client_reviews WHERE user_id = :'user_id'
  UNION ALL SELECT 'client_nominee_request', id FROM client_nominee_requests WHERE user_id = :'user_id'
  UNION ALL SELECT 'admin_sip_schedule', id FROM admin_sip_schedules WHERE user_id = :'user_id'
  UNION ALL SELECT 'sip_early_exit', id FROM sip_early_exits WHERE user_id = :'user_id'
  UNION ALL SELECT 'client_maturity_schedule', id FROM client_maturity_schedules WHERE user_id = :'user_id'
  UNION ALL SELECT 'client_maturity_offer', id FROM client_maturity_offers WHERE user_id = :'user_id'
  UNION ALL SELECT 'auth_session', id FROM auth_sessions WHERE user_id = :'user_id'
  UNION ALL SELECT 'user_contact_history', id FROM user_contact_history WHERE user_id = :'user_id'
  UNION ALL SELECT 'admin_email_message', id FROM admin_email_messages WHERE recipient_user_id = :'user_id'
  UNION ALL SELECT 'email_delivery', id FROM mail
  UNION ALL SELECT 'client_value_entry', id FROM client_value_entries WHERE user_id = :'user_id'
  UNION ALL SELECT 'investment_order', id FROM investment_orders WHERE user_id = :'user_id'
  UNION ALL SELECT 'payment', id FROM payments WHERE user_id = :'user_id'
  UNION ALL SELECT 'payment_attempt', id FROM payment_attempts WHERE user_id = :'user_id'
  UNION ALL SELECT 'withdrawal_operation', id FROM withdrawal_operations WHERE user_id = :'user_id'
  UNION ALL SELECT 'client_position_maturity', id FROM client_position_maturities WHERE user_id = :'user_id'
  UNION ALL SELECT 'sip_plan', id FROM sip_plans WHERE user_id = :'user_id'
  UNION ALL SELECT 'refund_operation', r.id FROM refund_operations r JOIN investment_orders o ON o.id = r.order_id
    WHERE o.user_id = :'user_id'
  UNION ALL SELECT 'fund_receipt_acknowledgement', f.id FROM fund_receipt_acknowledgements f
    JOIN investment_orders o ON o.id = f.order_id WHERE o.user_id = :'user_id'
), audit_about AS (
  SELECT a.id FROM audit_events a
  WHERE a.entity_type IN (SELECT entity_type FROM owned) AND a.entity_id IN (SELECT id FROM owned)
     OR a.actor_user_id = :'user_id'
     OR (a.metadata ? 'userId' AND a.metadata->>'userId' = :'user_id')
), entities AS (
  SELECT id FROM owned UNION SELECT id FROM audit_about
  UNION SELECT p.id FROM email_provider_events p WHERE p.email_delivery_id IN (SELECT id FROM mail)
  UNION SELECT id FROM payment_mandates WHERE user_id = :'user_id'
)
SELECT 'already_erased' AS item, count(*) AS n FROM audit_events
  WHERE entity_type = 'user' AND entity_id = :'user_id' AND command = 'client.erased'
UNION ALL SELECT 'email_verified', count(*) FROM subject WHERE email_verified
UNION ALL SELECT 'block_staff_roles', count(*) FROM user_roles WHERE user_id = :'user_id'
UNION ALL SELECT 'block_legal_holds_on_client_entities', count(*) FROM legal_holds h
  WHERE h.released_at IS NULL AND (h.expires_at IS NULL OR h.expires_at > now()) AND h.entity_id IN (SELECT id FROM entities)
UNION ALL SELECT 'block_funds_holding_money', count(*) FROM funds WHERE principal <> 0 OR value <> 0
UNION ALL SELECT 'block_open_orders', count(*) FROM investment_orders WHERE user_id = :'user_id'
  AND state IN ('submitted', 'payment_pending', 'review_pending', 'refund_pending', 'refund_failed')
UNION ALL SELECT 'block_open_payments', count(*) FROM payments WHERE user_id = :'user_id'
  AND state IN ('created', 'provider_pending', 'refund_pending', 'refund_failed', 'reconciliation_required')
UNION ALL SELECT 'block_open_payment_attempts', count(*) FROM payment_attempts WHERE user_id = :'user_id'
  AND state IN ('created', 'provider_pending', 'reconciliation_required')
UNION ALL SELECT 'block_pending_webhooks', count(*) FROM provider_events WHERE user_id = :'user_id'
  AND state IN ('received', 'processing')
UNION ALL SELECT 'block_open_refunds', count(*) FROM refund_operations r JOIN investment_orders o ON o.id = r.order_id
  WHERE o.user_id = :'user_id' AND r.state IN ('pending', 'provider_pending')
UNION ALL SELECT 'block_open_withdrawals', count(*) FROM withdrawal_operations WHERE user_id = :'user_id' AND state = 'pending'
UNION ALL SELECT 'block_failed_withdrawals', count(*) FROM withdrawal_operations WHERE user_id = :'user_id' AND state = 'failed'
UNION ALL SELECT 'block_unsettled_maturities', count(*) FROM client_position_maturities WHERE user_id = :'user_id' AND state = 'pending'
UNION ALL SELECT 'block_active_sip_schedules', count(*) FROM admin_sip_schedules WHERE user_id = :'user_id' AND state = 'active'
UNION ALL SELECT 'block_scheduled_maturities', count(*) FROM client_maturity_schedules WHERE user_id = :'user_id' AND state = 'scheduled'
UNION ALL SELECT 'block_open_maturity_offers', count(*) FROM client_maturity_offers WHERE user_id = :'user_id' AND state = 'open'
UNION ALL SELECT 'block_active_sip_plans', count(*) FROM sip_plans WHERE user_id = :'user_id'
  AND state IN ('draft', 'pending_mandate', 'active', 'paused', 'cancel_pending')
UNION ALL SELECT 'info_non_final_mandates', count(*) FROM payment_mandates WHERE user_id = :'user_id'
  AND state IN ('setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'revoke_pending')
UNION ALL SELECT 'block_mail_in_flight', count(*) FROM mail WHERE state = 'sending' OR outbox_state IN ('processing', 'sending')
UNION ALL SELECT 'money_rows_force_keep', (
  (SELECT count(*) FROM client_value_entries WHERE user_id = :'user_id') + (SELECT count(*) FROM investment_orders WHERE user_id = :'user_id')
  + (SELECT count(*) FROM investment_allocations WHERE user_id = :'user_id') + (SELECT count(*) FROM payments WHERE user_id = :'user_id')
  + (SELECT count(*) FROM payment_attempts WHERE user_id = :'user_id') + (SELECT count(*) FROM provider_payment_details WHERE user_id = :'user_id')
  + (SELECT count(*) FROM provider_events WHERE user_id = :'user_id') + (SELECT count(*) FROM withdrawal_operations WHERE user_id = :'user_id')
  + (SELECT count(*) FROM client_position_maturities WHERE user_id = :'user_id') + (SELECT count(*) FROM client_maturity_schedules WHERE user_id = :'user_id')
  + (SELECT count(*) FROM client_maturity_offers WHERE user_id = :'user_id') + (SELECT count(*) FROM admin_sip_schedule_months WHERE user_id = :'user_id')
  + (SELECT count(*) FROM sip_early_exits WHERE user_id = :'user_id') + (SELECT count(*) FROM sip_plans WHERE user_id = :'user_id'))
UNION ALL SELECT 'info_known_emails', count(*) FROM known_emails
UNION ALL SELECT 'touch_applications_linked_and_matched', count(*) FROM apps
UNION ALL SELECT 'touch_application_consents', count(*) FROM application_consents WHERE application_id IN (SELECT id FROM apps)
UNION ALL SELECT 'touch_application_reviews', count(*) FROM application_reviews WHERE application_id IN (SELECT id FROM apps)
UNION ALL SELECT 'touch_contact_history', count(*) FROM user_contact_history WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_sessions', count(*) FROM auth_sessions WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_login_events_own', count(*) FROM auth_login_events WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_login_events_unlinked_known_emails', count(*) FROM auth_login_events
  WHERE user_id IS NULL AND email_normalized IN (SELECT e FROM known_emails)
UNION ALL SELECT 'touch_email_deliveries', count(*) FROM mail
UNION ALL SELECT 'touch_queued_mail_to_cancel', count(*) FROM mail WHERE state IN ('queued', 'retryable_failed')
UNION ALL SELECT 'touch_outbox_events', count(*) FROM outbox_events WHERE id IN (SELECT outbox_event_id FROM mail)
  OR (aggregate_type = 'user' AND aggregate_id = :'user_id')
  OR (aggregate_type = 'application' AND aggregate_id IN (SELECT id FROM apps))
UNION ALL SELECT 'touch_provider_event_payloads', count(*) FROM email_provider_events
  WHERE email_delivery_id IN (SELECT id FROM mail) AND payload_ciphertext IS NOT NULL
UNION ALL SELECT 'touch_payment_webhook_payloads', count(*) FROM provider_events WHERE user_id = :'user_id' AND payload_ciphertext IS NOT NULL
UNION ALL SELECT 'touch_notifications', count(*) FROM notifications WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_support_requests', count(*) FROM support_requests WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_reviews', count(*) FROM client_reviews WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_nominee_requests', count(*) FROM client_nominee_requests WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_email_change_requests', count(*) FROM email_change_requests WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_password_links', count(*) FROM password_credential_tokens WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_statement_links', count(*) FROM client_statement_links WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_audit_rows_about_client', count(*) FROM audit_about
UNION ALL SELECT 'touch_matching_receipts', count(*) FROM idempotency_records
  WHERE actor_scope = 'user:' || :'user_id' OR actor_user_id = :'user_id'
     OR response_body::text LIKE '%' || :'user_id' || '%';
ROLLBACK;
```

Reading it: every `block_*` row must be 0, and `already_erased` 0, or the command will refuse or answer "already erased". `email_verified` 1 or `money_rows_force_keep` above 0 means G2; otherwise G3 deletes the `touch_*` rows (matched applications are tombstoned, not deleted; their consents are deleted). The known emails, matched applications, owned entities, audit rows and receipts are the same sets the command uses, with one difference: the command also adds recipient addresses and email-change targets it can decrypt, which SQL cannot read, so the command can match slightly more. The command also matches legal holds of type `mandate` through the mandate lookup; the `entities` set here includes the client's mandates directly.

## Migration 069

`069_client_erasure.sql` does two things:

1. It replaces the body of `user_contact_history_refuse_change()`, the function behind the 061 append-only triggers. The new body still refuses every update, delete and truncate, with one exception that only a transaction which ran `set_config('boe.erasing_user_id', '<user id>', true)` can use, and only for that user's rows:
   - a delete, when the user never verified their email (state, timestamp and completion audit row) and has no ledger row;
   - an update, when the user is tombstoned, the four contact columns are set to exactly the placeholders above, `reason_detail` is unchanged or null, and every other column is unchanged.

   The setting is transaction-local, so it ends at commit or rollback. Only `ClientErasureWriteRepository.markErasing` sets it. Truncate is refused unconditionally.
2. It adds three plain indexes (migrations run inside a transaction, so they cannot be `CONCURRENTLY`): `email_provider_events (email_delivery_id)` where not null, `outbox_events (aggregate_id)`, and `auth_login_events (email_normalized)` where `user_id` is null. **Each one blocks writes to its table while it builds**, as 066 does for `audit_events`: email provider webhooks, every queued email, and sign-in events wait for the build. On the current table sizes this is expected to take seconds; deploy outside busy hours.

Migration order: 069 follows Phase F's 068 (convention-7) and does not depend on it; `releaseUpgrade` expects both.

Rollback boundary: **no.** 069 adds a condition that only an erasing transaction can meet, plus indexes; the previous release (v0.15.x) never sets the setting, does not read `user_contact_history` at all, and is unaffected by extra indexes, so it runs unchanged against 069 and an images-only rollback works. The erasures themselves are irreversible by decision (DEC-29): rolling back the images does not restore erased or deleted data, and a snapshot restore would also discard every other transaction since. Against the previous release, a G2-erased client looks like an A8-released closed account with the name "Tombstoned"; a G3-erased client no longer exists.

Rollback after 072 (Phase I): an images-only rollback to v0.16.2 runs against 072, but v0.16.2's erase command does not know `client_nominee_requests`, which gives two limits until the roll-forward:

- **G3, never-verified client with any nominee request:** v0.16.2 deletes the user row without deleting the requests first, and the 072 `user_id` key is `ON DELETE RESTRICT`. The erase fails with a foreign-key error, answered as a 500. The transaction rolls back, so no data is lost and nothing is half-erased, but that client cannot be erased until the new release is back.
- **G2, a verified client or one with money rows:** when v0.16.2 sets the tombstone, the 072 trigger still tombstones the requests, nulls the reason and withdraws a pending request, and v0.16.2's receipt scrub still sets `request.nominee` in the admin decision receipts to `Tombstoned`. Its scrubber does not know the requested names, though, so a requested name that never became the nominee stays readable in any text v0.16.2 scrubs by name: audit `reason_detail` and metadata, application review text, support tickets, notifications, ledger, maturity, payout and receipt notes, and JSON values equal to the name. A later erase answers `already_erased` and does not scrub again, so erase such a client after the roll-forward where possible.

## Tests

- `clientErasure.integration.test.ts`:
  - G2 leaves no email, former email, change target, masked email, phone, national number, name or nominee readable in any `text`, `varchar` or `jsonb` column of any table. A queued `maturity_options` email and a delivery on a matched earlier application are among the client's mail.
  - G2 also keeps the ledger rows identical, clears the password and raises the credential version, revokes sessions, cancels mail, refuses a later contact release, value update and recording, and lets a new client be created with the old and the former contacts.
  - Every other row in the database is byte-identical before and after (only the client's own rows are excluded, by id), and a second client's key fields equal their literal fixture values.
  - Two erased clients get distinct placeholders.
  - G3 leaves only the erasure audit row and receipts naming the id, deletes the matched application's mail and both applications' consents, tombstones the matched application, and leaves every other row byte-identical.
  - A ledger row, or only a failed order, payment and payment attempt, forces G2; a stale `expectedPath` is refused.
- `clientErasureGuard.integration.test.ts`: every blocker is named and the whole database is byte-identical after a refusal; this covers money, an active SIP schedule, a scheduled maturity with an open offer, a hold on the user, a failed payout at zero balance, holds on the application, a delivery, a provider event, an audit row, a payment, an order and a mandate, staff accounts and admins without `users.close`.
- `clientErasureReach.integration.test.ts`: an application that shares only the phone is untouched, the consents of the linked and matched applications lose their user agent, and another user who now holds a former contact keeps byte-identical receipts and user row.
- `clientErasureRaces.integration.test.ts`: same-key replay, a new key answering "already erased", two concurrent erasures erasing once, concurrent recording or sign-in never leaving a half state, and a delivery marked `sending` or an outbox event claimed by a concurrent transaction while erasure waits on the mail lock making it refuse with every other table byte-identical.
- `clientWriteErasureLock.integration.test.ts`: each of the seven client writes above, sent while a real G2 erasure holds the client's user row, answers `ACCOUNT_NOT_ACTIVE` and leaves no row or change behind; removing the locks makes all seven fail.
- `clientErasureMigration.integration.test.ts`: the 069 populated upgrade and the trigger's negative controls, including deletes of another user's row, of a user with a ledger row and of a verified user.
- `clientErasureCoverage.integration.test.ts`: the reviewed foreign-key and column classification.
- Every seeded client in `erasureSupport.ts` also holds a declined and a pending nominee request (Phase I, 072), an admin audit row about the pending one, and a notification naming the requested nominee: the G2 test asserts both requests read `Tombstoned` with no reason and the pending one is `withdrawn`, and that the requested name is readable nowhere; the G3 test that no row naming the client remains. `nomineeRequestsMigration.integration.test.ts` covers the trigger on a previous-release tombstone write.
- Every seeded client in `erasureSupport.ts` holds a statement link (Phase H, 070): the G2 test asserts it is deleted, the G3 test that no row naming the client remains, and `clientStatementLinks.integration.test.ts` that an erased client's live link no longer opens.
- `erasureContacts.test.ts`: the scrubber's boundaries, case handling, names and JSON rules.
- Frontend `ClientEraseScreen.test.tsx`: the typed `ERASE` gate, an unknown outcome replaying the held key and request, the typed word cleared after a refusal, and a failed check showing an error with retry and no erase action.
- `releaseUpgrade` expects 068 and 069, and 072 and 073 since Phase I.
- An early exit's payout (`withdrawal_operations` with no maturity, 073) is pending until the admin records the transfer, so the existing open-withdrawal blocker refuses erasure meanwhile.
