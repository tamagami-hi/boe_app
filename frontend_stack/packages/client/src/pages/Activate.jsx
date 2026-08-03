import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeActivation } from '../services/authApi.js';

// Activation: the invited user's first sign-in. The activation email links here
// with `?token=<43-char token>`; posting it with a new password to
// `POST /v1/activations/complete` creates the credential and returns a native
// session, so the app lands straight on the dashboard.
//
// This is the only self-service entry point into an account — there is no
// password signup. Applications are approved by an admin, which is what sends
// the invite.

const MIN_PASSWORD_LENGTH = 12;

export default function Activate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const tokenLooksValid = /^[A-Za-z0-9_-]{43}$/.test(token);

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    if (!tokenLooksValid) {
      setError('This activation link is incomplete. Open the link from your invitation email again.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await completeActivation({ token, password });
      navigate('/app/dashboard', { replace: true });
    } catch (activationError) {
      // The backend distinguishes an unusable link (410/409) from a weak or
      // breached password (400) — surface its message rather than guessing.
      setError(activationError?.message || 'Activation failed. Request a new invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="apk-login">
      <div className="apk-login-card">
        <h1 className="apk-login-title">Set your password</h1>
        <p className="apk-login-sub">
          Your application was approved. Choose a password to finish activating your account.
        </p>

        {!tokenLooksValid && (
          <div className="apk-alert apk-alert-error" role="alert">
            This activation link is missing its token. Open the link from your invitation email.
          </div>
        )}

        <form className="apk-login-form" onSubmit={onSubmit} noValidate>
          <label className="apk-field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </label>

          <label className="apk-field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </label>

          <p className="apk-login-hint">
            At least {MIN_PASSWORD_LENGTH} characters. Passwords found in known breaches are rejected.
          </p>

          {error && (
            <div className="apk-alert apk-alert-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="apk-btn apk-btn-primary" disabled={submitting}>
            {submitting ? 'Activating…' : 'Activate account'}
          </button>
        </form>
      </div>
    </div>
  );
}
