import { apiRequest, useHttpApi } from '@beonedge/client/services/_util.js';
import { listPendingApprovals } from '@beonedge/client/services/authApi.js';
import { listPendingApplications } from '@beonedge/client/services/adminApplicationsApi.js';
import { collectionKey, normalizeAdminCollection, normalizeApprovalRow } from './formatters.js';

/*
 * There is no `/v1/admin/overview` endpoint, and there is no longer a function
 * pretending to stand in for one.
 *
 * `loadAdminOverview` used to re-fetch the applications queue — three more
 * requests, on every admin page load, duplicating what the `/v1/admin/approvals`
 * collection below already fetches — purely to produce counts. The counts are now
 * derived in the context from the collections it already has, which is both
 * cheaper and impossible to get out of step with the table the operator is
 * looking at.
 */

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
    // Drives what the review panel tells the operator will happen on approval:
    // an account they can sign into, or an emailed activation invitation.
    hasSignupPassword: application.hasSignupPassword ?? false,
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
