import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import I from '../../components/I.jsx';
import { AUM_OPENING_REASONS } from '../../helpers/aumReasons.js';
import {
  EMPTY_PROFILE,
  FUND_CATEGORIES,
  RETURN_TIERS,
  RISK_LEVELS,
  createPayloadFromProfile,
  validateProfile,
  versionPayloadFromProfile,
} from './fundOpsModel.js';
import '../admin-screens-shared.css';

export default function FundProfileForm({
  initial = EMPTY_PROFILE,
  mode = 'version',
  submitLabel = 'Publish version',
  busy = false,
  onSubmit,
  onCancel,
}) {
  const [profile, setProfile] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const isCreate = mode === 'create';

  const set = (key) => (event) => {
    const { value } = event.target;
    setProfile((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => (previous[key] ? { ...previous, [key]: undefined } : previous));
  };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = validateProfile(profile, { requireOpeningAum: isCreate });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError('Some details need attention before this can be published.');
      return;
    }
    setFormError('');
    try {
      const payload = isCreate
        ? createPayloadFromProfile(profile)
        : versionPayloadFromProfile(profile);
      await onSubmit?.(payload, profile);
    } catch (error) {
      setFormError(error?.message || 'The version was not published.');
    }
  }

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

  const money = (key, label, hint, extra = {}) => field(key, label, (props) => (
    <input
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      value={profile[key]}
      onChange={set(key)}
      {...extra}
      {...props}
    />
  ), hint);

  const months = (key, label, hint) => field(key, label, (props) => (
    <input
      type="number"
      min="1"
      max="1200"
      step="1"
      inputMode="numeric"
      value={profile[key]}
      onChange={set(key)}
      {...props}
    />
  ), hint);

  return (
    <form className="adm-card" onSubmit={submit} noValidate>
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">{isCreate ? 'New fund' : 'Published terms'}</span>
          <h2 className="adm-card-title">{isCreate ? 'Fund details' : 'Published terms'}</h2>
          <div className="adm-card-sub">
            {isCreate
              ? 'Creating a fund publishes version 1 of its terms and its opening AUM in one step. The fund stays a draft until you publish it to clients from its workspace.'
              : 'A published version cannot be edited. Saving publishes a new version; the previous one stays in this fund\u2019s history.'}
          </div>
        </div>
      </div>

      {formError && (
        <div className="adm-validation-banner adm-validation-banner--error adm-validation-banner--inline" role="alert">
          <I icon={AlertTriangle} size={14} /> {formError}
        </div>
      )}

      <fieldset className="adm-fieldset">
        <legend className="adm-fieldset-legend">Identity</legend>
        <div className="adm-form-grid">
          {field('name', 'Fund name', (props) => (
            <input type="text" value={profile.name} onChange={set('name')} {...props} />
          ), isCreate ? 'The slug is generated from this name.' : undefined)}
          {field('category', 'Category', (props) => (
            <select value={profile.category} onChange={set('category')} {...props}>
              {FUND_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          ), 'Shown on the client fund card.')}
          <div className="adm-field--wide">
            {field('objective', 'Objective', (props) => (
              <textarea rows={3} value={profile.objective} onChange={set('objective')} {...props} />
            ), 'The short description clients read under the name.')}
          </div>
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend className="adm-fieldset-legend">Terms</legend>
        <div className="adm-form-grid">
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
          {money('minSip', 'Minimum SIP (₹)', 'Leave blank for no minimum.', { step: '1' })}
          {money('minLumpsum', 'Minimum one-time (₹)', 'Leave blank for no minimum.', { step: '1' })}
          {months('minimumDurationMonths', 'Minimum duration (months)', 'Optional.')}
          {months('recommendedHoldingMonths', 'Recommended holding (months)', 'Optional.')}
        </div>
      </fieldset>

      {isCreate && (
        <fieldset className="adm-fieldset">
          <legend className="adm-fieldset-legend">Opening fund size (AUM)</legend>
          <p className="adm-screen-note">
            Required. This publishes the fund&rsquo;s first absolute AUM snapshot in the same
            transaction as its terms, so a fund can never exist without a published size. Later
            changes are made under AUM.
          </p>
          <div className="adm-form-grid">
            {money('openingAum', 'Opening AUM (₹)', 'The absolute figure clients will see. Zero is allowed.')}
            {field('openingAumAsOfDate', 'As-of date', (props) => (
              <input
                type="date"
                value={profile.openingAumAsOfDate}
                onChange={set('openingAumAsOfDate')}
                {...props}
              />
            ), 'The date this figure is effective from.')}
            {field('openingAumReasonCode', 'Reason', (props) => (
              <select
                value={profile.openingAumReasonCode}
                onChange={set('openingAumReasonCode')}
                {...props}
              >
                {AUM_OPENING_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            ), 'Recorded on the audit entry.')}
            <div className="adm-field--wide">
              {field('openingAumNote', 'Internal note (optional)', (props) => (
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={profile.openingAumNote}
                  onChange={set('openingAumNote')}
                  {...props}
                />
              ), 'Visible to admins only. Never shown to clients.')}
            </div>
          </div>
        </fieldset>
      )}

      <fieldset className="adm-fieldset">
        <legend className="adm-fieldset-legend">Client disclosure</legend>
        <div className="adm-form-grid">
          <div className="adm-field--wide">
            {field('disclosureTitle', 'Disclosure title', (props) => (
              <input type="text" value={profile.disclosureTitle} onChange={set('disclosureTitle')} {...props} />
            ), 'Defaults to the fund name if left blank.')}
          </div>
          <div className="adm-field--wide">
            {field('disclosureBody', 'Disclosure text', (props) => (
              <textarea rows={6} value={profile.disclosureBody} onChange={set('disclosureBody')} {...props} />
            ), 'Published with the version and shown on the client fund page. Required.')}
          </div>
        </div>
      </fieldset>

      <div className="adm-toolbar adm-toolbar--bordered adm-toolbar--gap-2 adm-toolbar--end">
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
