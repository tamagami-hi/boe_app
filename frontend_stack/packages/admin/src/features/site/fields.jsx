import { useId } from 'react';
import HelpTooltip from '../../components/HelpTooltip.jsx';

// Shared form primitives for the support-content pages. Labels sit above
// inputs; help text is optional; error text renders below the input.

export function TextField({ label, value, onChange, placeholder, help, error, required, type = 'text', disabled, tooltip }) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const describedBy = [help && !error ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className="ash-field" data-field-label={label || undefined} data-field-desc={tooltip || undefined}>
      <label className="ash-label" htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {tooltip && <HelpTooltip text={tooltip} />}
      </label>
      <input
        id={inputId}
        type={type}
        className={`ash-input ${error ? 'is-invalid' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && !error && <span id={helpId} className="ash-help">{help}</span>}
      {error && <span id={errorId} className="ash-error-text">{error}</span>}
    </div>
  );
}

export function TextAreaField({ label, value, onChange, placeholder, help, error, required, rows = 3, disabled, tooltip }) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const describedBy = [help && !error ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className="ash-field" data-field-label={label || undefined} data-field-desc={tooltip || undefined}>
      <label className="ash-label" htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {tooltip && <HelpTooltip text={tooltip} />}
      </label>
      <textarea
        id={inputId}
        className={`ash-textarea ${error ? 'is-invalid' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && !error && <span id={helpId} className="ash-help">{help}</span>}
      {error && <span id={errorId} className="ash-error-text">{error}</span>}
    </div>
  );
}

const STATUS_BADGE_CLASS = {
  published: 'ash-badge-published',
  draft: 'ash-badge-draft',
  archived: 'ash-badge-archived',
};

export function StatusBadge({ status }) {
  const normalized = String(status || 'draft').toLowerCase();
  const tone = STATUS_BADGE_CLASS[normalized] || 'ash-badge-neutral';
  return <span className={`ash-badge ${tone}`}>{normalized}</span>;
}

export function StatusFilterChips({ value, onChange, options }) {
  return (
    <div className="ash-chip-row" role="group" aria-label="Filter by status">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`ash-chip ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
