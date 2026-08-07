/**
 * Application state, in operator language.
 *
 * The backend states are `pending_email_verification`, `submitted`,
 * `in_review`, `approved`, `rejected` and `withdrawn`. Everything except
 * approved/rejected used to collapse into a single "Pending" chip, which hid the
 * one distinction that actually decides what an operator can do: an application
 * whose email is not yet confirmed cannot be approved at all (the decision
 * endpoint refuses it), whereas a submitted one is waiting on the operator.
 */
const LABELS = {
  pending_email_verification: { text: 'Email not confirmed', className: 'be-badge-neutral' },
  submitted: { text: 'Ready for review', className: 'be-badge-gold' },
  in_review: { text: 'In review', className: 'be-badge-paused' },
  approved: { text: 'Approved', className: 'be-badge-active' },
  active: { text: 'Approved', className: 'be-badge-active' },
  rejected: { text: 'Rejected', className: 'be-badge-failed' },
  withdrawn: { text: 'Withdrawn', className: 'be-badge-neutral' },
};

function ApprovalStatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  const { text, className } = LABELS[key] ?? { text: 'Pending', className: 'be-badge-paused' };
  return (
    <span className={`be-badge ${className}`}>
      <span className="be-badge-dot" />
      {text}
    </span>
  );
}

export default ApprovalStatusBadge;
