import { useEffect, useRef, useState } from 'react';
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
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import { fmtInt } from '../helpers/formatters.js';

/*
 * Read-only register.
 *
 * The Pause and Revoke buttons that used to sit in each row had no `onClick` and
 * no endpoint behind them — the backend exposes no mandate mutation at all — so
 * they were decoration that read as capability. A mandate is an authorisation the
 * customer gave their bank; pausing or revoking it is something they or the
 * provider does, not something an operator asserts here. The same applied to
 * "Filter status", which had no handler either; the status column is sortable by
 * eye and the register is small, so it is simply gone rather than faked.
 */
function MandatesScreen({ rows = [], onUserDetail }) {
  const sb = s => ({
    active: <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Active</span>,
    pending_user_auth: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Pending auth</span>,
    paused: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Paused</span>,
    revoked: <span className="be-badge be-badge-failed"><span className="be-badge-dot"/>Revoked</span>,
  }[s]);

  // Counted from the loaded register. The previous tiles read stats.* keys that no
  // endpoint supplies, and the formatter turned those into a confident "0".
  const countBy = (status) => rows.filter((row) => row.status === status).length;

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Active mandates" value={fmtInt(countBy('active'))}/>
        <StatTile label="Pending auth" value={fmtInt(countBy('pending_user_auth'))}/>
        <StatTile label="Paused" value={fmtInt(countBy('paused'))}/>
        <StatTile label="Revoked" value={fmtInt(countBy('revoked'))}/>
      </div>
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Mandates</span>
            <h2 className="adm-card-title">Active register</h2>
          </div>
          <div className="adm-payment-count">{rows.length}</div>
        </div>
        <p className="adm-screen-note">
          Mandates are authorised, paused and revoked through the payment provider and the
          customer&rsquo;s bank. This register is the record of them.
        </p>
        <table>
          <thead><tr>
            <th>Mandate</th><th>User</th><th>Amount</th><th>Debit day</th><th>Status</th><th>Last debit</th><th>Next</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyTableRow colSpan={8}>No mandate records are available in the active data store.</EmptyTableRow>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td><code className="adm-code">{r.id}</code></td>
                <td>{r.user}</td>
                <td className="be-money">{r.amount}</td>
                <td className="be-num">{r.day}</td>
                <td>{sb(r.status)}</td>
                <td className="adm-cell-meta">{r.last}</td>
                <td className="adm-cell-meta">{r.next}</td>
                <td className="adm-cell-actions">
                  <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => onUserDetail?.(r)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MandatesScreen;
