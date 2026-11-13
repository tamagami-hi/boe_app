# Client erasure (Phase G)

Status: built on lane `g-erasure` (tally `M11-phase-g:G-L1-erasure`), not landed, not released.
Decision: DEC-29 (behaviour) and DEC-33 (go-ahead), group `admin-improvements`.
This is a destructive change under `RULES.md` rule 11: it deletes and overwrites existing
production rows for the one client an administrator erases. It touches no other client.

## The command

| Item | Behaviour |
| --- | --- |
| Read | `GET /v1/admin/clients/{userId}/erase-check` returns `state` (`erasable`, `blocked`, `already_erased`), the `path` that would run (or ran), `keptBecause`, and every blocking reason. |
| Write | `POST /v1/admin/clients/{userId}/erase` with `Idempotency-Key` and body `{ "confirm": "ERASE", "expectedPath": "deleted" \| "kept_as_record" }`. |
| Permission | `users.close` for both. Only `superadmin` holds it by default, and the closest existing action (A8 contact release) uses it. No new permission was seeded. |
| Confirmation | The literal `ERASE` proves intent; the client id is already in the URL, so retyping it would prove only copy and paste. `expectedPath` binds the confirmation to the outcome the administrator was shown: if the client verified their email, or money was recorded, between the check and the confirm, the command refuses with `STATE_CONFLICT` and changes nothing. |
| Transaction | One transaction. Lock order: identity advisory locks for the current email and phone, then the client-position advisory lock of every fund with a ledger row, then `users` `FOR UPDATE`. This is the order `recordContribution`, reversals, maturities and contact corrections already use, so concurrent recording either commits first (and erasure is refused because money is held) or waits and is refused because the account is closed. Sign-in also locks the user row and re-checks the account state. |
| Idempotency | Durable admin receipt. A replay with the same key returns the first answer. A new key on an erased client answers `200` with `outcome: "already_erased"` and the original time and path, found from the erasure audit row (so it also works after a complete deletion). |
| Audit | Exactly one `client.erased` row per erasure: actor admin, time, entity the erased user id, `metadata: { path, keptBecause }`. No name, email or phone. |

## G1. Guard

Refused with `STATE_CONFLICT`, naming every reason (in `message` and in `fields`, keyed by code), and nothing changes, unless all hold:

| Code | Refused when |
| --- | --- |
| `staff_account` | The account has any `user_roles` row, active or revoked. Staff are never erasable here. |
| `legal_hold` | An unreleased, unexpired `legal_holds` row for the user. |
| `holds_money` | In any fund, the sum of `principal_delta_paise` or of `value_delta_paise` over non-reversal, non-reversed `client_value_entries` is not zero (the same basis as the portfolio position queries). |
| `open_orders` | An order in `submitted`, `payment_pending`, `review_pending`, `refund_pending` or `refund_failed`. |
| `open_payments` | A payment in `created`, `provider_pending`, `refund_pending`, `refund_failed` or `reconciliation_required`; a payment attempt in `created`, `provider_pending` or `reconciliation_required`; or a provider webhook still `received` or `processing`. |
| `open_refunds` | A refund operation `pending` or `provider_pending`. |
| `open_withdrawals` | A withdrawal payout `pending`. |
| `unsettled_maturities` | A `client_position_maturities` row `pending`. |
| `active_sip_schedules` | An admin SIP schedule `active`. |
| `scheduled_maturities` | A maturity schedule `scheduled`. |
| `open_maturity_offers` | A Phase F `client_maturity_offers` row `open` (options sent to the client and not yet confirmed, withdrawn or superseded). F closes an open offer whenever its maturity is resolved or cancelled, so this also follows from the previous row; it is checked on its own so the reason is named. |
| `active_sip_plans` | A SIP plan in `draft`, `pending_mandate`, `active`, `paused` or `cancel_pending`. The database's deferred SIP and mandate constraint ties every non-final AutoPay mandate to one of these SIP states, so the erasure code never reads the mandate tables (the architecture guard keeps them to the mandate modules). |
| `mail_in_flight` | A delivery for the client is `sending`, or its outbox event is `processing` or `sending`. Cancelling it then could record "cancelled" for mail that went out, so erasure waits a minute instead. |

## Paths

- **G2, kept as a record** (`kept_as_record`): the client completed email verification (`users.email_verification_state = 'verified'`, or `email_verified_at` set, or an `email_verification.completed` audit row), or any money row exists. `keptBecause` says which.
- **G3, deleted** (`deleted`): never verified and no row in `client_value_entries`, `investment_orders`, `investment_allocations`, `payments`, `payment_attempts`, `provider_payment_details`, `provider_events`, `withdrawal_operations`, `client_position_maturities`, `client_maturity_schedules`, `client_maturity_offers`, `admin_sip_schedule_months` or `sip_plans`. Money records are never deleted; their presence falls back to G2 and the answer says `keptBecause: "money_records"`.

