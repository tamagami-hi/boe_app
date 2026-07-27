'use client';

import { useState, type FormEvent } from 'react';
import { validateLead, type LeadErrors } from '../lib/validation';
import { submitApplication } from '../lib/onboarding';
import { leadFormDefaults } from '../lib/landingDefaults';
import type { LeadFormDefaults } from '../lib/landingDefaults';

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export default function LeadForm({
  leadForm = leadFormDefaults,
}: {
  leadForm?: Partial<LeadFormDefaults>;
}) {
  const resolved = {
    eyebrow: leadForm?.eyebrow ?? leadFormDefaults.eyebrow,
    title: leadForm?.title ?? leadFormDefaults.title,
    lead: leadForm?.lead ?? leadFormDefaults.lead,
    submitLabel: leadForm?.submitLabel ?? leadFormDefaults.submitLabel,
    successMessage: leadForm?.successMessage ?? leadFormDefaults.successMessage,
    interestOptions: leadForm?.interestOptions ?? leadFormDefaults.interestOptions,
  };

  const initialValues = {
    name: '',
    email: '',
    phone: '',
    interest: resolved.interestOptions[0],
    message: '',
  };

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<LeadErrors>({});
  const [accepted, setAccepted] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function update<K extends keyof typeof values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateLead(values);
    setErrors(result.errors);
    const missingConsent = !accepted;
    setConsentError(missingConsent ? 'Please accept the Terms of Service and Privacy Policy.' : null);
    if (!result.ok || missingConsent) {
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'submitting' });
    try {
      await submitApplication({
        fullName: values.name,
        email: values.email,
        phone: values.phone,
        acceptedConsents: accepted,
      });
      setStatus({ kind: 'success' });
      setValues(initialValues);
      setAccepted(false);
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'We could not submit your request. Please try again.',
      });
    }
  }

  const submitting = status.kind === 'submitting';

  return (
    <section className="section section--sunken" id="lead">
      <div className="container">
        <div className="lead">
          <div>
            <span className="eyebrow">{resolved.eyebrow}</span>
            <h2 className="section__title">{resolved.title}</h2>
            <p className="section__lead">{resolved.lead}</p>
          </div>

          <form onSubmit={onSubmit} noValidate aria-label="Course interest form">
            <div className={`field ${errors.name ? 'field--error' : ''}`}>
              <label htmlFor="lead-name">Name</label>
              <input
                id="lead-name"
                name="name"
                autoComplete="name"
                value={values.name}
                onChange={(e) => update('name', e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? <span className="field__error">{errors.name}</span> : null}
            </div>

            <div className={`field ${errors.email ? 'field--error' : ''}`}>
              <label htmlFor="lead-email">Email</label>
              <input
                id="lead-email"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={(e) => update('email', e.target.value)}
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email ? <span className="field__error">{errors.email}</span> : null}
            </div>

            <div className={`field ${errors.phone ? 'field--error' : ''}`}>
              <label htmlFor="lead-phone">Phone number</label>
              <input
                id="lead-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={values.phone}
                onChange={(e) => update('phone', e.target.value)}
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
            </div>

            <div className="field">
              <label htmlFor="lead-interest">Interested course or plan</label>
              <select
                id="lead-interest"
                name="interest"
                value={values.interest}
                onChange={(e) => update('interest', e.target.value)}
              >
                {resolved.interestOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lead-message">Message (optional)</label>
              <textarea
                id="lead-message"
                name="message"
                rows={3}
                value={values.message}
                onChange={(e) => update('message', e.target.value)}
              />
            </div>

            <div className={`field ${consentError ? 'field--error' : ''}`}>
              <label className="field__checkbox">
                <input
                  type="checkbox"
                  name="acceptConsents"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  aria-invalid={Boolean(consentError)}
                />
                <span>
                  I accept the{' '}
                  <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
                </span>
              </label>
              {consentError ? <span className="field__error">{consentError}</span> : null}
            </div>

            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={submitting}
            >
              {submitting ? 'Sending…' : resolved.submitLabel}
            </button>

            <div aria-live="polite">
              {status.kind === 'success' ? (
                <p className="form__status form__status--success">
                  {resolved.successMessage}
                </p>
              ) : null}
              {status.kind === 'error' ? (
                <p className="form__status form__status--error">
                  {status.message}
                </p>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
