#!/usr/bin/env node
/**
 * Mock signups through the real landing-page form.
 *
 * Drives the actual browser form rather than posting to the API, so the whole
 * chain is exercised: client-side validation in SignupForm.tsx, the same-origin
 * route handler at /api/newuser, its server-side re-validation, and the
 * server-to-server forward to the app backend's POST /newuser carrying the
 * x-signup-key header.
 *
 * Usage
 *   node test_e2e/signup-users.mjs                     # 1 user against a local landing instance
 *   COUNT=3 node test_e2e/signup-users.mjs             # 3 users
 *   LANDING_BASE_URL=https://beonedge.in node test_e2e/signup-users.mjs
 *   HEADED=1 node test_e2e/signup-users.mjs            # watch it happen
 *
 * Environment
 *   LANDING_BASE_URL  default http://127.0.0.1:3110
 *   COUNT             how many identities to submit, default 1
 *   EMAIL_DOMAIN      default e2e.beonedge.test — deliberately non-routable so a
 *                     run can never mail a real person
 *   OUT               manifest path, default test_e2e/.out/signups.json
 *   HEADED            set to 1 to run with a visible browser
 *
 * Output
 *   A JSON manifest of everything submitted, which onboarding-e2e.mjs consumes to
 *   carry the same identities through verification, approval and sign-in.
 *
 * Note on the live site: the landing nginx rate-limits /api/newuser to 10 r/m
 * with a burst of 3, so COUNT above 3 against a real host will start taking 429s.
 * The script paces itself when it is not pointed at localhost.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const LANDING = (process.env.LANDING_BASE_URL || 'http://127.0.0.1:3110').replace(/\/$/, '');
const COUNT = Number(process.env.COUNT || 1);
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'e2e.beonedge.test';
const OUT = resolve(process.env.OUT || 'test_e2e/.out/signups.json');
const HEADED = process.env.HEADED === '1';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Onboard!2026pw';
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)\b/u.test(LANDING);

const FIRST = ['Asha', 'Vikram', 'Neha', 'Rohit', 'Priya', 'Arjun', 'Kavya', 'Manish'];
const LAST = ['Rao', 'Iyer', 'Menon', 'Kulkarni', 'Bose', 'Nair', 'Deshpande', 'Reddy'];

/**
 * A unique identity per run. Email and phone must both be unique: the backend
 * holds partial unique indexes on email_normalized and phone_e164 for any
 * application not in a terminal state, and silently no-ops a duplicate (it
 * answers 202 either way so as not to leak whether an account exists), which
 * would make a re-run look successful while creating nothing.
 */
