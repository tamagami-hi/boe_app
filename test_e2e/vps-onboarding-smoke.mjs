#!/usr/bin/env node
/**
 * Live development-stack onboarding smoke test.
 *
 * Run inside the backend container so secrets stay in its environment and the
 * test can read the controlled Zoho mailbox over IMAPS. Output is deliberately
 * limited to step names and HTTP/status outcomes: no identities, credentials,
 * access tokens, message bodies, or OTP plaintext are printed or persisted.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import tls from 'node:tls';

const REQUIRED_ENV = [
  'ADMIN_LOGIN_ID',
  'ADMIN_PASSWORD',
  'BOE_SMOKE_IMAP_USER',
  'BOE_SMOKE_IMAP_PASSWORD',
  'NEWUSER_SHARED_SECRET',
  'APK_DOWNLOAD_BASE_URL',
  'PORT',
  'PUBLIC_API_BASE_URL',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Required environment variable is missing: ${key}`);
}
if (process.env.PUBLIC_API_BASE_URL !== 'https://dev-app.beonedge.in/api'
  || process.env.APK_DOWNLOAD_BASE_URL !== 'https://dev-app.beonedge.in/downloads') {
  throw new Error('Refusing live smoke outside the exact development deployment');
}
if (process.env.BOE_ALLOW_DEV_LIVE_SMOKE !== 'I_UNDERSTAND_DEV_ONLY') {
  throw new Error('Set BOE_ALLOW_DEV_LIVE_SMOKE=I_UNDERSTAND_DEV_ONLY for this one dev-only run');
}

const API = `http://127.0.0.1:${process.env.PORT}`;
const APPROVAL_SUBJECT = 'Welcome to BeOnEdge — your account is approved';
const KYC_SUBJECT = 'Your BeOnEdge verification code';
const REJECTION_SUBJECT = 'Update on your BeOnEdge application';
const APK_PATTERN = /^https:\/\/dev-app\.beonedge\.in\/downloads\/client\/boe\.dev\.client\.[A-Za-z0-9._-]+\.apk$/u;
const OTP_PATTERN = /^[A-Za-z0-9]{6}$/u;
const POLL_ATTEMPTS = 45;
const POLL_DELAY_MS = 2_000;
const IMAP_CONNECT_TIMEOUT_MS = 15_000;
const IMAP_COMMAND_TIMEOUT_MS = 20_000;
const MAX_IMAP_RESPONSE_BYTES = 1_048_576;
const HTTP_REQUEST_TIMEOUT_MS = 20_000;
const ADMIN_SMOKE_INSTALLATION_ID = 'd830c08d-54fc-4e3c-bf60-c541fcd8fd35';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const quoteImap = (value) => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const decodeQuotedPrintable = (value) => value
  .replace(/=\r?\n/gu, '')
  .replace(/=([0-9A-F]{2})/giu, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

class ImapClient {
  constructor() {
    this.socket = null;
    this.buffer = '';
    this.sequence = 0;
    this.active = null;
    this.connectReject = null;
  }

  async connect() {
    this.socket = tls.connect({
      host: 'imappro.zoho.in',
      port: 993,
      servername: 'imappro.zoho.in',
      rejectUnauthorized: true,
    });
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('close', () => this.fail(new Error('IMAP connection closed')));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('IMAP connection timed out'));
        this.socket?.destroy();
      }, IMAP_CONNECT_TIMEOUT_MS);
      this.connectReject = reject;
      this.socket.once('secureConnect', () => {
        clearTimeout(timer);
        this.connectReject = null;
        resolve();
      });
    });
    await this.execute(`LOGIN ${quoteImap(process.env.BOE_SMOKE_IMAP_USER)} ${quoteImap(process.env.BOE_SMOKE_IMAP_PASSWORD)}`);
    await this.execute('SELECT INBOX');
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_IMAP_RESPONSE_BYTES) {
      this.fail(new Error('IMAP response exceeded the safe size limit'));
      this.socket?.destroy();
      return;
    }
    if (!this.active) return;
    const completion = this.findCompletion(this.active.tag);
    if (!completion) return;
    const response = this.buffer.slice(0, completion.end);
    this.buffer = this.buffer.slice(completion.end);
    const active = this.active;
    this.active = null;
    clearTimeout(active.timer);
    if (completion.status === 'OK') active.resolve(response);
    else active.reject(new Error('IMAP command failed'));
  }

  findCompletion(tag) {
    let cursor = 0;
    while (cursor < this.buffer.length) {
      const lineEnd = this.buffer.indexOf('\r\n', cursor);
      if (lineEnd < 0) return null;
      const line = this.buffer.slice(cursor, lineEnd);
      const completion = new RegExp(`^${tag} (OK|NO|BAD)(?: |$)`, 'u').exec(line);
      if (completion) return { status: completion[1], end: lineEnd + 2 };
      const literalBytes = /\{([0-9]+)\}$/u.exec(line)?.[1];
      if (!literalBytes) {
        cursor = lineEnd + 2;
        continue;
      }
      const literalEnd = lineEnd + 2 + Number(literalBytes);
      if (this.buffer.length < literalEnd) return null;
      cursor = literalEnd;
    }
    return null;
  }

  fail(error) {
    if (this.connectReject) {
      const reject = this.connectReject;
      this.connectReject = null;
      reject(error);
    }
    if (!this.active) return;
    const active = this.active;
    this.active = null;
    clearTimeout(active.timer);
    active.reject(error);
  }

  execute(command) {
    if (!this.socket || this.active) throw new Error('IMAP client is not ready');
    return new Promise((resolve, reject) => {
      const tag = `A${++this.sequence}`;
      const timer = setTimeout(() => {
        this.fail(new Error(`IMAP command timed out: ${command.split(' ', 1)[0]}`));
        this.socket?.destroy();
      }, IMAP_COMMAND_TIMEOUT_MS);
      this.active = { tag, resolve, reject, timer };
      this.socket.write(`${tag} ${command}\r\n`);
    });
  }

  async findLatest(recipient, subject) {
    const result = await this.execute(`UID SEARCH TO ${quoteImap(recipient)} SUBJECT ${quoteImap(subject)}`);
    const ids = /^\* SEARCH(?: ([0-9 ]+))?\r?$/mu.exec(result)?.[1]?.trim().split(/\s+/u).filter(Boolean) ?? [];
    return ids.at(-1) ?? null;
  }

  fetchMessage(uid) {
    return this.execute(`UID FETCH ${uid} (BODY.PEEK[])`);
  }

  async close() {
    if (!this.socket) return;
    await this.execute('LOGOUT').catch(() => {});
    this.socket.end();
    this.socket = null;
  }
}

const request = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: 'https://localhost',
      'sec-fetch-site': 'cross-site',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    ok: response.ok && payload?.ok !== false,
    data: payload?.data,
    errorCode: payload?.error?.code,
  };
};

const device = (name, installationId = randomUUID()) => ({
  installationId,
  name,
  platform: 'android',
  appVersion: '0.8.8',
});

const login = (email, password, name, installationId) => request('/v1/auth/native/login', {
  method: 'POST',
  body: { email, password, device: device(name, installationId) },
});

const signup = (identity, password) => request('/newuser', {
  method: 'POST',
  headers: { 'x-signup-key': process.env.NEWUSER_SHARED_SECRET },
  body: { ...identity, password, acceptedConsents: true },
});

const decide = (token, applicationId, outcome) => request(
  `/v1/admin/applications/${applicationId}/decision?outcome=${outcome}`,
  { method: 'POST', token, headers: { 'idempotency-key': randomUUID() } },
);

const applicationFor = async (token, email) => {
  const queue = await request('/v1/admin/applications?status=submitted&limit=100', { token });
  return { queue, application: queue.data?.items?.find((item) => item.email === email) };
};

const waitForMessage = async (imap, recipient, subject) => {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const uid = await imap.findLatest(recipient, subject);
    if (uid) return imap.fetchMessage(uid);
    await wait(POLL_DELAY_MS);
  }
  throw new Error(`Mailbox delivery timeout for expected subject: ${subject}`);
};

const waitForFreshOtp = async (imap, recipient, previousOtp) => {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const message = await waitForMessage(imap, recipient, KYC_SUBJECT);
    const candidate = /code is ([A-Za-z0-9]{6})\b/u.exec(message)?.[1] ?? '';
    if (OTP_PATTERN.test(candidate) && candidate !== previousOtp) return candidate;
    await wait(POLL_DELAY_MS);
  }
  return null;
};

let failures = 0;
const check = (label, condition, detail = '') => {
  const passed = Boolean(condition);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!passed) failures += 1;
  return passed;
};

const mailbox = process.env.BOE_SMOKE_IMAP_USER;
const separator = mailbox.lastIndexOf('@');
if (separator < 1) throw new Error('Configured SMTP user is not an email address');
const mailboxLocal = mailbox.slice(0, separator);
const mailboxDomain = mailbox.slice(separator + 1);
const marker = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const controlledAddress = (purpose) => `${mailboxLocal}+boe-${purpose}-${marker}@${mailboxDomain}`;
const password = `P3!${randomBytes(12).toString('base64url')}aA9`;
const phoneTail = String(Date.now()).slice(-7);
const approvedIdentity = {
  fullName: 'Phase Three SMTP Approved',
  email: controlledAddress('approve'),
  phone: `+919${phoneTail}1`,
};
const rejectedIdentity = {
  fullName: 'Phase Three SMTP Rejected',
  email: controlledAddress('reject'),
  phone: `+918${phoneTail}2`,
};

const imap = new ImapClient();
const sessions = [];
try {
  await imap.connect();
  check('controlled mailbox authentication', true);

  const adminLogin = await login(
    process.env.ADMIN_LOGIN_ID,
    process.env.ADMIN_PASSWORD,
    'Phase 3 Admin',
    ADMIN_SMOKE_INSTALLATION_ID,
  );
  check('admin native login', adminLogin.ok, `HTTP ${adminLogin.status}`);
  const adminToken = adminLogin.data?.accessToken;
  sessions.push({ token: adminToken, refreshToken: adminLogin.data?.refreshToken });
  const adminSession = await request('/v1/admin/session', { token: adminToken });
  check('admin bearer authorization', adminSession.ok, `HTTP ${adminSession.status}`);

  const created = await signup(approvedIdentity, password);
  check('signup enters canonical submitted flow', created.status === 202 && created.data?.outcome === 'created');
  check('signup queues no verification email', created.data?.verificationEmailQueued === false);
  const pending = await applicationFor(adminToken, approvedIdentity.email);
  check('submitted application has signup password', pending.application?.status === 'submitted' && pending.application?.hasSignupPassword === true);
  const pendingLogin = await login(approvedIdentity.email, password, 'Pending Phase 3 Client');
  check('pending applicant cannot log in', pendingLogin.status === 401, `HTTP ${pendingLogin.status}`);

  const approval = await decide(adminToken, pending.application?.applicationId, 'approved');
  check('approval activates account and queues mail', approval.ok && approval.data?.accountActivated === true && Boolean(approval.data?.emailDeliveryId));
  const approvalMessage = await waitForMessage(imap, approvedIdentity.email, APPROVAL_SUBJECT);
  const decodedApprovalMessage = decodeQuotedPrintable(approvalMessage);
  const approvalUrl = /https:\/\/dev-app\.beonedge\.in\/downloads\/client\/[^\s<>"']+\.apk/u.exec(decodedApprovalMessage)?.[0] ?? '';
  check('approval email arrives with canonical APK URL', APK_PATTERN.test(approvalUrl));
  const apkHead = approvalUrl
    ? await fetch(approvalUrl, { method: 'HEAD', signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS) })
    : null;
  const apkLength = Number(apkHead?.headers.get('content-length'));
  check(
    'approval APK URL is a downloadable binary',
    apkHead?.status === 200
      && apkHead.headers.get('content-type') === 'application/octet-stream'
      && Number.isSafeInteger(apkLength)
      && apkLength > 0,
    `HTTP ${apkHead?.status ?? 0}`,
  );

  const clientLogin = await login(approvedIdentity.email, password, 'Approved Phase 3 Client');
  check('approved account logs in with signup password', clientLogin.ok && clientLogin.data?.user?.accountStatus === 'active');
  const clientToken = clientLogin.data?.accessToken;
  sessions.push({ token: clientToken, refreshToken: clientLogin.data?.refreshToken });
  const beforeEligibility = await request('/v1/client/eligibility', { token: clientToken });
  check('pre-KYC investment is denied', beforeEligibility.data?.canInvest === false && beforeEligibility.data?.reason === 'kyc_required');

  const started = await request('/v1/client/kyc/start', { method: 'POST', token: clientToken });
  check('KYC start reports code sent', started.ok && started.data?.status === 'code_sent', `HTTP ${started.status}`);
  const kycMessage = await waitForMessage(imap, approvedIdentity.email, KYC_SUBJECT);
  let otp = /code is ([A-Za-z0-9]{6})\b/u.exec(kycMessage)?.[1] ?? '';
  check('KYC email arrives with a valid-format code', OTP_PATTERN.test(otp));

  for (let attempt = 0; !/[A-Za-z]/u.test(otp) && attempt < 3; attempt += 1) {
    await wait(16_000);
    const resentForCaseCheck = await request('/v1/client/kyc/resend', { method: 'POST', token: clientToken });
    check('resend requests an OTP suitable for case-sensitivity testing', resentForCaseCheck.ok);
    otp = await waitForFreshOtp(imap, approvedIdentity.email, otp) ?? '';
  }
  const letterIndex = otp.search(/[A-Za-z]/u);
  check('case-sensitivity test has an alphabetic OTP character', letterIndex >= 0);
  if (letterIndex < 0) throw new Error('Unable to obtain an OTP with an alphabetic character');
  const letter = otp[letterIndex];
  const wrongCode = `${otp.slice(0, letterIndex)}${letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()}${otp.slice(letterIndex + 1)}`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const invalid = await request('/v1/client/kyc/verify', { method: 'POST', token: clientToken, body: { code: wrongCode } });
    check(`wrong OTP attempt ${attempt} is rejected`, invalid.status === 400 && invalid.errorCode === 'TOKEN_INVALID');
  }
  const locked = await request('/v1/client/kyc/verify', { method: 'POST', token: clientToken, body: { code: otp } });
  check('OTP locks after five failed attempts', locked.status === 409 && locked.errorCode === 'STATE_CONFLICT');

  await wait(16_000);
  const resent = await request('/v1/client/kyc/resend', { method: 'POST', token: clientToken });
  check('resend supersedes the locked code', resent.ok && resent.data?.status === 'code_sent', `HTTP ${resent.status}`);
  const freshOtp = await waitForFreshOtp(imap, approvedIdentity.email, otp);
  check('resent KYC email contains a fresh code', OTP_PATTERN.test(freshOtp ?? '') && freshOtp !== otp);
  if (!freshOtp) throw new Error('Resent KYC email did not contain a fresh code');
  const verified = await request('/v1/client/kyc/verify', { method: 'POST', token: clientToken, body: { code: freshOtp } });
  check('exact resent OTP approves KYC', verified.ok && verified.data?.status === 'approved', `HTTP ${verified.status}`);
  const afterEligibility = await request('/v1/client/eligibility', { token: clientToken });
  check('approved KYC unlocks investment eligibility', afterEligibility.data?.canInvest === true && afterEligibility.data?.eligibility === 'eligible');

  const rejectedCreated = await signup(rejectedIdentity, password);
  check('rejection test signup is accepted', rejectedCreated.status === 202 && rejectedCreated.data?.outcome === 'created');
  const rejectionPending = await applicationFor(adminToken, rejectedIdentity.email);
  const rejection = await decide(adminToken, rejectionPending.application?.applicationId, 'rejected');
  check('rejection creates no account', rejection.ok && rejection.data?.accountActivated === false && rejection.data?.userId === undefined);
  await waitForMessage(imap, rejectedIdentity.email, REJECTION_SUBJECT);
  check('rejection email arrives in controlled mailbox', true);
  const rejectedLogin = await login(rejectedIdentity.email, password, 'Rejected Phase 3 Client');
  check('rejected applicant cannot log in', rejectedLogin.status === 401, `HTTP ${rejectedLogin.status}`);

  const adminProbe = await request('/v1/admin/session', { token: clientToken });
  check('client bearer cannot enter admin surface', adminProbe.status === 403, `HTTP ${adminProbe.status}`);
} finally {
  for (const session of sessions.reverse()) {
    if (!session.token || !session.refreshToken) continue;
    await request('/v1/auth/native/logout', {
      method: 'POST',
      token: session.token,
      body: { refreshToken: session.refreshToken },
    }).catch(() => {});
  }
  await imap.close();
}

console.log(failures === 0 ? 'LIVE PHASE 3 SMTP SMOKE PASSED' : `LIVE PHASE 3 SMTP SMOKE FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
