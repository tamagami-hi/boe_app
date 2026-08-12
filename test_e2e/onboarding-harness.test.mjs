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

test('client KYC copy describes an alphanumeric 6-character code', async () => {
  const source = await readRepoFile('frontend_stack/packages/client/src/pages/KycDetail.jsx');

  assert.match(source, /6-character code/u);
  assert.doesNotMatch(source, /six-digit code/u);
});

test('KYC delivery fails closed when SMTP is not configured', async () => {
  const source = await readRepoFile('backend_controller/src/runtime/composition.ts');
  const kycWiring = source.slice(source.indexOf('// KYC/transactional email sender:'), source.indexOf('const webAuth:'));

  assert.match(kycWiring, /createUnconfiguredEmailSender\(\)/u);
  assert.doesNotMatch(kycWiring, /createLogEmailSender/u);
});

test('admin decisions use the bodyless idempotent wire contract and report queued email honestly', async () => {
  const [apiSource, contextSource] = await Promise.all([
    readRepoFile('frontend_stack/packages/client/src/services/adminApplicationsApi.js'),
    readRepoFile('frontend_stack/packages/admin/src/context/LegacyAdminDataContext.jsx'),
  ]);

  assert.doesNotMatch(apiSource, /if-match|expectedVersion|resolveApplication/u);
  assert.match(contextSource, /email[^\n]*queued/iu);
  assert.doesNotMatch(contextSource, /email[^\n]*has been sent/iu);
});
