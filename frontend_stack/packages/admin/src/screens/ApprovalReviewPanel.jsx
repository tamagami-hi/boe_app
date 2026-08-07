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
import I from '../components/I.jsx';
import ApprovalStatusBadge from '../components/ApprovalStatusBadge.jsx';
import { initials } from '../helpers/formatters.js';
import { fmtDateTime } from '../helpers/formatters.js';

function ApprovalReviewPanel({
  row,
  reason,
  busy,
  error,
  allowUnverifiedEmail = false,
  onAllowUnverifiedEmailChange,
  onReasonChange,
  onClose,
  onDecision,
}) {
  if (!row) return null;

  // A decided application is history, not work: the panel shows it but offers no
  // decision, because the backend refuses a second one and offering the button
  // only produces a conflict the operator cannot act on.
  const isDecided = row.status === 'approved' || row.status === 'rejected';
  const emailConfirmed = Boolean(row.emailVerifiedAt);
  // Approving someone who never confirmed their address is a judgement call, so
  // it needs a deliberate tick rather than being allowed by default.
  const approveBlocked = !emailConfirmed && !allowUnverifiedEmail;

  const identityDetails = [
    ['Name', row.name || 'Client'],
    ['Phone', row.phone || 'Not provided'],
    // Applications carry no role — a role is granted to a user, and an applicant
    // is not one yet. `displayRole` defaults to "Admin" when it finds no role
    // field, so this panel used to label every applicant an admin.
    ['Applied', row.createdAt ? fmtDateTime(row.createdAt) : 'Not recorded'],
  ];

  const contactDetails = [
    ['Email', row.email || 'Not provided'],
    ['Email confirmed', emailConfirmed ? fmtDateTime(row.emailVerifiedAt) : 'Not confirmed'],
    ['Application', row.applicationId || row.id || 'Not assigned'],
  ];

  const statusDetails = [
    ['Application state', row.status || 'pending'],
    [
      'Password',
      row.hasSignupPassword
        ? 'Chosen at signup'
        : 'Set by activation invitation',
    ],
    [
      'On approval',
      row.hasSignupPassword
        ? 'Account opens immediately'
        : 'Activation invitation is emailed',
    ],
  ];

  return (
    <div className="adm-review-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="adm-review-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adm-review-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="adm-review-head">
          <div className="adm-user">
            <div className="adm-avatar adm-avatar-lg">{initials(row.name, 'CL')}</div>
            <div>
              <span className="be-eyebrow">Client approval</span>
              <h2 id="adm-review-title">{row.name || 'Client'}</h2>
              <div className="adm-review-email">{row.email}</div>
            </div>
          </div>
          <button className="adm-icon-btn" onClick={onClose} aria-label="Close review" disabled={busy}><I icon={X}/></button>
        </div>

        <div className="adm-review-status">
          <ApprovalStatusBadge status={row.status} />
        </div>

        <div className="adm-review-section">
          <div className="adm-review-section-title"><I icon={User} size={14}/> Identity</div>
          <div className="adm-review-grid">
            {identityDetails.map(([label, value]) => (
              <div className="adm-review-field" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="adm-review-section">
          <div className="adm-review-section-title"><I icon={Mail} size={14}/> Contact</div>
          <div className="adm-review-grid">
            {contactDetails.map(([label, value]) => (
              <div className="adm-review-field" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="adm-review-section">
          <div className="adm-review-section-title"><I icon={Shield} size={14}/> Status</div>
          <div className="adm-review-grid">
            {statusDetails.map(([label, value]) => (
              <div className="adm-review-field" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="adm-review-section">
          <div className="adm-review-section-title"><I icon={FileText} size={14}/> Review</div>
          <label className="adm-field adm-review-notes">
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Record the reason, KYC observation, or admin decision note."
              disabled={busy || isDecided}
            />
          </label>
          {!emailConfirmed && !isDecided && (
            <div className="adm-review-warning">
              <p>
                <I icon={AlertTriangle} size={14}/>{' '}
                This applicant has not confirmed their email address. Approving them opens an
                account for an address nobody has proven they can receive mail at.
              </p>
              <label className="adm-review-ack">
                <input
                  type="checkbox"
                  checked={allowUnverifiedEmail}
                  onChange={(event) => onAllowUnverifiedEmailChange?.(event.target.checked)}
                  disabled={busy}
                />
                <span>Approve anyway — I have confirmed this applicant another way.</span>
              </label>
            </div>
          )}
          {row.hasSignupPassword === false && !isDecided && (
            <p className="adm-review-hint">
              This applicant signed up before passwords were collected, so approving them
              emails an activation invitation instead of opening the account directly.
            </p>
          )}
        </div>

        {error && <div className="adm-review-error">{error}</div>}

        <div className="adm-review-actions">
          <button className="be-btn be-btn-secondary" onClick={onClose} disabled={busy}>
            {isDecided ? 'Close' : 'Cancel'}
          </button>
          {!isDecided && (
            <>
              <button
                className="be-btn be-btn-danger"
                onClick={() => onDecision(row, 'rejected')}
                disabled={busy}
              >
                <I icon={XCircle} size={16}/> Reject
              </button>
              <button
                className="be-btn be-btn-primary"
                onClick={() => onDecision(row, 'approved')}
                disabled={busy || approveBlocked}
                title={approveBlocked ? 'Tick the acknowledgement above to approve an unconfirmed email' : undefined}
              >
                <I icon={CheckCircle2} size={16}/> Approve
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}


export default ApprovalReviewPanel;