function mockIdentity(index) {
  const stamp = Date.now().toString(36);
  const unique = `${stamp}${index}`;
  const first = FIRST[index % FIRST.length];
  const last = LAST[(index * 3 + 1) % LAST.length];
  // 10 digits beginning with 9, so +91 normalisation yields a valid E.164 number.
  const subscriber = `9${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
  return {
    fullName: `${first} ${last}`,
    email: `boe.e2e.${unique}@${EMAIL_DOMAIN}`,
    phone: `+91${subscriber}`,
    runId: randomUUID(),
  };
}

/**
 * Fill the form and confirm the values actually landed in React state.
 *
 * These are controlled inputs in a client component. Writing to them before
 * hydration sets the DOM value but leaves React's state empty, so the submit
 * posts blanks and the form reports every field as invalid — which looks exactly
 * like a validation bug rather than a timing one. Real keystrokes are used
 * instead of a direct value set, and the values are read back before submitting,
 * so a hydration race fails loudly here rather than silently downstream.
 */
async function fillForm(page, identity) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const submit = page.locator('form button[type="submit"]');
  await submit.waitFor({ state: 'visible', timeout: 30000 });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const [selector, value] of [
      ['#signup-full-name', identity.fullName],
      ['#signup-email', identity.email],
      ['#signup-phone', identity.phone],
      ['#signup-password', TEST_PASSWORD],
      ['#signup-confirm-password', TEST_PASSWORD],
    ]) {
      await page.fill(selector, '');
      await page.locator(selector).pressSequentially(value, { delay: 4 });
    }
    if (!(await page.isChecked('#signup-consents'))) {
      await page.check('#signup-consents');
    }

    const state = await page.evaluate(() => ({
      fullName: document.querySelector('#signup-full-name')?.value ?? '',
      email: document.querySelector('#signup-email')?.value ?? '',
      phone: document.querySelector('#signup-phone')?.value ?? '',
      password: document.querySelector('#signup-password')?.value ?? '',
      confirmPassword: document.querySelector('#signup-confirm-password')?.value ?? '',
      consents: Boolean(document.querySelector('#signup-consents')?.checked),
    }));
    if (
      state.fullName === identity.fullName &&
      state.email === identity.email &&
      state.phone === identity.phone &&
      state.password === TEST_PASSWORD &&
      state.confirmPassword === TEST_PASSWORD &&
      state.consents
    ) {
      return;
    }
    await page.waitForTimeout(750);
  }
  throw new Error('form values did not stick after 3 attempts (hydration problem?)');
}

async function submitOne(page, identity) {
  await page.goto(`${LANDING}/signup`, { waitUntil: 'domcontentloaded' });
  await fillForm(page, identity);

  // Capture what the route handler answered, so a failure can be explained
  // rather than just observed.
  const responsePromise = page
    .waitForResponse((r) => r.url().includes('/api/newuser') && r.request().method() === 'POST', { timeout: 30000 })
    .catch(() => null);

  await page.click('form button[type="submit"]');
  const response = await responsePromise;
  const status = response ? response.status() : null;
  let body = null;
  if (response) body = await response.json().catch(() => null);

  // The form replaces itself with a role="status" success block on 202. Treating
  // that as the success signal (rather than the HTTP status alone) also proves
  // the visitor was actually told it worked.
  const success = await page
    .waitForSelector('[role="status"]', { timeout: 15000 })
    .then((el) => el.innerText())
    .catch(() => null);

  const fieldErrors = await page.$$eval('.field__error', (nodes) => nodes.map((n) => n.textContent.trim()));

  return {
    ...identity,
    httpStatus: status,
    accepted: status === 202,
    message: body?.message ?? null,
    successText: success ? success.replace(/\s+/gu, ' ').trim() : null,
    fieldErrors,
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: !HEADED,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

console.log(`landing:  ${LANDING}`);
console.log(`submitting ${COUNT} signup${COUNT === 1 ? '' : 's'}\n`);

const results = [];
for (let index = 0; index < COUNT; index += 1) {
  const identity = mockIdentity(index);
  let result;
  try {
    result = await submitOne(page, identity);
  } catch (error) {
    result = { ...identity, accepted: false, error: String(error?.message || error) };
    await page.screenshot({ path: `/tmp/signup-fail-${index}.png` }).catch(() => {});
  }
  results.push(result);
  const mark = result.accepted ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${result.email}  ${result.phone}  http=${result.httpStatus ?? '-'}`);
  if (!result.accepted) {
    console.log(`       message: ${result.message ?? result.error ?? '(none)'}`);
    if (result.fieldErrors?.length) console.log(`       fields:  ${result.fieldErrors.join(' | ')}`);
  }
  // Stay under the live host's 10 r/m signup limit; no need locally.
  if (!IS_LOCAL && index < COUNT - 1) await page.waitForTimeout(7000);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ landing: LANDING, createdAt: new Date().toISOString(), results }, null, 2));

const accepted = results.filter((r) => r.accepted).length;
console.log(`\n${accepted}/${results.length} accepted`);
console.log(`manifest: ${OUT}`);

await browser.close();
process.exit(accepted === results.length ? 0 : 1);
