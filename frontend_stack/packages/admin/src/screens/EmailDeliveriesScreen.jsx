import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import useAdminList from '../hooks/useAdminList.js';
import DataTable from '../components/DataTable.jsx';
import I from '../components/I.jsx';

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
  { value: 'verify_email', label: 'Verify email' },
  { value: 'activation_invite', label: 'Activation invite' },
  { value: 'application_rejected', label: 'Application rejected' },
];

const TONE = {
  delivered: 'adm-badge is-green',
  sent: 'adm-badge is-green',
  queued: 'adm-badge is-slate',
  sending: 'adm-badge is-slate',
  retryable_failed: 'adm-badge is-amber',
  permanent_failed: 'adm-badge is-red',
  cancelled: 'adm-badge is-slate',
};

function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

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
        <div className="ash-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title">
              <I icon={Mail} size={16} /> Email deliveries
            </h2>
            <div className="adm-card-sub">
              Transactional email evidence from the outbox worker. Recipients are masked.
            </div>
          </div>
          <button type="button" className="adm-btn adm-btn-secondary" onClick={reload} disabled={loading}>
            <I icon={RefreshCw} size={14} /> Refresh
          </button>
        </div>

        <div className="adm-card-toolbar">
          <label className="adm-field">
            <span>Status</span>
            <select value={state} onChange={(event) => setState(event.target.value)}>
              {STATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-field">
            <span>Template</span>
            <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
              {TEMPLATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
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
              renderCell: (row) => (
                <span className={TONE[row.state] || 'adm-badge is-slate'}>{row.state}</span>
              ),
            },
            {
              key: 'attempts',
              title: 'Attempts',
              align: 'right',
              renderCell: (row) => row.attemptCount ?? 0,
            },
            { key: 'error', title: 'Last error', renderCell: (row) => row.lastErrorCode || '—' },
            { key: 'updated', title: 'Updated', renderCell: (row) => formatWhen(row.updatedAt) },
          ]}
          rows={items}
          loading={loading}
          empty="No email deliveries recorded yet."
          keyExtractor={(row, index) => row.emailDeliveryId ?? index}
        />

        {hasMore && (
          <div className="adm-card-foot">
            <button type="button" className="adm-btn adm-btn-secondary" onClick={loadMore} disabled={loading}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
