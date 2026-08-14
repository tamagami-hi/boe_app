import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Repeat, Bell, BellOff, TrendingUp, ArrowDownToLine } from 'lucide-react';
import { EmptyState, ErrorState } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as notificationsApi from '../services/notificationsApi.js';
import { fmtDate } from '../utils/format.js';
import { HOME_PATH } from '../navigation/routes.js';

/**
 * Icons and labels are keyed on the `kind` the backend actually writes.
 *
 * These previously used a different vocabulary entirely (`payment`, `mandate`,
 * `strategy`, `system`) which matched none of the kinds any producer emits, so
 * every real notification fell through to the generic bell. The keys below are
 * the four kinds in the backend today plus the update prompt.
 */
const ICONS = {
  order_booked: CreditCard,
  redemption_settled: Repeat,
  portfolio_updated: TrendingUp,
  app_update_available: ArrowDownToLine,
  system: Bell,
};
const KIND_LABEL = {
  order_booked: 'Investment',
  redemption_settled: 'Redemption',
  portfolio_updated: 'Portfolio',
  app_update_available: 'App update',
  system: 'System',
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

function group(items) {
  const t = startOfDay(new Date());
  const y = t - 86400000;
  return items.reduce((acc, n) => {
    const ts = startOfDay(new Date(n.ts));
    const k = ts === t ? 'Today' : ts === y ? 'Yesterday' : 'Earlier';
    (acc[k] = acc[k] || []).push(n);
    return acc;
  }, {});
}

function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24 && startOfDay(d) === startOfDay(now)) {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }
  return fmtDate(iso).split(' ').slice(0, 2).join(' ');
}

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState(null);
  // `.catch(() => setItems([]))` made a failed read indistinguishable from an
  // empty inbox, so a backend hiccup told the user they had no notifications.
  const load = useCallback(() => {
    setLoadError(null);
    notificationsApi.listNotifications()
      .then((rows) => { setItems(rows); setLoadError(null); })
      .catch((error) => setLoadError(error));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function open(n) {
    if (!n.read) await notificationsApi.markRead(n.id);
    setItems((s) => s.map((x) => x.id === n.id ? { ...x, read: true } : x));
    if (n.kind === 'app_update_available') {
      // No deep link for this one: the update lives in a dialog, not a route.
      // Send the user home and let the launch gate re-offer it there.
      navigate(HOME_PATH);
      return;
    }
    if (n.deepLink) navigate(n.deepLink);
  }
  async function readAll() {
    await notificationsApi.markAllRead();
    setItems((s) => s.map((x) => ({ ...x, read: true })));
  }

  const unreadCount = useMemo(() => items.filter((x) => !x.read).length, [items]);
  const groups = group(items);

  return (
    <>
      <AppBar title="Notifications" />
      <div className="apk-screen">
        <div className="apk-section-head apk-notif-head">
          <div className="apk-notif-head-meta">
            <span className="be-eyebrow">Inbox</span>
            <span className="apk-notif-count" aria-live="polite">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </span>
          </div>
          <button
            type="button"
            className="apk-link"
            onClick={readAll}
            disabled={unreadCount === 0}
            aria-label="Mark all notifications as read"
          >
            Mark all read
          </button>
        </div>
        {loadError ? (
          <ErrorState
            title="We could not load your notifications"
            description="This screen could not reach the server."
            onRetry={load}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BellOff size={24} strokeWidth={1.4} />}
            title="You're all caught up"
            description="No notifications right now. We'll let you know when there's something to act on."
          />
        ) : (
          ['Today', 'Yesterday', 'Earlier'].map((k) => groups[k] && (
            <section key={k} className="apk-notif-group" aria-label={k}>
              <div className="be-eyebrow apk-notif-group-head">{k}</div>
              <div className="be-card apk-notif-card">
                {groups[k].map((n) => {
                  const Icon = ICONS[n.kind] || Bell;
                  const label = KIND_LABEL[n.kind] || 'Notification';
                  return (
                    /* A real button. It was a `div role="button" tabIndex` with a
                       hand-rolled Enter/Space handler — the element gives that for
                       free, and correctly. */
                    <button
                      key={n.id}
                      type="button"
                      className={'apk-notif' + (n.read ? '' : ' is-unread')}
                      aria-label={`${label}: ${n.title}${n.read ? '' : ', unread'}`}
                      onClick={() => open(n)}
                    >
                      <div className="apk-notif-icon" aria-hidden="true">
                        <Icon size={16} strokeWidth={1.5} />
                      </div>
                      <div className="apk-notif-content">
                        <div className="apk-notif-row">
                          <div className="apk-notif-title">{n.title}</div>
                          <div className="apk-notif-ts" title={fmtDate(n.ts, { withTime: true })}>
                            {fmtRelative(n.ts)}
                          </div>
                        </div>
                        <div className="apk-notif-body">{n.body}</div>
                        <div className="apk-notif-meta">
                          <span className="apk-notif-chip">{label}</span>
                          {!n.read && <span className="apk-notif-dot" aria-hidden="true" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
