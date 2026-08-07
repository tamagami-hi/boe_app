import { useState } from 'react';
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

function ApprovalsScreen({ rows = [], stats = {}, loading = false, onReview, onApprove, onUserDetail, onNavigateToUsers, busy = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredRows = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || r.name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || String(r.status || '').toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  const visibleRows = filteredRows;

  /*
   * An unconfirmed email no longer blocks approval outright — it requires the
   * reviewer to acknowledge it, which the review panel asks for. The inline
   * Approve button cannot collect that acknowledgement, so these rows are sent
   * through Review instead of being given a one-click action that would fail.
   */
  const awaitingEmail = (row) =>
    String(row.status || '').toLowerCase() === 'pending_email_verification' || !row.emailVerifiedAt;

  /*
   * Every tile counts the queue actually loaded. They previously read
   * `stats.approvedTotal` / `stats.rejectedTotal`, which no endpoint supplies —
   * and because the formatter renders a missing number as "0", the screen stated
   * that there were zero approved clients, which is a claim rather than a gap.
   */
  const awaitingEmailCount = rows.filter(awaitingEmail).length;
  const inReviewCount = rows.filter((row) => String(row.status || '').toLowerCase() === 'in_review').length;
  const readyCount = rows.length - awaitingEmailCount - inReviewCount;

  /*
   * Export what the operator is looking at, filters included — an export that
   * silently differs from the table on screen is worse than none. Built and
   * revoked in the handler so nothing is held after the download starts.
   */
  function exportCsv() {
    const header = ['Name', 'Email', 'Phone', 'Status', 'Email confirmed', 'Signed up'];
    const cell = (value) => `"${String(value ?? '').replace(/"/gu, '""')}"`;
    const csv = [
      header.map(cell).join(','),
      ...visibleRows.map((row) =>
        [
          row.name,
          row.email,
          row.phone,
          row.status,
          row.emailVerifiedAt ? 'yes' : 'no',
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
          <>
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
          </>
        ) : (
          <>
            <StatTile label="Ready for review" value={fmtInt(readyCount)} icon={Clock} tone="amber" hint="Email confirmed, awaiting your decision" />
            <StatTile label="In review" value={fmtInt(inReviewCount)} icon={ClipboardList} tone="slate" hint="Opened for review, not yet decided" />
            <StatTile label="Email not confirmed" value={fmtInt(awaitingEmailCount)} icon={Mail} tone="slate" hint="Applicant has not opened the link yet" />
            <StatTile label="Total waiting" value={fmtInt(rows.length)} icon={Inbox} tone="slate" hint="Everything in the queue" />
          </>
        )}
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Pending Queue</span>
            <h2 className="adm-card-title">Awaiting approval</h2>
          </div>
          <div className="adm-card-actions">
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
          <div className="adm-filter">
            <I icon={Filter} size={14} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="all">All pending</option>
              <option value="submitted">Ready for review</option>
              <option value="in_review">In review</option>
              <option value="pending_email_verification">Email not confirmed</option>
            </select>
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
                    ? 'No signups are waiting. A new application appears here as soon as it is submitted on the website, even before the applicant confirms their email.'
                    : 'No records match the current filter.'}
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
                    <button className="be-btn be-btn-secondary be-btn-sm" onClick={() => onReview?.(r)}>Review</button>
                    <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => onUserDetail?.(r)}>View</button>
                    {awaitingEmail(r) ? (
                      <button
                        className="be-btn be-btn-primary be-btn-sm"
                        onClick={() => onReview?.(r)}
                        title="This applicant has not confirmed their email. Open Review to approve them anyway."
                      >
                        Review to approve
                      </button>
                    ) : (
                      <button className="be-btn be-btn-primary be-btn-sm" onClick={() => onApprove?.(r)} disabled={busy}>Approve</button>
                    )}
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