Placeholders: the live `users` columns are unique, so the email becomes `released+<id>@released.invalid` and the phone a `+999` number from the A8 release sequence (both refused on every creation and correction path, and already proven against the previous release's lookups by the A8 tests). Everywhere else the existing tombstone values are used: `tombstone+<id>@invalid.example`, `tombstone`, `Tombstoned`. Contact-history rows get `tombstone-previous` and `tombstone-new` as phones, because `user_contact_history_changed` requires the two sides to differ.

"Known contacts" for one client are: the live email and phone, every email and phone in the contact history, the linked application's email, phone and name, every email typed at a sign-in recorded against the client, and every recipient address and pending email-change target that the current recipient key can decrypt. The free-text and JSON passes replace every exact occurrence of these (emails case-insensitively, also their masked `x***@domain` form; phones as `+E.164`, digits without `+`, and the ten-digit national number for `+91`) and set JSON values equal to the client's name or nominee, and any `nominee` object, to `Tombstoned`. Phone endings (last four digits) in audit metadata are left: the code already treats them as redactions.

## Table map

"Client rows" means rows whose user id, application id, delivery, or audit subject is this client, as listed.

| Table | Client data held | G2 kept as a record | G3 deleted |
| --- | --- | --- | --- |
| `users` | email, phone, name, nominee | email and phone to the release placeholders (kept if already released), name `Tombstoned`, nominee cleared by the 063 trigger, `pii_tombstoned_at`, closed (an `invited` account stays invited, since closing needs an activation time), `email_revision` and `version` bumped | deleted |
| `applications`, linked | email, phone, name, password hash | tombstoned under the 024 constraint (placeholders, `password_hash` null) | deleted |
| `applications`, unlinked, not `submitted`, same email or phone, not another user's | same | tombstoned | tombstoned, not deleted: they are only matched by contact |
| `application_consents` (linked) | consent IP HMAC, user agent | kept | deleted |
| `application_reviews` (linked) | admin reason text | contact strings replaced | deleted |
| `user_contact_history` | previous and new emails and phones | all four overwritten through the 069 erase path; `reason_detail` nulled if it names a contact | deleted through the 069 erase path |
| `user_credentials` | password hash | kept (account closed, sessions revoked) | deleted |
| `auth_sessions`, `auth_refresh_tokens` | IP, user agent | revoked | deleted |
| `auth_login_events` | email typed at sign-in | email to the tombstone placeholder: the client's rows, and rows with no user whose email is one of the client's and is held by no other account | deleted (same selection) |
| `password_credential_tokens`, `email_verification_codes` | link and code hashes | consumed | deleted |
| `email_change_requests` | encrypted target email | retired; target re-encrypted as the placeholder | deleted |
| `email_deliveries` (user or linked application, every template including Phase F `maturity_options`) | encrypted recipient, recipient HMAC, masked recipient, encrypted failure detail | queued and retryable cancelled (with their outbox events); recipient and failure envelopes nulled, HMAC and masked value set to the placeholder's, `erased_at` | deleted |
| `email_delivery_payloads` | sealed names and links | scrubbed (`scrubbed_at`) | deleted |
| `email_provider_events` (those deliveries) | encrypted SES payload | payload erased (`erased_at`) | deleted; a row a suppression references is detached from the delivery and its payload erased |
| `email_send_attempts` | worker ids | kept | deleted |
| `outbox_events` (those deliveries, aggregate user or application) | JSON payload | contact strings replaced; pending cancelled | deleted |
| `email_suppressions` | recipient HMAC, reason | kept: it protects the mailbox, not the person | kept |
| `admin_email_messages` | references only | kept | deleted |
| `notifications` | title, body, payload | contact strings replaced | deleted |
| `support_requests` | subject, body, resolution note | contact strings replaced | deleted |
| `client_reviews` | comment, moderation note | cleared by the 067 trigger on tombstone | deleted |
| `admin_sip_schedules` | none | kept (guard requires none active) | deleted |
| `admin_sip_schedule_months`, `client_maturity_schedules` | none | kept | never present (they need ledger rows, so G2 applies) |
| `client_maturity_offers` (068, append-only, deletes refused by trigger) | figures, chosen option, states; no contact columns | kept unchanged (guard requires none open) | never present: an offer needs a maturity schedule, which needs a ledger position, and any offer row forces G2; its trigger therefore needs no erase path |
| `audit_events` about the client (entity the user or linked application or one of the client's rows above, actor the client, or `metadata.userId` the client) | metadata, reason text | contact strings and name values replaced | deleted; the one erasure row is written after |
| `audit_events`, all others | | untouched | untouched |
| `idempotency_records`: client scope, and admin receipts whose body names the client id or a known contact | response bodies (contact corrections, nominee changes) | contact, name and nominee values replaced; receipts kept so replays still answer | client-scope rows deleted; admin receipts kept with contacts replaced |
| `client_value_entries`, `investment_orders`, `investment_allocations`, `payments`, `payment_attempts`, `refund_operations`, `withdrawal_operations`, `client_position_maturities`, `fund_receipt_acknowledgements`, `provider_payment_details` | money; free-text `note`, `transfer_reference`, `private_note`, `provider_reference` | kept; amounts, dates and ids untouched; contact strings in those free-text columns replaced | presence forces G2 |
| `provider_events` | encrypted webhook payload | payload erased (`erased_at`) | presence forces G2 |
| `sip_plans`, `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands` | no contact columns | kept | presence forces G2 (through `sip_plans`) |
| `legal_holds` | | an active hold blocks erasure | blocks |
| `rate_limit_windows` | keyed hashes that expire | untouched | untouched |

No client data: `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, `fund_aum_snapshots`, `aum_growth_batches`, `client_growth_batches`, `consent_documents`, `content_items`, `app_config_versions`, `app_update_announcements`, `email_templates`, `email_template_revisions`, `roles`, `permissions`, `role_permissions`, `user_roles` (staff are refused), `finance_policy_versions`, `worker_heartbeats`, `schema_migrations`.

Kept on purpose in G2 and worth the maintainer's review: IP addresses and user agents on sessions, consents and audit rows, and the password hash on the closed account. DEC-29 names contact details; these are not contacts.

## Pre-flight (read-only)

Run against production by the maintainer only, in `psql`, before an erasure. It changes nothing.

```sql
\set user_id '00000000-0000-0000-0000-000000000000'
BEGIN READ ONLY;
WITH subject AS (
  SELECT u.id, u.application_id, u.account_state, u.pii_tombstoned_at,
         (u.email_verification_state = 'verified' OR u.email_verified_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type = 'user' AND a.entity_id = u.id
                     AND a.command = 'email_verification.completed')) AS email_verified
  FROM users u WHERE u.id = :'user_id'
), funds AS (
  SELECT e.fund_id, sum(e.principal_delta_paise) AS principal, sum(e.value_delta_paise) AS value
  FROM client_value_entries e
  WHERE e.user_id = :'user_id' AND e.entry_type <> 'reversal'
    AND NOT EXISTS (SELECT 1 FROM client_value_entries r WHERE r.reverses_entry_id = e.id)
  GROUP BY e.fund_id
), mail AS (
  SELECT d.id, d.state, o.state AS outbox_state FROM email_deliveries d
  LEFT JOIN outbox_events o ON o.id = d.outbox_event_id, subject s
  WHERE d.user_id = s.id OR d.application_id = s.application_id
)
SELECT 'already_erased' AS item, count(*) AS n FROM audit_events WHERE entity_id = :'user_id' AND command = 'client.erased'
UNION ALL SELECT 'email_verified', count(*) FROM subject WHERE email_verified
UNION ALL SELECT 'block_staff_roles', count(*) FROM user_roles WHERE user_id = :'user_id'
UNION ALL SELECT 'block_legal_hold', count(*) FROM legal_holds WHERE entity_type = 'user' AND entity_id = :'user_id'
  AND released_at IS NULL AND (expires_at IS NULL OR expires_at > now())
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
  + (SELECT count(*) FROM payments WHERE user_id = :'user_id') + (SELECT count(*) FROM withdrawal_operations WHERE user_id = :'user_id')
  + (SELECT count(*) FROM sip_plans WHERE user_id = :'user_id') + (SELECT count(*) FROM client_maturity_schedules WHERE user_id = :'user_id')
  + (SELECT count(*) FROM client_maturity_offers WHERE user_id = :'user_id')
  + (SELECT count(*) FROM provider_events WHERE user_id = :'user_id'))
