import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPool } from "../../src/db/pool.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const HANDLED = "handled"
const EXEMPT = "exempt"

const SUBJECT_FKS: Readonly<Record<string, string>> = {
  "admin_email_messages.recipient_user_id -> users": "G2 kept, G3 deleted",
  "admin_sip_schedules.user_id -> users": "guard refuses active; G2 kept, G3 deleted",
  "application_consents.application_id -> applications": "G2 kept (no contact text), G3 deleted with the linked application",
  "application_reviews.application_id -> applications": "reason text scrubbed; G3 deletes the linked application's",
  "auth_sessions.user_id -> users": "G2 revoked, G3 deleted",
  "client_maturity_offers.user_id -> users": "guard refuses open; any row forces G2",
  "client_maturity_schedules.user_id -> users": "guard refuses scheduled; any row forces G2",
  "client_position_maturities.user_id -> users": "guard refuses pending; money row forces G2; note scrubbed",
  "client_reviews.user_id -> users": "G2 cleared by the 067 trigger, G3 deleted",
  "client_value_entries.user_id -> users": "money row forces G2; note scrubbed",
  "email_change_requests.user_id -> users": "G2 retired and re-encrypted, G3 deleted",
  "email_deliveries.application_id -> applications": "G2 erased, G3 deleted (linked and matched applications)",
  "email_deliveries.user_id -> users": "G2 erased, G3 deleted",
  "email_verification_codes.user_id -> users": "G2 consumed, G3 deleted",
  "investment_allocations.user_id -> users": "money row forces G2",
  "investment_orders.user_id -> users": "guard refuses open; money row forces G2",
  "notifications.user_id -> users": "G2 scrubbed, G3 deleted",
  "password_credential_tokens.user_id -> users": "G2 consumed, G3 deleted",
  "payment_attempts.user_id -> users": "guard refuses open; money row forces G2",
  "payments.user_id -> users": "guard refuses open; money row forces G2",
  "provider_events.user_id -> users": "guard refuses unprocessed; G2 payload erased; forces G2",
  "provider_payment_details.user_id -> users": "money row forces G2; financial identifiers kept",
  "sip_plans.user_id -> users": "guard refuses non-final; forces G2",
  "support_requests.user_id -> users": "G2 scrubbed, G3 deleted",
  "user_contact_history.user_id -> users": "G2 rewritten, G3 deleted, both through 069",
  "user_credentials.user_id -> users": "G2 password cleared, G3 deleted",
  "user_roles.user_id -> users": "any row refuses erasure (staff)",
  "users.application_id -> applications": "linked application tombstoned (G2) or deleted (G3)",
  "withdrawal_operations.user_id -> users": "guard refuses pending and failed; money row forces G2; note scrubbed",
}

const ACTOR_FKS: readonly string[] = [
  "admin_email_messages.actor_user_id -> users",
  "admin_sip_schedule_months.created_by_user_id -> users",
  "admin_sip_schedules.created_by_user_id -> users",
  "admin_sip_schedules.updated_by_user_id -> users",
  "app_config_versions.published_by_user_id -> users",
  "app_update_announcements.actor_user_id -> users",
  "application_reviews.reviewer_user_id -> users",
  "audit_events.actor_user_id -> users",
  "aum_growth_batches.actor_user_id -> users",
  "client_growth_batches.actor_user_id -> users",
  "client_maturity_offers.closed_by_user_id -> users",
  "client_maturity_offers.created_by_user_id -> users",
  "client_maturity_schedules.created_by_user_id -> users",
  "client_maturity_schedules.updated_by_user_id -> users",
  "client_position_maturities.marked_by_user_id -> users",
  "client_reviews.moderated_by_user_id -> users",
  "client_value_entries.created_by_user_id -> users",
  "content_items.published_by_user_id -> users",
  "email_suppressions.lifted_by_user_id -> users",
  "email_template_revisions.created_by_user_id -> users",
  "email_templates.created_by_user_id -> users",
  "finance_policy_versions.published_by_user_id -> users",
  "fund_aum_snapshots.published_by_user_id -> users",
  "fund_disclosure_versions.published_by_user_id -> users",
  "fund_receipt_acknowledgements.acknowledged_by_user_id -> users",
  "fund_stock_disclosures.added_by_user_id -> users",
  "fund_versions.created_by_user_id -> users",
  "funds.created_by_user_id -> users",
  "idempotency_records.actor_user_id -> users",
  "investment_allocations.allocated_by_user_id -> users",
  "legal_holds.placed_by -> users",
  "legal_holds.released_by -> users",
  "refund_operations.created_by_user_id -> users",
  "role_permissions.granted_by_user_id -> users",
  "role_permissions.revoked_by_user_id -> users",
  "user_contact_history.actor_user_id -> users",
  "user_roles.granted_by_user_id -> users",
  "user_roles.revoked_by_user_id -> users",
  "withdrawal_operations.created_by_user_id -> users",
]

