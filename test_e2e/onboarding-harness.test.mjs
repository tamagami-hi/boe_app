import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readRepoFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('onboarding e2e follows only the canonical approval and OTP flow', async () => {
  const source = await readRepoFile('test_e2e/onboarding-e2e.mjs');

  assert.match(source, /POST \/newuser/u);
  assert.match(source, /decide\([^\n]+, 'approved'\)/u);
  assert.match(source, /decide\([^\n]+, 'rejected'\)/u);
  assert.match(source, /\^\[A-Za-z0-9\]\{6\}\$/u);
  assert.doesNotMatch(source, /pending_email_verification|\/newuser\/verify-email|\/review|activationToken|\/v1\/activations\/complete/u);
});

test('browser signup harness submits the password required by POST /newuser', async () => {
  const source = await readRepoFile('test_e2e/signup-users.mjs');

  assert.match(source, /#signup-password/u);
  assert.match(source, /#signup-confirm-password/u);
});

test('active nginx routes no longer expose the deleted website verification endpoint', async () => {
  const configs = await Promise.all([
    readRepoFile('release_manager/nginx/app.beonedge.in.conf'),
    readRepoFile('release_manager/nginx/dev-app.beonedge.in.conf'),
  ]);

  for (const config of configs) {
    assert.doesNotMatch(config, /newuser\(\/verify-email\)/u);
    assert.match(config, /location = \/api\/newuser/u);
  }
});

test('email verification copy describes a case-sensitive six-character code, never KYC', async () => {
  const source = await readRepoFile(
    'frontend_stack_ts/src/features/email-verification/EmailVerificationScreen.tsx',
  );

  assert.match(source, /Six characters, case-sensitive/u);
  assert.doesNotMatch(source, /six-digit|6-digit/iu);
  assert.doesNotMatch(source, /\bKYC\b/u);
});

test('transactional email delivery fails closed when SMTP is not configured', async () => {
  const source = await readRepoFile('backend_controller/src/runtime/composition.ts');

  assert.match(source, /createUnconfiguredEmailSender\(\)/u);
  assert.doesNotMatch(source, /createLogEmailSender/u);
  assert.doesNotMatch(
    source,
    /const emailSender: EmailSender =[\s\S]{0,200}createSmtpEmailSender[\s\S]{0,60}: undefined/u,
  );
});

test('the application decision is contracted as an empty body with the outcome in the query', async () => {
  const source = await readRepoFile('packages/contracts/src/operations/admin-oversight.ts');
  const operation = source.slice(
    source.indexOf('export const decideAdminApplication'),
    source.indexOf('export const AdminEmailDeliveryQuery'),
  );

  assert.match(operation, /path: "\/v1\/admin\/applications\/\{applicationId\}\/decision"/u);
  assert.match(operation, /query: z\.strictObject\(\{ outcome: z\.enum\(\["approved", "rejected"\]\) \}\)/u);
  assert.match(operation, /body: z\.strictObject\(\{\}\)/u);
  assert.match(operation, /idempotency: "required-key"/u);
  assert.doesNotMatch(operation, /ifMatch|expectedVersion/u);
});

test('live SMTP smoke is guarded, bounded, and cleans up native sessions', async () => {
  const source = await readRepoFile('test_e2e/vps-onboarding-smoke.mjs');

  assert.match(source, /PUBLIC_API_BASE_URL !== 'https:\/\/dev-app\.beonedge\.in\/api'/u);
  assert.match(source, /BOE_ALLOW_DEV_LIVE_SMOKE !== 'I_UNDERSTAND_DEV_ONLY'/u);
  assert.match(source, /BOE_SMOKE_IMAP_USER/u);
  assert.match(source, /BOE_SMOKE_IMAP_PASSWORD/u);
  assert.doesNotMatch(source, /EMAIL_SMTP_(?:USER|PASSWORD)/u);
  assert.match(source, /IMAP_CONNECT_TIMEOUT_MS/u);
  assert.match(source, /IMAP_COMMAND_TIMEOUT_MS/u);
  assert.match(source, /MAX_IMAP_RESPONSE_BYTES/u);
  assert.match(source, /HTTP_REQUEST_TIMEOUT_MS/u);
  assert.match(source, /AbortSignal\.timeout\(HTTP_REQUEST_TIMEOUT_MS\)/u);
  assert.match(source, /\/v1\/auth\/native\/logout/u);
  assert.match(source, /case-sensitivity test has an alphabetic OTP character/u);
  assert.match(source, /freshOtp !== otp/u);
});
