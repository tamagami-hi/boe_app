'use client';

import { useState, type FormEvent } from 'react';

import { submitApplication } from '../lib/onboarding';
import { validateLead, type LeadErrors } from '../lib/validation';

// The backend onboarding model is application -> email verify -> admin approval
// -> activation invite (which is where the user sets a password). There is no
// self-service password signup, so this form collects only name/email/mobile +
// consent and submits an application; the password step happens later via the
// emailed activation link.
type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const initialValues = { name: '', email: '', mobile: '' };

export default function SignupForm() {
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
    const result = validateLead({ name: values.name, email: values.email, phone: values.mobile });
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
        phone: values.mobile,
        acceptedConsents: accepted,
      });
      setStatus({ kind: 'success' });
      setValues(initialValues);
      setAccepted(false);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'We could not submit your application. Please try again.',
      });
    }
  }

  const submitting = status.kind === 'submitting';

  if (status.kind === 'success') {
    return (
      <div className="form__status form__status--success" role="status" aria-live="polite">
        <p>
          Thanks — your application has been received. Please check your email to verify your
          address. Our team will review your application and email you an activation link once it is
          approved.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Apply for access form">
      <div className={`field ${errors.name ? 'field--error' : ''}`}>
        <label htmlFor="signup-name">Name</label>
        <input
          id="signup-name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? <span className="field__error">{errors.name}</span> : null}
      </div>

      <div className={`field ${errors.email ? 'field--error' : ''}`}>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(event) => update('email', event.target.value)}
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email ? <span className="field__error">{errors.email}</span> : null}
      </div>

      <div className={`field ${errors.phone ? 'field--error' : ''}`}>
        <label htmlFor="signup-mobile">Mobile</label>
        <input
          id="signup-mobile"
          name="mobile"
          type="tel"
          autoComplete="tel"
          value={values.mobile}
          onChange={(event) => update('mobile', event.target.value)}
          aria-invalid={Boolean(errors.phone)}
        />
        {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
      </div>

      <div className={`field ${consentError ? 'field--error' : ''}`}>
        <label className="field__checkbox">
          <input
            type="checkbox"
            name="acceptConsents"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
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

      <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Apply for access'}
      </button>

      <div aria-live="polite">
        {status.kind === 'error' ? (
          <p className="form__status form__status--error">{status.message}</p>
        ) : null}
      </div>
    </form>
  );
}