const LINKED_WITHOUT_FK: readonly string[] = ["audit_events", "auth_login_events", "idempotency_records", "outbox_events"]

const exempt = (reason: string): string => `${EXEMPT}: ${reason}`
const handled = (how: string): string => `${HANDLED}: ${how}`
const CODES = exempt("fixed codes, states, keys or ids written by the server")

const COLUMN_COVERAGE: Readonly<Record<string, string>> = {
  "admin_sip_schedule_months.request_id": CODES,
  "admin_sip_schedules.request_id": CODES,
  "admin_sip_schedules.state": CODES,
  "application_consents.ip_hmac_key_version": CODES,
  "application_consents.user_agent": exempt("browser user agent, not a contact detail (DEC-29)"),
  "application_reviews.idempotency_key": CODES,
  "application_reviews.reason_code": CODES,
  "application_reviews.reason_detail": handled("contact and name text replaced"),
  "applications.email_normalized": handled("tombstoned or deleted"),
  "applications.full_name": handled("tombstoned or deleted"),
  "applications.password_hash": handled("nulled on tombstone or deleted"),
  "applications.phone_e164": handled("tombstoned or deleted"),
  "audit_events.command": CODES,
  "audit_events.entity_type": CODES,
  "audit_events.from_state": CODES,
  "audit_events.idempotency_key": CODES,
  "audit_events.metadata": handled("contacts, names and nominee replaced in rows about the client; G3 deletes them"),
  "audit_events.reason_code": CODES,
  "audit_events.reason_detail": handled("contact and name text replaced; G3 deletes"),
  "audit_events.to_state": CODES,
  "audit_events.user_agent": exempt("browser user agent, not a contact detail (DEC-29)"),
  "auth_login_events.email_normalized": handled("placeholder (G2) or deleted (G3)"),
  "auth_login_events.user_agent": exempt("browser user agent, not a contact detail (DEC-29)"),
  "auth_refresh_tokens.token_key_version": CODES,
  "auth_sessions.csrf_key_version": CODES,
  "auth_sessions.previous_csrf_key_version": CODES,
  "auth_sessions.previous_refresh_key_version": CODES,
  "auth_sessions.refresh_key_version": CODES,
  "auth_sessions.revocation_reason": CODES,
  "auth_sessions.user_agent": exempt("browser user agent, not a contact detail (DEC-29)"),
  "client_growth_batches.basis_hash": CODES,
  "client_growth_batches.note": exempt("batch note across many clients, not this client's row"),
  "client_growth_batches.reason_code": CODES,
  "client_growth_batches.request_id": CODES,
  "client_maturity_offers.chosen_option": CODES,
  "client_maturity_offers.request_id": CODES,
  "client_maturity_offers.state": CODES,
  "client_maturity_schedules.request_id": CODES,
  "client_maturity_schedules.resolution": CODES,
  "client_maturity_schedules.state": CODES,
  "client_position_maturities.note": handled("contact and name text replaced"),
  "client_position_maturities.reason_code": CODES,
  "client_position_maturities.request_id": CODES,
  "client_reviews.comment": handled("cleared by the 067 trigger or deleted"),
  "client_reviews.moderation_note": handled("cleared by the 067 trigger or deleted"),
  "client_reviews.state": CODES,
  "client_value_entries.note": handled("contact and name text replaced"),
  "client_value_entries.reason_code": CODES,
  "client_value_entries.request_id": CODES,
  "email_change_requests.code_key_version": CODES,
  "email_change_requests.target_key_version": CODES,
  "email_deliveries.failure_detail_key_version": handled("nulled with the failure envelope"),
  "email_deliveries.last_error_code": CODES,
  "email_deliveries.recipient_encryption_key_version": handled("nulled with the recipient envelope"),
  "email_deliveries.recipient_masked": handled("replaced by the placeholder's mask"),
  "email_deliveries.ses_configuration_set": CODES,
  "email_deliveries.ses_message_id": CODES,
  "email_deliveries.ses_request_id": CODES,
  "email_deliveries.suppression_hmac_key_version": CODES,
  "email_deliveries.template_key": CODES,
  "email_deliveries.template_version": CODES,
  "email_delivery_payloads.key_version": CODES,
  "email_provider_events.payload_key_version": handled("nulled with the payload"),
  "email_provider_events.ses_event_type": CODES,
  "email_provider_events.ses_message_id": CODES,
  "email_provider_events.sns_message_id": CODES,
  "email_provider_events.sns_topic_arn": CODES,
  "email_provider_events.sns_type": CODES,
  "email_provider_events.state": CODES,
  "email_send_attempts.error_code": CODES,
  "email_send_attempts.message_id": CODES,
  "email_send_attempts.outcome": CODES,
  "email_send_attempts.worker_id": CODES,
  "email_suppressions.lift_reason": exempt("staff note about a mailbox suppression"),
  "email_suppressions.reason": CODES,
  "email_suppressions.suppression_hmac_key_version": CODES,
  "email_verification_codes.code_key_version": CODES,
  "fund_receipt_acknowledgements.private_note": handled("contact and name text replaced"),
  "idempotency_records.actor_scope": CODES,
  "idempotency_records.actor_scope_key_version": CODES,
  "idempotency_records.http_method": CODES,
  "idempotency_records.key": CODES,
  "idempotency_records.response_body": handled("contacts, names and nominee replaced in receipts naming the client"),
  "idempotency_records.route_template": CODES,
  "investment_allocations.request_id": CODES,
  "investment_orders.failure_code": CODES,
  "mandate_cancel_commands.failure_code": CODES,
  "mandate_cancel_commands.merchant_subscription_id": exempt("financial identifier"),
  "mandate_collection_attempts.checkout_channel": CODES,
  "mandate_collection_attempts.notify_failure_code": CODES,
  "mandate_collection_attempts.retry_strategy": CODES,
  "mandate_setup_attempts.checkout_channel": CODES,
  "mandate_setup_attempts.checkout_redirect_url": exempt("provider checkout URL; any row forces G2"),
  "mandate_setup_attempts.failure_code": CODES,
  "mandate_setup_attempts.merchant_order_id": exempt("financial identifier"),
  "mandate_setup_attempts.provider": CODES,
  "mandate_setup_attempts.provider_order_id": exempt("financial identifier"),
  "notifications.body": handled("contact and name text replaced; G3 deletes"),
  "notifications.kind": CODES,
  "notifications.payload": handled("contacts and names replaced; G3 deletes"),
  "notifications.title": handled("contact and name text replaced; G3 deletes"),
  "outbox_events.aggregate_type": CODES,
  "outbox_events.deduplication_key": exempt("server-built key of ids and template names"),
  "outbox_events.event_type": CODES,
  "outbox_events.last_error_code": CODES,
  "outbox_events.locked_by": CODES,
  "outbox_events.payload": handled("contacts and names replaced; G3 deletes"),
  "outbox_events.topic": CODES,
  "password_credential_tokens.token_key_version": CODES,
  "payment_attempts.checkout_channel": CODES,
  "payment_attempts.failure_code": CODES,
  "payment_attempts.merchant_order_id": exempt("financial identifier"),
  "payment_attempts.provider": CODES,
  "payment_attempts.provider_order_id": exempt("financial identifier"),
  "payment_attempts.provider_state": CODES,
  "payment_mandates.amount_type": CODES,
  "payment_mandates.failure_code": CODES,
  "payment_mandates.frequency": CODES,
  "payment_mandates.merchant_subscription_id": exempt("financial identifier"),
  "payment_mandates.provider": CODES,
  "payment_mandates.provider_subscription_id": exempt("financial identifier"),
  "provider_events.dedup_key": CODES,
  "provider_events.event_type": CODES,
  "provider_events.last_error_code": CODES,
  "provider_events.locked_by": CODES,
  "provider_events.merchant_order_id": exempt("financial identifier"),
  "provider_events.payload_key_version": handled("nulled with the payload"),
  "provider_events.provider": CODES,
  "provider_payment_details.instrument_type": CODES,
  "provider_payment_details.provider_reference": exempt("financial identifier, kept by review decision"),
  "provider_payment_details.provider_transaction_id": exempt("financial identifier"),
  "provider_payment_details.state": CODES,
  "refund_operations.failure_code": CODES,
  "refund_operations.merchant_refund_id": exempt("financial identifier"),
  "refund_operations.provider_refund_id": exempt("financial identifier"),
  "refund_operations.request_id": CODES,
  "support_requests.body": handled("contact and name text replaced; G3 deletes"),
  "support_requests.category": CODES,
  "support_requests.reference": CODES,
  "support_requests.resolution_note": handled("contact and name text replaced; G3 deletes"),
  "support_requests.subject": handled("contact and name text replaced; G3 deletes"),
  "user_contact_history.change_kind": CODES,
  "user_contact_history.new_email_normalized": handled("placeholder through 069"),
  "user_contact_history.new_phone_e164": handled("placeholder through 069"),
  "user_contact_history.previous_email_normalized": handled("placeholder through 069"),
  "user_contact_history.previous_phone_e164": handled("placeholder through 069"),
  "user_contact_history.reason_code": CODES,
  "user_contact_history.reason_detail": handled("nulled when it names a contact"),
  "user_credentials.password_hash": handled("nulled (G2) or deleted (G3)"),
  "users.email_normalized": handled("release placeholder"),
  "users.email_verification_state": CODES,
  "users.full_name": handled("Tombstoned"),
  "users.nominee_name": handled("cleared by the 063 trigger"),
  "users.nominee_relation": handled("cleared by the 063 trigger"),
  "users.phone_e164": handled("release placeholder"),
  "withdrawal_operations.failure_code": CODES,
  "withdrawal_operations.note": handled("contact and name text replaced"),
  "withdrawal_operations.reason_code": CODES,
  "withdrawal_operations.request_id": CODES,
  "withdrawal_operations.transfer_reference": exempt("financial identifier, kept by review decision"),
}

