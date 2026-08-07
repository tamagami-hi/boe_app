#!/usr/bin/env node
/**
 * Full onboarding flow, end to end, against the local stack.
 *
 * Carries the identities created by signup-users.mjs the whole way:
 *
 *   landing signup  ->  application (pending_email_verification)
 *   confirm email   ->  application (submitted)          <- becomes reviewable
 *   admin review    ->  application (in_review)
 *   admin approve   ->  invited user + activation invite
 *   activate        ->  active user with a password
 *   client sign-in  ->  proves an approved user can actually get in
 *
 * The two emailed secrets are read from outbox_events.payload rather than from a
 * mailbox. That is not a shortcut around the design: verification_tokens and
 * activation_invites persist only a hash of the token, and the raw value exists
 * transiently in the outbox row for the mail worker to consume. Reading it there
 * is the only way to automate this without a live inbox.
 *
 * The admin steps deliberately use the bearer transport with the exact headers a
 * Capacitor WebView sends (Origin: https://localhost, Sec-Fetch-Site: cross-site),
 * so this doubles as a regression test for the admin-APK authentication fix.
 *
 * Usage
 *   node test_e2e/onboarding-e2e.mjs
 *
 * Environment
 *   API_BASE_URL   default http://127.0.0.1:47502
 *   ADMIN_EMAIL    default local-admin@beonedge.in
 *   ADMIN_PASSWORD default LocalAdmin!2026pw
 *   MANIFEST       default test_e2e/.out/signups.json
 *   NEW_PASSWORD   password set at activation, default Onboard!2026pw
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const exec = promisify(execFile);

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:47502').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'local-admin@beonedge.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalAdmin!2026pw';
const MANIFEST = resolve(process.env.MANIFEST || 'test_e2e/.out/signups.json');
const NEW_PASSWORD = process.env.NEW_PASSWORD || 'Onboard!2026pw';
const PG_CONTAINER = process.env.PG_CONTAINER || 'boe-local-pg';

// Headers a Capacitor WebView sends. Sec-Fetch-Site is the one that used to make
// every admin call fail with 403 CSRF_INVALID.
const WEBVIEW_HEADERS = {
  Origin: 'https://localhost',
  'Sec-Fetch-Site': 'cross-site',
};

let failures = 0;
const step = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

async function sql(query) {
  const { stdout } = await exec('docker', [
    'exec', '-i', PG_CONTAINER,
    'psql', '-U', 'boe_local', '-d', 'boe_local', '-At', '-c', query,
  ]);
  return stdout.trim();
}

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...WEBVIEW_HEADERS,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok && payload?.ok !== false, payload, data: payload?.data, code: payload?.error?.code };
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const candidates = manifest.results.filter((r) => r.accepted);
if (candidates.length === 0) {
  console.error('no accepted signups in the manifest; run signup-users.mjs first');
  process.exit(1);
}
const subject = candidates[0];
console.log(`api:     ${API}`);
console.log(`subject: ${subject.email}\n`);

// ── 1. the signup exists, and is not yet reviewable ─────────────────────────
console.log('1. landing signup landed in the database');
const initial = await sql(
  `select id || '|' || state || '|' || coalesce(email_verified_at::text,'')
   from applications where email_normalized = '${subject.email}'`,
);
const [applicationId, initialState] = initial.split('|');
step('application row exists', Boolean(applicationId), applicationId?.slice(0, 8));
step("starts in 'pending_email_verification'", initialState === 'pending_email_verification', initialState);

// ── 2. the admin console can SEE it before confirmation ─────────────────────
// This is the defect that made the operator think nothing had arrived.
console.log('\n2. admin console authenticates and can see the unconfirmed signup');
const adminLogin = await api('/v1/auth/native/login', {
  method: 'POST',
  body: {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    device: { installationId: randomUUID(), name: 'BeOnEdge Admin', platform: 'android', appVersion: '1.0.0' },
  },
});
step('admin native login', adminLogin.ok, `http=${adminLogin.status}`);
const adminToken = adminLogin.data?.accessToken;

const session = await api('/v1/admin/session', { token: adminToken });
step('GET /v1/admin/session over bearer from a cross-site origin', session.ok, `http=${session.status} ${session.code ?? ''}`);
step('principal carries an admin role', Boolean(session.data?.roles?.length), (session.data?.roles || []).join(','));

const awaiting = await api('/v1/admin/applications?status=pending_email_verification&limit=100', { token: adminToken });
step('queue is queryable for pending_email_verification', awaiting.ok, `http=${awaiting.status} ${awaiting.code ?? ''}`);
step(
  'the unconfirmed signup appears in it',
  (awaiting.data?.items || []).some((i) => i.applicationId === applicationId),
  `${(awaiting.data?.items || []).length} item(s)`,
);

// ── 3. confirm the email ────────────────────────────────────────────────────
console.log('\n3. applicant confirms their email');
const verificationToken = await sql(
  `select payload->>'verificationToken' from outbox_events
   where event_type = 'application.verification_requested' and aggregate_id = '${applicationId}'`,
);
step('verification token recoverable from the outbox', verificationToken.length > 20, `${verificationToken.length} chars`);

const verified = await api('/newuser/verify-email', { method: 'POST', body: { token: verificationToken } });
step('POST /newuser/verify-email', verified.ok, `http=${verified.status} ${verified.code ?? ''}`);

const afterVerify = await sql(`select state from applications where id = '${applicationId}'`);
step("state advanced to 'submitted'", afterVerify === 'submitted', afterVerify);

// ── 4. approve it ───────────────────────────────────────────────────────────
console.log('\n4. admin reviews and approves');
const submitted = await api('/v1/admin/applications?status=submitted&limit=100', { token: adminToken });
const row = (submitted.data?.items || []).find((i) => i.applicationId === applicationId);
step('appears in the actionable queue', Boolean(row), row ? `version=${row.version}` : '');

const reviewed = await api(`/v1/admin/applications/${applicationId}/review`, {
  method: 'POST',
  token: adminToken,
  headers: { 'idempotency-key': randomUUID() },
  body: { expectedVersion: row?.version },
});
step('POST review (submitted -> in_review)', reviewed.ok, `http=${reviewed.status} ${reviewed.code ?? ''}`);

const decided = await api(`/v1/admin/applications/${applicationId}/decision?outcome=approved`, {
  method: 'POST',
  token: adminToken,
  headers: { 'idempotency-key': randomUUID(), 'if-match': `"${reviewed.data?.version}"` },
  body: { reasonCode: 'approved_by_e2e' },
});
step('POST decision (approved)', decided.ok, `http=${decided.status} ${decided.code ?? ''}`);
const newUserId = decided.data?.userId;
step('an invited user was created', Boolean(newUserId), newUserId?.slice(0, 8));

const accountState = newUserId ? await sql(`select account_state from users where id = '${newUserId}'`) : '';
step("new user starts 'invited' with no password", accountState === 'invited', accountState);

// ── 5. the invited user cannot sign in yet ───────────────────────────────────
console.log('\n5. approval alone must not grant sign-in');
const prematureLogin = await api('/v1/auth/native/login', {
  method: 'POST',
  body: {
    email: subject.email,
    password: NEW_PASSWORD,
    device: { installationId: randomUUID(), name: 'BeOnEdge Client', platform: 'android', appVersion: '1.0.0' },
  },
});
step('sign-in refused before activation', !prematureLogin.ok && prematureLogin.status === 401, `http=${prematureLogin.status} ${prematureLogin.code}`);

// ── 6. activate, then sign in ───────────────────────────────────────────────
console.log('\n6. applicant activates and signs in');
const activationToken = await sql(
  `select payload->>'activationToken' from outbox_events
   where event_type = 'user.activation_invited' and aggregate_id = '${newUserId}'`,
);
step('activation token recoverable from the outbox', activationToken.length > 20, `${activationToken.length} chars`);

const activated = await api('/v1/activations/complete', {
  method: 'POST',
  body: {
    token: activationToken,
    password: NEW_PASSWORD,
    device: { installationId: randomUUID(), name: 'BeOnEdge Client', platform: 'android', appVersion: '1.0.0' },
  },
});
step('POST /v1/activations/complete', activated.ok, `http=${activated.status} ${activated.code ?? ''}`);

const finalState = newUserId ? await sql(`select account_state from users where id = '${newUserId}'`) : '';
step("account is now 'active'", finalState === 'active', finalState);

const clientLogin = await api('/v1/auth/native/login', {
  method: 'POST',
  body: {
    email: subject.email,
    password: NEW_PASSWORD,
    device: { installationId: randomUUID(), name: 'BeOnEdge Client', platform: 'android', appVersion: '1.0.0' },
  },
});
step('THE APPROVED USER CAN SIGN IN', clientLogin.ok, `http=${clientLogin.status} ${clientLogin.code ?? ''}`);

// ── 7. that client token must not open the admin surface ────────────────────
console.log('\n7. the new client token must not reach the admin console');
const clientToken = clientLogin.data?.accessToken;
const probe = await api('/v1/admin/session', { token: clientToken });
step(
  'client bearer denied on /v1/admin/session',
  !probe.ok && (probe.status === 403 || probe.status === 401),
  `http=${probe.status} ${probe.code}`,
);
const probeQueue = await api('/v1/admin/applications?status=submitted&limit=10', { token: clientToken });
step(
  'client bearer denied on the applications queue',
  !probeQueue.ok && (probeQueue.status === 403 || probeQueue.status === 401),
  `http=${probeQueue.status} ${probeQueue.code}`,
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
