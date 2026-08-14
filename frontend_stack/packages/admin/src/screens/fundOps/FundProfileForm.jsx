import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import I from '../../components/I.jsx';
import {
  EMPTY_PROFILE, RETURN_TIERS, RISK_LEVELS, validateProfile, versionPayloadFromProfile,
} from './fundOpsModel.js';
import '../admin-screens-shared.css';

/*
 * The pool's published terms. One form, one endpoint: a version publish.
 *
 * A published version is immutable, so saving publishes the NEXT version rather
 * than editing one in place. That is stated on the form, because it is the thing
 * about this workflow an operator most needs to know before pressing Save.
 *
 * Every field here maps to a field in `publishVersionSchema`. See fundOpsModel.js
 * for the fifteen groups of fields that used to be here and went nowhere.
 */
export default function FundProfileForm({
  initial = EMPTY_PROFILE,
  submitLabel = 'Publish version',
  busy = false,
  onSubmit,
  onCancel,
  children,
}) {
  const [profile, setProfile] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const set = (key) => (event) => {
    const { value } = event.target;
    setProfile((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = validateProfile(profile);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError('Some details need attention before this can be published.');
      return;
    }
    setFormError('');
    try {
      await onSubmit?.(versionPayloadFromProfile(profile), profile);
    } catch (error) {
      setFormError(error?.message || 'The version was not published.');
    }
  }

  /*
   * The hint and the error sit OUTSIDE the label and are wired with
   * `aria-describedby`. Inside it they become part of the control's accessible
   * name, so a screen reader announced this field as "Category Shown on the client
   * fund card." — the label and its explanation run together as one string.
   */
  const field = (key, label, renderInput, hint) => {
    const id = `fund-${key}`;
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = errors[key] ? `${id}-error` : undefined;
    const describedBy = [errorId, errorId ? undefined : hintId].filter(Boolean).join(' ') || undefined;
    return (
      <div className="adm-field">
        <label className="adm-field-label" htmlFor={id}>{label}</label>
        {renderInput({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': errors[key] ? 'true' : undefined,
        })}
        {errors[key] ? (
          <small className="adm-field-error" id={errorId} role="alert">{errors[key]}</small>
        ) : (
          hint && <small className="adm-help-text" id={hintId}>{hint}</small>
        )}
      </div>
    );
  };

  return (
    <form className="adm-card" onSubmit={submit} noValidate>
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">Published terms</h3>
          <div className="adm-card-sub">
            A published version cannot be edited. Saving publishes a new version, and the previous
            one stays in the pool&rsquo;s history.
          </div>
        </div>
      </div>

      {formError && (
        <div className="adm-validation-banner adm-validation-banner--error adm-validation-banner--inline" role="alert">
          <I icon={AlertTriangle} size={14} /> {formError}
        </div>
      )}

      <div className="adm-form-grid">
        {field('name', 'Pool name', (props) => (
          <input type="text" value={profile.name} onChange={set('name')} {...props} />
        ))}
        {field('category', 'Category', (props) => (
          <input type="text" value={profile.category} onChange={set('category')} placeholder="general" {...props} />
        ), 'Shown on the client fund card.')}

        {field('objective', 'Objective', (props) => (
          <textarea rows={3} value={profile.objective} onChange={set('objective')} {...props} />
        ), 'The one-line description clients read under the name.')}

        {field('riskLevel', 'Risk level', (props) => (
          <select value={profile.riskLevel} onChange={set('riskLevel')} {...props}>
            {RISK_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>{level.label}</option>
            ))}
          </select>
        ))}
        {field('returnTier', 'Expected return band', (props) => (
          <select value={profile.returnTier} onChange={set('returnTier')} {...props}>
            {RETURN_TIERS.map((tier) => (
              <option key={tier.value} value={tier.value}>{tier.label}</option>
            ))}
          </select>
        ), 'Shown beside the risk level. Not a projection.')}

        {field('minSip', 'Minimum SIP (₹)', (props) => (
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={profile.minSip}
            onChange={set('minSip')}
            {...props}
          />
        ))}
        {field('minLumpsum', 'Minimum one-time (₹)', (props) => (
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={profile.minLumpsum}
            onChange={set('minLumpsum')}
            {...props}
          />
        ))}

        {field('minimumDurationMonths', 'Minimum duration (months)', (props) => (
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={profile.minimumDurationMonths}
            onChange={set('minimumDurationMonths')}
            {...props}
          />
        ), 'Optional.')}
        {field('recommendedHoldingMonths', 'Recommended holding (months)', (props) => (
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={profile.recommendedHoldingMonths}
            onChange={set('recommendedHoldingMonths')}
            {...props}
          />
        ), 'Optional.')}

        <div className="adm-field adm-field-wide">
          {field('disclosureTitle', 'Disclosure title', (props) => (
            <input type="text" value={profile.disclosureTitle} onChange={set('disclosureTitle')} {...props} />
          ), 'Defaults to the pool name if left blank.')}
        </div>
        <div className="adm-field adm-field-wide">
          {field('disclosureBody', 'Disclosure text', (props) => (
            <textarea rows={5} value={profile.disclosureBody} onChange={set('disclosureBody')} {...props} />
          ), 'Published with the version and shown on the client fund page. Required.')}
        </div>
      </div>

      {children}

      <div className="adm-toolbar adm-toolbar--bordered adm-toolbar--gap-2">
        {onCancel && (
          <button type="button" className="be-btn be-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
          {busy ? 'Publishing…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
