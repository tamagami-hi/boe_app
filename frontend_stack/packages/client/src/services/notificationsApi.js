import { fixtureNotifications } from '../data/fixtureNotifications.js';
import { resolveInternalPath } from '../navigation/routes.js';
import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

let items = clone(fixtureNotifications);

// The inbox screen groups by `ts` and follows `deepLink`; the wire carries the
// timestamp as `createdAt` and any target inside the event payload.
//
// `deepLink` crosses a trust boundary: it is authored server-side (and in some
// events, by an operator) and used to be handed straight to React Router. It is
// resolved against the canonical route manifest here, at the service edge rather
// than in the page, so every consumer of a notification gets an already-safe
// value. Anything that is not a known internal route becomes null and the row
// simply is not tappable — a notification must never be able to steer the app to
// an arbitrary path, and a stale target must not look like the app restarting.
// Both a stable destination id and a legacy `/app/...` path are accepted.
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
  // Fixtures get the same guarantee as the wire: a dev/demo run must not behave
  // differently from production, or an unsafe target would only surface later.
  return clone(items).map((item) => ({
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
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n));
}

export async function markAllRead() {
  if (useHttpApi()) {
    const notifications = await listNotifications();
    await Promise.all(notifications.filter((n) => !n.read).map((n) => markRead(n.id)));
    return;
  }

  await delay(80);
  items = items.map((n) => ({ ...n, read: true }));
}
