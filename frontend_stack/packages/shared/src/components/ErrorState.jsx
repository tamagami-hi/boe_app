import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import './ErrorState.css';

// A read failed. Distinct from EmptyState on purpose: "we could not load this" and
// "there is nothing here" were rendered identically in several places, which told
// investors with money that they had none.
export default function ErrorState({
  title = 'We could not load this',
  description = 'Your data is unaffected — this screen could not reach the server.',
  onRetry,
  retryLabel = 'Try again',
  busy = false,
  detail,
  className = '',
}) {
  return (
    <div className={`be-error-state ${className}`} role="alert">
      <div className="be-error-state__icon-wrap">
        <AlertTriangle size={24} strokeWidth={1.6} />
      </div>
      <h3 className="be-error-state__title">{title}</h3>
      {description && <p className="be-error-state__description">{description}</p>}
      {onRetry && (
        <button
          type="button"
          className="be-btn be-btn-secondary be-error-state__action"
          onClick={onRetry}
          disabled={busy}
        >
          <RefreshCw size={15} strokeWidth={2} />
          {busy ? 'Retrying…' : retryLabel}
        </button>
      )}
      {detail && <p className="be-error-state__detail">{detail}</p>}
    </div>
  );
}
