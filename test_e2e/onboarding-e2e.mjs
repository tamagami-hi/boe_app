#!/usr/bin/env node
/**
 * Canonical onboarding flow against the local stack:
 * signup -> admin decision -> signup-password login -> email OTP -> eligibility.
 *
 * The script creates its own approve and reject subjects. OTP plaintext is read
 * only from the local Mailpit sink and is never printed, persisted, or queried
 * from Postgres/outbox state.
 *
 * Prerequisites:
 *   ./test_e2e/local-stack.sh up
 *   start the backend with DATABASE_URL and SMTP pointing at that stack
 *
 * Required environment:
 *   NEWUSER_SHARED_SECRET  local signup-door secret (never printed)
 *
 * Optional environment:
 *   API_BASE_URL    default http://127.0.0.1:47502
 *   MAILPIT_URL     default http://127.0.0.1:8025
 *   ADMIN_EMAIL     default local-admin@beonedge.in
 *   ADMIN_PASSWORD  default LocalAdmin!2026pw
 *   TEST_PASSWORD   default Onboard!2026pw
 */
import { randomUUID } from 'node:crypto';

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:47502').replace(/\/$/u, '');
const MAILPIT = (process.env.MAILPIT_URL || 'http://127.0.0.1:8025').replace(/\/$/u, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'local-admin@beonedge.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalAdmin!2026pw';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Onboard!2026pw';
const SIGNUP_SECRET = process.env.NEWUSER_SHARED_SECRET;
const OTP_PATTERN = /^[A-Za-z0-9]{6}$/u;
const MAIL_POLL_ATTEMPTS = 40;
const MAIL_POLL_DELAY_MS = 250;

if (!SIGNUP_SECRET) {
  console.error('NEWUSER_SHARED_SECRET is required');
  process.exit(2);
}

const WEBVIEW_HEADERS = {
  Origin: 'https://localhost',
  'Sec-Fetch-Site': 'cross-site',
};

const device = (name) => ({
  installationId: randomUUID(),
  name,
  platform: 'android',
  appVersion: '1.0.0',
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let failures = 0;
const step = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...WEBVIEW_HEADERS,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    ok: response.ok && payload?.ok !== false,
    data: payload?.data,
    code: payload?.error?.code,
  };
}

const signup = (identity) => api('/newuser', {
  method: 'POST',
  headers: { 'x-signup-key': SIGNUP_SECRET },
  body: {
    fullName: identity.fullName,
    email: identity.email,
    phone: identity.phone,
    password: TEST_PASSWORD,
    acceptedConsents: true,
  },
});

const nativeLogin = (email, name) => api('/v1/auth/native/login', {
  method: 'POST',
  body: { email, password: TEST_PASSWORD, device: device(name) },
});

const findApplication = async (adminToken, email) => {
  const queue = await api('/v1/admin/applications?status=submitted&limit=100', { token: adminToken });
  return { queue, row: (queue.data?.items || []).find((item) => item.email === email) };
};

const decide = (adminToken, applicationId, outcome) => api(
  `/v1/admin/applications/${applicationId}/decision?outcome=${outcome}`,
  {
    method: 'POST',
    token: adminToken,
    headers: { 'idempotency-key': randomUUID() },
  },
);

const clearMailpit = async () => {
  const response = await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Mailpit clear failed with HTTP ${response.status}`);
};

const messageFor = async (email, subject) => {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
  if (!response.ok) throw new Error(`Mailpit list failed with HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.messages || []).find((message) =>
    message.Subject === subject && (message.To || []).some((recipient) => recipient.Address === email));
};

const waitForOtp = async (email) => {
  const subject = 'Your BeOnEdge verification code';
  for (let attempt = 0; attempt < MAIL_POLL_ATTEMPTS; attempt += 1) {
    const summary = await messageFor(email, subject);
    if (summary?.ID) {
      const response = await fetch(`${MAILPIT}/api/v1/message/${encodeURIComponent(summary.ID)}`);
      if (!response.ok) throw new Error(`Mailpit message read failed with HTTP ${response.status}`);
      const message = await response.json();
      const match = /code is ([A-Za-z0-9]{6})\b/u.exec(String(message.Text || ''));
      if (match?.[1]) return match[1];
    }
    await wait(MAIL_POLL_DELAY_MS);
  }
  throw new Error('verification email did not reach Mailpit in time');
};

const wrongCase = (code) => {
  const index = [...code].findIndex((character) => /[A-Za-z]/u.test(character));
  if (index === -1) throw new Error('generated OTP had no letter, so case sensitivity could not be tested');
  const characters = [...code];
  const current = characters[index];
  characters[index] = current === current.toLowerCase() ? current.toUpperCase() : current.toLowerCase();
  return characters.join('');
};

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const phoneSuffix = String(Date.now()).slice(-8);
const approvedSubject = {
  fullName: 'Phase Two Approved',
  email: `boe.e2e.approve.${stamp}@e2e.beonedge.test`,
  phone: `+919${phoneSuffix}1`,
};
const rejectedSubject = {
  fullName: 'Phase Two Rejected',
  email: `boe.e2e.reject.${stamp}@e2e.beonedge.test`,
  phone: `+918${phoneSuffix}2`,
};

