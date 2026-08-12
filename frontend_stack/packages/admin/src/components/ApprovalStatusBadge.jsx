/**
 * Application state, in operator language.
 *
 * The backend states are `submitted`, `approved`, `rejected` and `withdrawn`.
 * A new signup lands in `submitted` and waits on the operator's decision;
 * there is no pre-approval email confirmation and no separate review state.
 */
const LABELS = {
  submitted: { text: 'Pending approval', className: 'be-badge-gold' },
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
