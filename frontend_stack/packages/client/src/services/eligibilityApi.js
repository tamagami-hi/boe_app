// Derived investing eligibility (spec 03 §2.3), native-authenticated. Eligibility
// is derived server-side from the live account state, latest Email Verification case, and latest
// risk assessment on every read; it is never cached client-side or stored in a
// token. The UI uses `canInvest` to gate investment flows and `reason` to render
// the actionable next step (Email Verification / risk assessment).
import { apiRequest } from './_util.js';

export async function getInvestingEligibility() {
  return apiRequest('/v1/client/eligibility');
}
