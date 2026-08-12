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

/**
 * List applications by state (default: the actionable submitted).
 *
 * Returns the full `{ ok, data, meta }` envelope, not just the data: keyset
 * pagination lives in `meta.page.nextCursor`, and unwrapping it here is what made
 * the queue silently single-page.
 */
export async function listApplications({ status, after, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (after) params.set('after', after);
  params.set('limit', String(limit));
  return apiRequest(`/v1/admin/applications?${params.toString()}`, { scope: 'admin', envelope: true });
}

/*
 * Bound on how much of the queue one refresh will walk. The endpoint is keyset
 * paginated and this used to read only the first page, so a backlog over the page
 * size was silently invisible to the operator — the table looked complete and was
 * not. Following the cursor fixes that; the bound keeps a runaway queue from
 * turning a refresh into an unbounded request loop, and callers on a timer pass a
 * smaller one so a background poll is not ten sequential requests.
 */
const MAX_QUEUE_PAGES = 10;
const QUEUE_PAGE_SIZE = 100;

/**
 * The approval queue, newest first.
 *
 * A signup arriving from the marketing site lands directly in `submitted`
 * and stays there until an operator approves or rejects it — there is no
 * pre-approval email confirmation and no separate review state.
 *
 * Returns `{ items, truncated }`: `truncated` is true when the queue is longer
 * than this walk, so the caller can say so rather than imply the list is whole.
 */
export async function listPendingApplications({ maxPages = MAX_QUEUE_PAGES } = {}) {
  const pageLimit = Math.max(1, Math.min(maxPages, MAX_QUEUE_PAGES));
  const items = [];
  let after;
  for (let page = 0; page < pageLimit; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- keyset pagination is inherently sequential
    const payload = await listApplications({ status: 'submitted', limit: QUEUE_PAGE_SIZE, after });
    items.push(...(payload?.data?.items ?? []));
    const nextCursor = payload?.meta?.page?.nextCursor ?? null;
    if (!nextCursor) return { items, truncated: false };
    after = nextCursor;
  }
  return { items, truncated: true };
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
