import { humanizeState } from '../helpers/formatters.js';

const TONES = {
  created: 'paused',
  provider_pending: 'paused',
  setup_pending: 'paused',
  pending_mandate: 'paused',
  dispatching: 'paused',
  notified: 'paused',
  authorized: 'active',
  pause_pending: 'paused',
  cancel_pending: 'paused',
  revoke_pending: 'paused',
  reconciliation_required: 'failed',
  setup_failed: 'failed',
  mandate_failed: 'failed',
  succeeded: 'active',
  refunded: 'neutral',
  pending_user_authorization: 'paused',
  active: 'active',
  paused: 'paused',
  revoked: 'failed',
  expired: 'neutral',
  failed: 'failed',
  invited: 'paused',
  suspended: 'failed',
  closed: 'neutral',
  submitted: 'paused',
  payment_pending: 'paused',
  payment_confirmed: 'active',
  booked: 'active',
  payment_failed: 'failed',
  cancelled: 'neutral',
  rejected: 'failed',
  reversed: 'failed',
  draft: 'neutral',
  published: 'active',
  archived: 'neutral',
  queued: 'neutral',
  sending: 'paused',
  sent: 'active',
  delivered: 'active',
  retryable_failed: 'paused',
  permanent_failed: 'failed',
  approved: 'active',
  needs_information: 'paused',
};

const LABELS = {
  provider_pending: 'With provider',
  pending_user_authorization: 'Pending auth',
  succeeded: 'Succeeded',
  payment_pending: 'Awaiting payment',
  payment_confirmed: 'Paid',
  payment_failed: 'Payment failed',
  retryable_failed: 'Retrying',
  permanent_failed: 'Failed',
  needs_information: 'Needs information',
};

export default function StateBadge({ state }) {
  const key = String(state || '').toLowerCase();
  const tone = TONES[key] || 'neutral';
  return (
    <span className={`be-badge be-badge-${tone}`}>
      <span className="be-badge-dot" />
      {LABELS[key] || humanizeState(state)}
    </span>
  );
}
