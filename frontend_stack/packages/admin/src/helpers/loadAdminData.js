import { apiRequest, useHttpApi } from '@beonedge/client/services/_util.js';
import { listPendingApprovals } from '@beonedge/client/services/authApi.js';
import { listPendingApplications } from '@beonedge/client/services/adminApplicationsApi.js';
import { collectionKey, normalizeAdminCollection, normalizeApprovalRow } from './formatters.js';

export async function loadAdminOverview() {
  if (!useHttpApi()) {
    const approvals = await listPendingApprovals();
    return {
      source: 'fixture',
      counts: { approvals: approvals.length },
      stats: { pendingApprovals: approvals.length },
    };
  }
  // Derive the counts from the canonical applications queue (there is no
  // separate overview endpoint in the canonical first slice).
  //
  // The queue now also carries applications whose email is not yet confirmed, so
  // the two are counted apart: "ready for review" must mean "waiting on the
  // operator", not "waiting on the applicant", or the badge sends someone to a
  // screen where there is nothing they can act on.
  const pending = await listPendingApplications().catch(() => []);
  const actionable = pending.filter((row) => row.status !== 'pending_email_verification');
  const awaitingEmail = pending.length - actionable.length;
  return {
    source: 'http',
    counts: { approvals: actionable.length },
    stats: { pendingApprovals: actionable.length, awaitingEmailConfirmation: awaitingEmail },
  };
}

// Map a canonical application list item to the admin approval row shape, keeping
// the applicationId + version needed for the review/decision handshake.
function toApprovalRow(application) {
  return {
    ...normalizeApprovalRow({
      id: application.applicationId,
      name: application.fullName,
      email: application.email,
      phone: application.phone,
      status: application.status,
      createdAt: application.createdAt,
    }),
    applicationId: application.applicationId,
    version: application.version,
    emailVerifiedAt: application.emailVerifiedAt ?? null,
    isPiiTombstoned: application.isPiiTombstoned ?? false,
  };
}

function extractAdminCollection(payload, path) {
  const key = collectionKey(path);
  const data = payload?.data ?? payload ?? [];
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

export async function loadAdminCollection(path) {
  if (!useHttpApi()) {
    return path.endsWith('/approvals') ? listPendingApprovals() : [];
  }
  // The approvals screen is backed by the canonical applications queue.
  if (path.endsWith('/approvals')) {
    const applications = await listPendingApplications();
    return applications.map(toApprovalRow);
  }
  const payload = await apiRequest(path, { scope: 'admin' });
  return normalizeAdminCollection(extractAdminCollection(payload, path), path);
}
