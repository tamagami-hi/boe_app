import { apiRequest } from './_util.js';

// --- Email-OTP Email Verification (canonical, RA-C.10) -----------------------------------
// The client requests a code (emailed from the company mailbox), then submits it
// to complete Email Verification — after which the client is eligible to invest. There is no
// risk questionnaire (risk is a fund attribute the client chooses).

/** Request an Email OTP Verification code to the client's email. */
export async function startEmailVerification() {
  return apiRequest('/v1/client/email-verification/start', { method: 'POST' });
}

/** Resend the Email OTP Verification code (cooldown-guarded server-side). */
export async function resendEmailVerification() {
  return apiRequest('/v1/client/email-verification/resend', { method: 'POST' });
}

/** Submit the 6-character code to complete Email Verification. */
export async function verifyEmailVerification(code) {
  return apiRequest('/v1/client/email-verification/verify', { method: 'POST', body: { code } });
}

// --- Email Verification standing ---------------------------------------------------------
// The status screen reads the investor's current Email Verification case: whether it exists, its
// state, and when it expires. There is no document/FATCA/nominee capture — nothing
// stores that today, so nothing here writes it.

export async function fetchEmailVerificationStatus() {
  return apiRequest('/v1/client/email-verification-status', { method: 'GET' });
}
