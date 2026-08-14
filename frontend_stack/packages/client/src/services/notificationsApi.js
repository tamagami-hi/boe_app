import { fixtureNotifications } from '../data/fixtureNotifications.js';
import { resolveInternalPath } from '../navigation/routes.js';
import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

let items = null;
function fixtureItems() {
  if (items === null) items = clone(fixtureNotifications);
  return items;
}

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
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/notifications')).map(mapNotification);
  }

  await delay();
  return clone(fixtureItems()).map((item) => ({
    ...item,
    deepLink: resolveInternalPath(item.deepLink ?? null),
  }));
}

export async function markRead(id) {
  if (useHttpApi()) {
    await apiRequest(`/v1/client/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { read: true },
    });
    return;
  }

  await delay(60);
  items = fixtureItems().map((n) => (n.id === id ? { ...n, read: true } : n));
}

export async function markAllRead() {
  if (useHttpApi()) {
    const notifications = await listNotifications();
    await Promise.all(notifications.filter((n) => !n.read).map((n) => markRead(n.id)));
    return;
  }

  await delay(80);
  items = fixtureItems().map((n) => ({ ...n, read: true }));
}
