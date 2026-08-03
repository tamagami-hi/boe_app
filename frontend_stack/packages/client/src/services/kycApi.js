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

// --- KYC standing ---------------------------------------------------------
// The status screen reads the investor's current KYC case: whether it exists, its
// state, and when it expires. There is no document/FATCA/nominee capture — nothing
// stores that today, so nothing here writes it.

export async function fetchKycStatus() {
  if (useHttpApi()) return apiRequest('/v1/client/kyc-status', { method: 'GET' });
  await delay(180);
  return {
    status: 'not_started',
    kycState: null,
    method: 'email_otp',
    expiresAt: null,
    expired: false,
    submittedAt: null,
    decidedAt: null,
  };
}