console.log(`api: ${API}`);
await clearMailpit();

console.log('\n1. admin authenticates');
const adminLogin = await api('/v1/auth/native/login', {
  method: 'POST',
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, device: device('BeOnEdge Admin') },
});
step('admin native login', adminLogin.ok, `http=${adminLogin.status}`);
const adminToken = adminLogin.data?.accessToken;
const adminSession = await api('/v1/admin/session', { token: adminToken });
step('admin bearer session is authorized', adminSession.ok, `http=${adminSession.status}`);

console.log('\n2. signup enters submitted with no signup email');
const approvedSignup = await signup(approvedSubject);
step('POST /newuser', approvedSignup.status === 202, `http=${approvedSignup.status}`);
step('signup reports created', approvedSignup.data?.outcome === 'created');
step('signup queues no verification email', approvedSignup.data?.verificationEmailQueued === false);
const approvedApplication = await findApplication(adminToken, approvedSubject.email);
step('submitted queue is readable', approvedApplication.queue.ok, `http=${approvedApplication.queue.status}`);
step('application is submitted', approvedApplication.row?.status === 'submitted');
step('signup password is present', approvedApplication.row?.hasSignupPassword === true);
step('Mailpit has no signup email', !(await messageFor(approvedSubject.email, 'Verify your BeOnEdge application')));
const pendingLogin = await nativeLogin(approvedSubject.email, 'Pending Client');
step('pending applicant cannot log in', pendingLogin.status === 401, `http=${pendingLogin.status}`);

console.log('\n3. approval activates the signup credential');
const approval = await decide(adminToken, approvedApplication.row?.applicationId, 'approved');
step('bodyless approve decision succeeds', approval.ok, `http=${approval.status}`);
step('approved account is active', approval.data?.status === 'approved' && approval.data?.accountActivated === true);
step('approval delivery is queued', Boolean(approval.data?.emailDeliveryId));
const clientLogin = await nativeLogin(approvedSubject.email, 'BeOnEdge Client');
step('signup password logs into approved account', clientLogin.ok, `http=${clientLogin.status}`);
step('native principal is active', clientLogin.data?.user?.accountStatus === 'active');
const clientToken = clientLogin.data?.accessToken;

console.log('\n4. email OTP is case-sensitive and unlocks eligibility');
const beforeEligibility = await api('/v1/client/eligibility', { token: clientToken });
step('unverified account cannot invest', beforeEligibility.data?.canInvest === false && beforeEligibility.data?.reason === 'kyc_required');
const start = await api('/v1/client/kyc/start', { method: 'POST', token: clientToken });
step('kyc/start reports code_sent', start.ok && start.data?.status === 'code_sent', `http=${start.status}`);
const otp = await waitForOtp(approvedSubject.email);
step('emailed OTP is 6-character alphanumeric', OTP_PATTERN.test(otp));
const incorrect = await api('/v1/client/kyc/verify', {
  method: 'POST', token: clientToken, body: { code: wrongCase(otp) },
});
step('wrong-case OTP is rejected', incorrect.status === 400 && incorrect.code === 'TOKEN_INVALID', `http=${incorrect.status}`);
const verified = await api('/v1/client/kyc/verify', {
  method: 'POST', token: clientToken, body: { code: otp },
});
step('exact OTP approves verification', verified.ok && verified.data?.status === 'approved', `http=${verified.status}`);
const afterEligibility = await api('/v1/client/eligibility', { token: clientToken });
step('verified account can invest', afterEligibility.data?.eligibility === 'eligible' && afterEligibility.data?.canInvest === true);

console.log('\n5. rejection creates no usable account');
const rejectedSignup = await signup(rejectedSubject);
step('second signup is created', rejectedSignup.status === 202 && rejectedSignup.data?.outcome === 'created');
const rejectedApplication = await findApplication(adminToken, rejectedSubject.email);
step('second application is submitted', rejectedApplication.row?.status === 'submitted');
const rejectedBefore = await nativeLogin(rejectedSubject.email, 'Rejected Client');
step('applicant cannot log in before rejection', rejectedBefore.status === 401, `http=${rejectedBefore.status}`);
const rejection = await decide(adminToken, rejectedApplication.row?.applicationId, 'rejected');
step('bodyless reject decision succeeds', rejection.ok && rejection.data?.status === 'rejected', `http=${rejection.status}`);
step('rejection creates no account', rejection.data?.accountActivated === false && rejection.data?.userId === undefined);
const rejectedAfter = await nativeLogin(rejectedSubject.email, 'Rejected Client');
step('rejected applicant cannot log in', rejectedAfter.status === 401, `http=${rejectedAfter.status}`);

console.log('\n6. client bearer cannot enter the admin surface');
const adminProbe = await api('/v1/admin/session', { token: clientToken });
step('client denied on admin session', [401, 403].includes(adminProbe.status), `http=${adminProbe.status}`);
const queueProbe = await api('/v1/admin/applications?status=submitted&limit=10', { token: clientToken });
step('client denied on admin queue', [401, 403].includes(queueProbe.status), `http=${queueProbe.status}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
