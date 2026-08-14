import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import useAdminList from '../hooks/useAdminList.js';
import DataTable from '../components/DataTable.jsx';
import StateBadge from '../components/StateBadge.jsx';
import I from '../components/I.jsx';
import { fmtDateTime, fmtInt } from '../helpers/formatters.js';
import './admin-screens-shared.css';

// Email delivery log. Backed by `GET /v1/admin/email-deliveries`, which has
// existed since the outbox worker landed but had no screen consuming it.
// Recipients arrive masked; the endpoint never returns ciphertext or raw
// provider failure detail, so nothing here can leak PII.

const STATES = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'retryable_failed', label: 'Retrying' },
  { value: 'permanent_failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TEMPLATES = [
  { value: 'all', label: 'All templates' },
  { value: 'account_approved', label: 'Account approved' },
  { value: 'application_rejected', label: 'Application rejected' },
];

export default function EmailDeliveriesScreen() {
  const [state, setState] = useState('all');
  const [templateKey, setTemplateKey] = useState('all');
  const { items, loading, error, hasMore, loadMore, reload } = useAdminList(
    '/v1/admin/email-deliveries',
    { state, templateKey },
    { limit: 50 },
  );

  return (
    <div className="adm-screen">
      {error && (
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
            <I icon={RefreshCw} size={13} />
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">System</span>
            <h2 className="adm-card-title">
              <I icon={Mail} size={16} /> Email deliveries
            </h2>
          </div>
          {/* Was `.adm-btn`, a class no stylesheet defines: three of this screen's
              buttons rendered as bare browser buttons in the console. */}
          <div className="adm-card-actions">
            <span className="adm-cell-meta">{fmtInt(items.length)} loaded</span>
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={reload} disabled={loading}>
              <I icon={RefreshCw} size={14} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className="adm-screen-note">
          Transactional email evidence from the outbox worker. Recipients are masked. A delivery
          recorded as sent means the provider accepted it, not that it reached an inbox.
        </p>

        <div className="adm-payment-filters">
          <label className="adm-filter">
            <span className="adm-sr-only">Delivery status</span>
            <select value={state} onChange={(event) => setState(event.target.value)}>
              {STATES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Template</span>
            <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
              {TEMPLATES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <DataTable
          columns={[
            { key: 'recipient', title: 'Recipient', renderCell: (row) => row.recipientMasked },
            { key: 'template', title: 'Template', renderCell: (row) => row.templateKey },
            {
              key: 'state',
              title: 'Status',
              // Was `.adm-badge is-green`, also undefined, so the status column was
              // unstyled text. StateBadge is the console's one badge.
              renderCell: (row) => <StateBadge state={row.state} />,
            },
            {
              key: 'attempts',
              title: 'Attempts',
              align: 'right',
              renderCell: (row) => row.attemptCount ?? 0,
            },
            { key: 'error', title: 'Last error', renderCell: (row) => row.lastErrorCode || '—' },
            { key: 'updated', title: 'Updated', renderCell: (row) => fmtDateTime(row.updatedAt) },
          ]}
          rows={items}
          loading={loading}
          empty={
            error
              ? 'The delivery log could not be read.'
              : 'No email has been queued yet. Approving an application queues the welcome email.'
          }
          keyExtractor={(row, index) => row.emailDeliveryId ?? index}
        />

        {hasMore && (
          <div className="adm-toolbar adm-toolbar--center adm-toolbar--bordered adm-toolbar--gap-2">
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={loadMore} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
