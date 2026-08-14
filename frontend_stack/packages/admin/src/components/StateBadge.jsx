import { humanizeState } from '../helpers/formatters.js';

/*
 * One badge for the canonical backend state enums.
 *
 * Every screen had its own inline map, and each one missed states: the mandate
 * register mapped `pending_user_auth` (the real state is
 * `pending_user_authorization`) and had no entry for `created`, `failed` or
 * `expired`, so those rows rendered an EMPTY status cell — the operator could not
 * tell a failed mandate from a rendering bug. The directory hardcoded a green tick
 * for every account, suspended ones included, using a `.be-badge-green` class that
 * does not exist in the stylesheet.
 *
 * An unrecognised state therefore falls back to a neutral badge showing the raw
 * token. Unknown must look unknown, never blank and never green.
 */
const TONES = {
  // Payments (payment_state)
  created: 'paused',
  provider_pending: 'paused',
  succeeded: 'active',
  refunded: 'neutral',
  // Mandates (mandate_state)
  pending_user_authorization: 'paused',
  active: 'active',
  paused: 'paused',
  revoked: 'failed',
  expired: 'neutral',
  failed: 'failed',
  // Users (user_account_state)
  invited: 'paused',
  suspended: 'failed',
  closed: 'neutral',
  // Orders (order_state)
  submitted: 'paused',
  payment_pending: 'paused',
  payment_confirmed: 'active',
  booked: 'active',
  payment_failed: 'failed',
  cancelled: 'neutral',
  rejected: 'failed',
  reversed: 'failed',
  // Funds (fund_state)
  draft: 'neutral',
  review_pending: 'paused',
  published: 'active',
  archived: 'neutral',
  // Email deliveries
  queued: 'neutral',
  sending: 'paused',
  sent: 'active',
  delivered: 'active',
  retryable_failed: 'paused',
  permanent_failed: 'failed',
  // KYC cases
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
  review_pending: 'In review',
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
