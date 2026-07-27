// Derived investing eligibility (spec 03 §2.3), native-authenticated. Eligibility
// is derived server-side from the live account state, latest KYC case, and latest
// risk assessment on every read; it is never cached client-side or stored in a
// token. The UI uses `canInvest` to gate investment flows and `reason` to render
// the actionable next step (KYC / risk assessment).
import { apiRequest, delay, useHttpApi } from './_util.js';

const FIXTURE_ELIGIBILITY = {
  eligibility: 'eligible',
  reason: null,
  canInvest: true,
  kycState: 'approved',
  riskState: 'assessed',
  evaluatedAt: '2025-05-02T18:30:00.000Z',
};

export async function getInvestingEligibility() {
  if (useHttpApi()) return apiRequest('/v1/client/eligibility');

  await delay(80);
  return { ...FIXTURE_ELIGIBILITY };
}