UNION ALL SELECT 'touch_contact_history', count(*) FROM user_contact_history WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_sessions', count(*) FROM auth_sessions WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_login_events_own', count(*) FROM auth_login_events WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_login_events_unlinked_same_email', count(*) FROM auth_login_events l, users u
  WHERE u.id = :'user_id' AND l.user_id IS NULL AND l.email_normalized = u.email_normalized
UNION ALL SELECT 'touch_email_deliveries', count(*) FROM mail
UNION ALL SELECT 'touch_queued_mail_to_cancel', count(*) FROM mail WHERE state IN ('queued', 'retryable_failed')
UNION ALL SELECT 'touch_notifications', count(*) FROM notifications WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_support_requests', count(*) FROM support_requests WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_reviews', count(*) FROM client_reviews WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_email_change_requests', count(*) FROM email_change_requests WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_password_links', count(*) FROM password_credential_tokens WHERE user_id = :'user_id'
UNION ALL SELECT 'touch_audit_rows_about_client', count(*) FROM audit_events WHERE entity_id = :'user_id'
  OR actor_user_id = :'user_id' OR (metadata ? 'userId' AND metadata->>'userId' = :'user_id')
UNION ALL SELECT 'touch_client_scope_receipts', count(*) FROM idempotency_records WHERE actor_user_id = :'user_id'
  OR actor_scope = 'user:' || :'user_id'
