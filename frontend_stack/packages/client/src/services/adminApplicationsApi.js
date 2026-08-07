// Admin applications queue (spec 04 §3.2), over the canonical web-cookie + CSRF
// admin surface. apiRequest (scope 'admin') carries the session cookie and the
// synchronizer CSRF token; unsafe mutations additionally send an Idempotency-Key
// and (for the decision) an If-Match version. Returned payloads are already
// unwrapped from the { data } envelope by apiRequest.
import { apiRequest } from './_util.js';

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** List applications by state (default: the actionable submitted + in_review). */
export async function listApplications({ status, after, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (after) params.set('after', after);
  params.set('limit', String(limit));
  return apiRequest(`/v1/admin/applications?${params.toString()}`, { scope: 'admin' });
}

/**
 * The review queue, newest first.
 *
 * Three states, not two. `submitted` and `in_review` are the actionable ones,
 * but a signup arriving from the marketing site starts at
 * `pending_email_verification` and stays there until the visitor redeems the
 * emailed token. Fetching only the actionable two made those signups invisible:
 * an operator told "I just signed up" saw an empty queue and had no way to tell
 * a signup that never arrived from one waiting on its confirmation email. They
 * are returned here so the screen can show them as awaiting confirmation, and
 * are not actionable — the backend refuses a decision until the email is
 * verified.
 */
export async function listPendingApplications() {
  const [awaitingEmail, submitted, inReview] = await Promise.all([
    listApplications({ status: 'pending_email_verification' }),
    listApplications({ status: 'submitted' }),
    listApplications({ status: 'in_review' }),
  ]);
  return [
    ...(submitted?.items ?? []),
    ...(inReview?.items ?? []),
    ...(awaitingEmail?.items ?? []),
  ];
}

export async function getApplicationDetail(applicationId) {
  return apiRequest(`/v1/admin/applications/${encodeURIComponent(applicationId)}`, { scope: 'admin' });
}

export async function startApplicationReview(applicationId, expectedVersion) {
  return apiRequest(`/v1/admin/applications/${encodeURIComponent(applicationId)}/review`, {
    method: 'POST',
    scope: 'admin',
    headers: { 'idempotency-key': idempotencyKey() },
    body: { expectedVersion },
  });
}

export async function decideApplication(applicationId, expectedVersion, outcome, reasonCode, reasonDetail) {
  return apiRequest(
    `/v1/admin/applications/${encodeURIComponent(applicationId)}/decision?outcome=${encodeURIComponent(outcome)}`,
    {
      method: 'POST',
      scope: 'admin',
      headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${expectedVersion}"` },
      body: { reasonCode, ...(reasonDetail ? { reasonDetail } : {}) },
    },
  );
}

/**
 * Resolve an application to a terminal decision. The backend requires the
 * `submitted -> in_review` transition before a decision, so a submitted
 * application is moved to in_review first (which increments its version); the
 * decision then uses the post-review version for its If-Match precondition.
 * `outcome` is 'approved' | 'rejected'.
 */
export async function resolveApplication({ applicationId, version, status, outcome, reasonCode, reasonDetail }) {
  let currentVersion = version;
  if (status === 'submitted') {
    const reviewed = await startApplicationReview(applicationId, currentVersion);
    currentVersion = reviewed.version;
  }
  return decideApplication(applicationId, currentVersion, outcome, reasonCode, reasonDetail);
}

export async function resendActivationInvite(userId, expectedInviteId, reasonCode) {
  return apiRequest(`/v1/admin/users/${encodeURIComponent(userId)}/activation-invites/resend`, {
    method: 'POST',
    scope: 'admin',
    headers: { 'idempotency-key': idempotencyKey() },
    body: { reasonCode, expectedInviteId },
  });
}
