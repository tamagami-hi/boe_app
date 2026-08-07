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
 * a signup that never arrived from one waiting on its confirmation email.
 *
 * All three are actionable. A `pending_email_verification` row can be reviewed
 * and decided, because the confirmation mail is not guaranteed to arrive and
 * gating review on it left those applications permanently stuck. Approving one
 * requires the reviewer to acknowledge the unconfirmed address; the screen asks
 * for that, and `resolveApplication` forwards it.
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

export async function decideApplication(
  applicationId,
  expectedVersion,
  outcome,
  reasonCode,
  reasonDetail,
  { allowUnverifiedEmail = false } = {},
) {
  return apiRequest(
    `/v1/admin/applications/${encodeURIComponent(applicationId)}/decision?outcome=${encodeURIComponent(outcome)}`,
    {
      method: 'POST',
      scope: 'admin',
      headers: { 'idempotency-key': idempotencyKey(), 'if-match': `"${expectedVersion}"` },
      body: { reasonCode, allowUnverifiedEmail, ...(reasonDetail ? { reasonDetail } : {}) },
    },
  );
}

/**
 * Resolve an application to a terminal decision. `outcome` is
 * 'approved' | 'rejected'.
 *
 * The state and version are re-read from the server first, rather than trusted
 * from the row the operator clicked. That row comes from a list fetched when the
 * screen mounted, and the decision carries the version as an If-Match
 * precondition, so any change since that fetch — another operator, the applicant
 * finally confirming their email, or a previous attempt of this very action that
 * completed its review step and then failed — made the precondition stale and
 * produced a 409 that no amount of retrying could clear. One extra GET is worth
 * more than an approval queue that jams.
 *
 * The `submitted|pending_email_verification -> in_review` handshake is driven off
 * that fresh state for the same reason: keying it off the snapshot's status
 * string meant a row that had already moved skipped a handshake it still needed,
 * or repeated one it did not.
 */
export async function resolveApplication({
  applicationId,
  outcome,
  reasonCode,
  reasonDetail,
  allowUnverifiedEmail = false,
}) {
  const detail = await getApplicationDetail(applicationId);
  const current = detail?.application ?? {};
  let currentVersion = current.version;
  const currentStatus = current.status;

  if (currentStatus === 'approved' || currentStatus === 'rejected') {
    const error = new Error(
      `This application was already ${currentStatus}. The queue has been refreshed.`,
    );
    error.code = 'STATE_CONFLICT';
    throw error;
  }

  if (currentStatus !== 'in_review') {
    const reviewed = await startApplicationReview(applicationId, currentVersion);
    currentVersion = reviewed.version;
  }

  return decideApplication(applicationId, currentVersion, outcome, reasonCode, reasonDetail, {
    allowUnverifiedEmail,
  });
}

export async function resendActivationInvite(userId, expectedInviteId, reasonCode) {
  return apiRequest(`/v1/admin/users/${encodeURIComponent(userId)}/activation-invites/resend`, {
    method: 'POST',
    scope: 'admin',
    headers: { 'idempotency-key': idempotencyKey() },
    body: { reasonCode, expectedInviteId },
  });
}
