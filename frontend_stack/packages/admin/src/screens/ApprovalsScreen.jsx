import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  UserCheck, ShieldCheck, LineChart, Layers, TrendingUp, PieChart,
  CreditCard, Repeat, BookOpen, Inbox, LifeBuoy, History, Settings,
  Search, Bell, Plus, MoreHorizontal, LayoutGrid, Trash2, Save, RotateCcw, LogOut,
  X, CheckCircle2, XCircle, Clock, Timer, TrendingDown, Filter, User, Mail, Phone, Shield, FileText,
  BarChart3, Activity, Eye, EyeOff, AlertTriangle, Pencil, Gauge, Percent, Briefcase, Archive, ChevronRight, ClipboardList, ArrowLeft,
  Copy,
} from 'lucide-react';
import {
  RiskBadge, LifecycleBadge, StatusBadge,
} from '@beonedge/shared/components/Badges.jsx';
import { SectorMiniBar } from '@beonedge/shared/components/SectorMiniBar.jsx';

import logo from '@beonedge/shared/assets/logo.svg';
import {
  COMPONENT_LIBRARY,
  loadRemoteAppConfig,
  loadAppConfig,
  publishAppConfig,
  resetAppConfig,
} from '@beonedge/shared/appConfig.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { apiRequest, listFromPayload, useHttpApi } from '@beonedge/client/services/_util.js';
import { listPendingApprovals } from '@beonedge/client/services/authApi.js';
import '../styles/desktop/admin.css';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import ApprovalStatusBadge from '../components/ApprovalStatusBadge.jsx';
import SkeletonTile from '../components/SkeletonTile.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import { fmtDateTime, fmtInt } from '../helpers/formatters.js';
import { initials } from '../helpers/formatters.js';

const EMPTY_APPROVALS_META = { updatedAt: null, syncing: false, truncated: false, error: '' };

/** "just now" / "2m ago" — enough for the operator to judge staleness at a glance. */
function relativeTime(timestamp) {
  if (!timestamp) return 'not yet loaded';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function ApprovalsScreen({
  rows = [],
  loading = false,
  onApprove,
  onReject,
  onNavigateToUsers,
  busy = false,
  meta = EMPTY_APPROVALS_META,
  onRefresh,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  /*
   * Re-render on a timer purely so the "updated Ns ago" label keeps counting.
   * Without it the label freezes at the value it had when the data arrived, which
   * reads as "fresh" no matter how old it is — worse than showing nothing.
   *
   * Gated on there being a timestamp to age and on the tab being visible: a
   * hidden tab has nobody reading the label, and the provider stops polling then
   * anyway, so ticking would be pure wakeups.
   */
  const [, setNow] = useState(0);
  const updatedAt = meta.updatedAt;
  useEffect(() => {
    if (!updatedAt || typeof document === 'undefined') return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') setNow((count) => count + 1);
    };
    const timer = setInterval(tick, 10000);
    return () => clearInterval(timer);
  }, [updatedAt]);

  const visibleRows = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    return !q || r.name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q);
  });

  /*
   * Export what the operator is looking at, filters included — an export that
   * silently differs from the table on screen is worse than none. Built and
   * revoked in the handler so nothing is held after the download starts.
   */
  function exportCsv() {
    const header = ['Name', 'Email', 'Phone', 'Status', 'Signed up'];
    const cell = (value) => `"${String(value ?? '').replace(/"/gu, '""')}"`;
    const csv = [
      header.map(cell).join(','),
      ...visibleRows.map((row) =>
        [
          row.name,
          row.email,
          row.phone,
          row.status,
          row.createdAt,
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\r\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `boe-approvals-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        {loading ? (
          <SkeletonTile />
        ) : (
          <StatTile label="Pending approval" value={fmtInt(rows.length)} icon={Inbox} tone="amber" hint="Submitted on the website, awaiting your decision" />
        )}
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Pending Queue</span>
            <h2 className="adm-card-title">Awaiting approval</h2>
          </div>
          <div className="adm-card-actions">
            <span className="adm-muted" aria-live="polite">
              {meta.syncing ? 'Refreshing...' : `Updated ${relativeTime(meta.updatedAt)}`}
            </span>
            <button
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={() => onRefresh?.()}
              disabled={meta.syncing || busy}
              title={busy ? 'Finishing the current decision' : 'Re-read the pending queue now'}
            >
              Refresh
            </button>
            <button
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={exportCsv}
              disabled={visibleRows.length === 0}
              title={visibleRows.length === 0 ? 'Nothing to export' : 'Download the rows shown below as CSV'}
            >
              Export CSV
            </button>
          </div>
        </div>

        {meta.error && (
          <div className="adm-inline-note" role="status">
            Could not refresh the queue: {meta.error}
          </div>
        )}
        {meta.truncated && (
          <div className="adm-inline-note" role="status">
            Showing the most recent {rows.length} requests. The queue is longer than one page — decide
            some of these to see the rest.
          </div>
        )}

        <div className="adm-toolbar">
          <div className="adm-search">
            <I icon={Search} size={14} />
            <input
              type="text"
              aria-label="Search approvals by name or email"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th className="adm-col-user">User</th>
                <th className="adm-col-date">Signed up</th>
                <th className="adm-col-status">Status</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading && visibleRows.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={4} />
                  <SkeletonTableRow columnCount={4} />
                  <SkeletonTableRow columnCount={4} />
                  <SkeletonTableRow columnCount={4} />
                  <SkeletonTableRow columnCount={4} />
                </>
              )}
              {!loading && visibleRows.length === 0 && (
                <EmptyTableRow colSpan={4}>
                  {rows.length === 0
                    ? 'No signups are waiting. A new application appears here as soon as it is submitted on the website.'
                    : 'No records match the current search.'}
                </EmptyTableRow>
              )}
              {visibleRows.map((r) => (
                <tr key={r.id || r.email}>
                  <td className="adm-col-user" data-label="User">
                    <div className="adm-user">
                      <div className="adm-avatar adm-avatar-sm">{initials(r.name, 'CL')}</div>
                      <div className="adm-user-info">
                        <div className="adm-user-name">{r.name}</div>
                        <div className="adm-cell-meta">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="adm-col-date" data-label="Signed up">
                    <span className="adm-cell-meta">{fmtDateTime(r.createdAt)}</span>
                  </td>
                  <td className="adm-col-status" data-label="Status">
                    <ApprovalStatusBadge status={r.status} />
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <button className="be-btn be-btn-primary be-btn-sm" onClick={() => onApprove?.(r)} disabled={busy}>Approve</button>
                    <button className="be-btn be-btn-secondary be-btn-sm" onClick={() => onReject?.(r)} disabled={busy}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rows.length === 0 && !loading && (
        <div className="adm-empty-hint">
          Looking for approved users?{' '}
          <button type="button" className="ash-btn ash-btn-primary" onClick={onNavigateToUsers}>
            View User Details
          </button>
        </div>
      )}
    </div>
  );
}

export default ApprovalsScreen;
