import { resolveInternalPath } from '../navigation/routes.js';
import { apiRequest, listFromPayload } from './_util.js';

function mapNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    read: !!row.read,
    ts: row.createdAt,
    deepLink: resolveInternalPath(row.payload?.deepLink ?? null),
  };
}

export async function listNotifications() {
  return listFromPayload(await apiRequest('/v1/client/notifications')).map(mapNotification);
}

export async function markRead(id) {
  await apiRequest(`/v1/client/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { read: true },
  });
}

export async function markAllRead() {
  const notifications = await listNotifications();
  await Promise.all(notifications.filter((n) => !n.read).map((n) => markRead(n.id)));
}
