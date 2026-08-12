// Admin applications queue (spec 04 §3.2), over the canonical web-cookie + CSRF
// admin surface. apiRequest (scope 'admin') carries the session cookie and the
// synchronizer CSRF token; unsafe mutations additionally send an Idempotency-Key.
// Returned payloads are already
// unwrapped from the { data } envelope by apiRequest.
import { apiRequest } from './_util.js';

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** List applications by state (default: the actionable submitted). */
export async function listApplications({ status, after, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (after) params.set('after', after);
  params.set('limit', String(limit));
  return apiRequest(`/v1/admin/applications?${params.toString()}`, { scope: 'admin' });
}

/**
 * The approval queue, newest first.
 *
 * A signup arriving from the marketing site lands directly in `submitted`
 * and stays there until an operator approves or rejects it — there is no
 * pre-approval email confirmation and no separate review state.
 */
export async function listPendingApplications() {
  const submitted = await listApplications({ status: 'submitted' });
  return submitted?.items ?? [];
}

/**
 * Single-step terminal decision. `outcome` is 'approved' | 'rejected'.
 * No request body: the decision carries no reason and no unverified-email
 * acknowledgement — approval always creates an active user with the signup
 * password and emails the app download link.
 */
export async function decideApplication(applicationId, outcome, requestIdempotencyKey = idempotencyKey()) {
  return apiRequest(
    `/v1/admin/applications/${encodeURIComponent(applicationId)}/decision?outcome=${encodeURIComponent(outcome)}`,
    {
      method: 'POST',
      scope: 'admin',
      headers: { 'idempotency-key': requestIdempotencyKey },
    },
  );
}
