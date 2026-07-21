import { apiRequest, delay, useHttpApi } from './_util.js';

// --- Email-OTP KYC (canonical, RA-C.10) -----------------------------------
// The client requests a code (emailed from the company mailbox), then submits it
// to complete KYC — after which the client is eligible to invest. There is no
// risk questionnaire (risk is a fund attribute the client chooses).

/** Request a KYC verification code to the client's email. */
export async function startKyc() {
  if (useHttpApi()) return apiRequest('/v1/client/kyc/start', { method: 'POST' });
  await delay(160);
  return { status: 'code_sent', expiresAt: new Date(Date.now() + 600_000).toISOString() };
}

/** Resend the KYC verification code (cooldown-guarded server-side). */
export async function resendKyc() {
  if (useHttpApi()) return apiRequest('/v1/client/kyc/resend', { method: 'POST' });
  await delay(160);
  return { status: 'code_sent', expiresAt: new Date(Date.now() + 600_000).toISOString() };
}

/** Submit the 6-digit code to complete KYC. */
export async function verifyKyc(code) {
  if (useHttpApi()) return apiRequest('/v1/client/kyc/verify', { method: 'POST', body: { code } });
  await delay(160);
  return { status: 'approved' };
}

// --- Legacy KYC-detail screen (deferred document/depth KYC) ----------------
// Retained for the existing KycDetail screen. These target not-yet-built
// endpoints and fall back to fixtures; they are separate from the email-OTP
// eligibility gate above.

const FIXTURE_KYC = {
  id: 'fixture-kyc-1',
  userId: 'fixture-user-1',
  panLast4: null,
  aadhaarLast4: null,
  addressJson: {},
  documentRefsJson: [],
  fatcaStatus: 'not_started',
  fatcaDeclaration: null,
  nominees: [],
  reKycDueDate: null,
  reKycTriggerReason: null,
  reviewStatus: 'not_started',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export async function fetchKycStatus() {
  if (useHttpApi()) return apiRequest('/v1/client/kyc-status', { method: 'GET' });
  await delay(180);
  return { ...FIXTURE_KYC };
}

export async function updateKycDepth(payload) {
  if (useHttpApi()) return apiRequest('/v1/client/kyc-depth', { method: 'POST', body: payload });
  await delay(280);
  return { ...FIXTURE_KYC, ...payload, updatedAt: new Date().toISOString() };
}