let container: StartedPostgreSqlContainer
let pool: Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({ connectionString: container.getConnectionUri(), poolMax: 2, connectionTimeoutMs: 5_000, idleTimeoutMs: 10_000 })
  await runMigrations(pool, await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url))))
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("erasure covers every place a client's data can live", () => {
  test("every foreign key to users or applications is reviewed as a client subject or a staff actor", async () => {
    const rows = (
      await pool.query<{ fk: string }>(
        "select c.conrelid::regclass::text || '.' || string_agg(a.attname, ',' order by a.attnum) || ' -> ' || c.confrelid::regclass::text as fk " +
          "from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) " +
          "where c.contype = 'f' and c.confrelid in ('users'::regclass, 'applications'::regclass) " +
          "group by c.oid, c.conrelid, c.confrelid order by 1",
      )
    ).rows.map((row) => row.fk)
    expect([...rows].sort()).toEqual([...Object.keys(SUBJECT_FKS), ...ACTOR_FKS].sort())
  })

  test("every text, varchar and jsonb column of a table the client can own is handled or exempt", async () => {
    const bases = [
      "users",
      "applications",
      ...LINKED_WITHOUT_FK,
      ...Object.keys(SUBJECT_FKS).map((fk) => fk.slice(0, fk.indexOf("."))),
    ]
    const rows = (
      await pool.query<{ column: string }>(
        "with recursive owned(rel) as (" +
          "  select unnest($1::text[])::regclass" +
          "  union select c.conrelid::regclass from pg_constraint c join owned o on c.confrelid = o.rel" +
          "  where c.contype = 'f' and c.confrelid <> 'users'::regclass" +
          ") select table_name || '.' || column_name as column from information_schema.columns " +
          "where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json') " +
          "and table_name in (select rel::text from owned) order by 1",
        [[...new Set(bases)]],
      )
    ).rows.map((row) => row.column)
    expect([...rows].sort()).toEqual(Object.keys(COLUMN_COVERAGE).sort())
    expect(Object.values(COLUMN_COVERAGE).every((value) => value.startsWith(HANDLED) || value.startsWith(EXEMPT))).toBe(true)
  })
})