UNION ALL SELECT 'touch_admin_receipts_naming_client', count(*) FROM idempotency_records
  WHERE response_body::text LIKE '%' || :'user_id' || '%' AND actor_scope NOT LIKE 'user:%'
UNION ALL SELECT 'touch_linked_application', count(*) FROM applications a JOIN subject s ON a.id = s.application_id
UNION ALL SELECT 'touch_unlinked_applications_same_contact', count(*) FROM applications a, users u
  WHERE u.id = :'user_id' AND a.state <> 'submitted' AND a.pii_tombstoned_at IS NULL AND a.id IS DISTINCT FROM u.application_id
    AND (a.email_normalized = u.email_normalized OR a.phone_e164 = u.phone_e164);
ROLLBACK;
```

Reading it: every `block_*` row must be 0, and `already_erased` 0, or the command will refuse or answer "already erased". `email_verified` 1 or `money_rows_force_keep` above 0 means G2; otherwise G3 deletes the `touch_*` rows. The unlinked counts use only the live email and phone; the command also matches older contacts from the history, the sign-in log and decryptable mail.

## Migration 069

`069_client_erasure.sql` replaces the body of `user_contact_history_refuse_change()`, the function behind the 061 append-only triggers. Nothing else changes: no table, column, index, constraint, trigger definition or row.

The new body still refuses every update, delete and truncate, with one exception that only a transaction which ran `set_config('boe.erasing_user_id', '<user id>', true)` can use, and only for that user's rows:

- a delete, when the user never verified their email (state, timestamp and completion audit row) and has no ledger row;
- an update, when the user is tombstoned, the four contact columns are set to exactly the placeholders above, `reason_detail` is unchanged or null, and every other column is unchanged.

The setting is transaction-local, so it ends at commit or rollback. Only `ClientErasureWriteRepository.markErasing` sets it. Truncate is refused unconditionally (statement-level calls never take the path).

Migration order: 069 follows Phase F's 068 (convention-7) and only touches the 061 function, so it does not depend on 068; `releaseUpgrade` expects both.

Rollback boundary: **no.** 069 adds a condition that only an erasing transaction can meet; the previous release (v0.15.x) never sets the setting, and does not read `user_contact_history` at all, so it runs unchanged against 069 and an images-only rollback works. The erasures themselves are irreversible by decision (DEC-29): rolling back the images does not restore erased or deleted data, and a snapshot restore would also discard every other transaction since. Against the previous release, a G2-erased client looks like an A8-released closed account with the name "Tombstoned"; a G3-erased client no longer exists.

## Tests

- `test/integration/clientErasure.integration.test.ts`: the guard names every reason (money, an active SIP schedule, a scheduled maturity with an open Phase F offer, a legal hold) and the whole database is byte-identical after a refusal; staff and admins without `users.close` are refused; G2 (with a queued `maturity_options` email among the client's mail) leaves no email, former email, change target, masked email, phone, national number, name or nominee readable in any `text`, `varchar` or `jsonb` column of any table, keeps the ledger rows identical, revokes sessions, cancels mail, refuses a later contact release, and lets a new client be created with the old and the former contacts; G3 leaves only the erasure audit row and admin receipts naming the id, and another client's rows are identical; a money row forces G2 and a stale `expectedPath` is refused.
- `test/integration/clientErasureRaces.integration.test.ts`: same-key replay, a new key answering "already erased", two concurrent erasures erasing once, concurrent recording and concurrent sign-in never leaving a half state.
- `test/integration/clientErasureMigration.integration.test.ts`: the 069 populated upgrade and the negative controls for the trigger.
- `releaseUpgrade` expects 069.
