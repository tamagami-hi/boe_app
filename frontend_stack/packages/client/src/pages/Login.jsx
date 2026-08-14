import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HOME_PATH, buildPath, resolveInternalPath } from '../navigation/routes.js';
import { useSession } from '../store/SessionContext.jsx';
import { openOnboarding } from '../utils/openOnboarding.js';

function EyeIcon({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

const LOGIN_PATH = buildPath('login');

/**
 * Where to land after signing in.
 *
 * `from` arrives in the URL, so it is treated as untrusted input: the target must
 * resolve to a REAL route in the manifest. The old check only required an `/app/`
 * prefix, so `?from=/app/nonsense` signed the user in and dropped them on Not
 * Found. `resolveInternalPath` re-derives the path from the manifest, which also
 * strips any query or hash that rode along.
 */
function postLoginPath(from) {
  if (!from) return HOME_PATH;
  try {
    const decoded = decodeURIComponent(from);
    if (decoded === LOGIN_PATH) return HOME_PATH;
    return resolveInternalPath(decoded) || HOME_PATH;
  } catch {
    return HOME_PATH;
  }
}

/*
 * Sign-in accepts an email address only.
 *
 * The field used to be labelled "Email or phone", but the value is sent as
 * `email` and the backend validates it as one — there is no phone sign-in path at
 * all. A phone number therefore came back as a validation failure and was
 * reported as "check your password", sending people to reset a password that was
 * never wrong. Checking here says so before the request is made.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Say what actually went wrong.
 *
 * Every failure used to collapse into one "check your email, phone, or password"
 * message, so a timeout, an unreachable server, and a genuinely wrong password
 * were indistinguishable — which is exactly the wrong advice during the sign-in
 * slowness this screen is most likely to show.
 */
function signInErrorMessage(error) {
  const code = error?.code;
  if (code === 'ADMIN_LOGIN_REQUIRED') return 'Use the admin login page for admin access.';
  if (code === 'REQUEST_TIMEOUT') {
    return 'The server took too long to respond. Check your connection and try again.';
  }
  if (code === 'NETWORK_UNAVAILABLE') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (code === 'FIXTURE_MODE') return 'This build is not connected to the server.';
  if (code === 'VALIDATION_FAILED') return 'Enter a valid email address and your password.';
  if (error?.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (error?.status >= 500) return 'The server is having trouble. Try again in a moment.';
  if (error?.status === 401) return "That email and password don't match. Try again.";
  return "Couldn't sign in. Try again.";
}

export default function Login() {
  const { login, endedReason } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  async function onSignIn(e) {
    e.preventDefault();
    const email = identifier.trim();
    if (!email || !password) {
      setErr('Enter your email address and password.');
      return;
    }
    if (!EMAIL_SHAPE.test(email)) {
      setErr('Enter the email address you signed up with.');
      return;
    }
    setErr('');
    setSubmitting(true);
    try {
      await login({ identifier: email, password });
      navigate(postLoginPath(params.get('from')), { replace: true });
    } catch (error) {
      setErr(signInErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="apk-login-page">
      {submitting && <div className="apk-login-progress" />}
      <div className="apk-login-card">
        <div className="apk-login-header">
          <h1 className="apk-login-title">Sign in</h1>
          <p className="apk-login-sub">Enter your credentials to continue.</p>
        </div>

        {/* Why the sign-in screen appeared. Without it a session that expired
            mid-use looks like the app forgetting the user for no reason. */}
        {!err && endedReason === 'expired' && (
          <div className="apk-banner" role="status">
            You were signed out because your session expired. Sign in to continue.
          </div>
        )}

        {err && (
          <div className="apk-login-error" role="alert" aria-live="assertive">
            {err}
          </div>
        )}

        <form className="apk-login-form" onSubmit={onSignIn} noValidate>
          <div className="be-field">
            <label htmlFor="ident">Email</label>
            <input
              id="ident"
              className="be-input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="be-field">
            <label htmlFor="pwd">Password</label>
            <div className="auth-input-wrap">
              <input
                id="pwd"
                className="be-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>
          <button type="submit" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="apk-login-foot">
          <span>New to BeOnEdge?</span>
          <button type="button" className="apk-login-link" onClick={openOnboarding}>
            Sign up
          </button>
        </div>
      </div>
    </div>
  );
}
