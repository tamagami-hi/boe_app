import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import logo from '@beonedge/shared/assets/logo.svg';
// Only the two client stylesheets these screens use. The barrel pulled all
// fifteen, so the admin build shipped 122 kB of client screen CSS for two
// auth screens.
import '@beonedge/client/styles/mobile/base.css';
import '@beonedge/client/styles/mobile/auth.css';
import '../styles/desktop/admin.css';

function safeAdminPath(value) {
  if (!value) return '/admin';
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith('/admin') && decoded !== '/admin/login' ? decoded : '/admin';
  } catch {
    return '/admin';
  }
}

export default function AdminLogin() {
  const { user, isLoading, login } = useAdminSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
  }, [identifier, password]);

  async function onSubmit(event) {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setErr('Enter the admin ID and password.');
      return;
    }

    setSubmitting(true);
    try {
      await login({ identifier, password });
      navigate(safeAdminPath(params.get('from')), { replace: true });
    } catch {
      setErr('Admin login failed. Check the admin ID and password.');
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return null;
  if (user) return <Navigate to={safeAdminPath(params.get('from'))} replace />;

  return (
    <>
      {submitting && <div className="apk-login-progress" />}
      <div className="auth-page admin-auth">
        <section className="auth-copy">
          <Link to="/" className="auth-logo"><img src={logo} alt="BeOnEdge" /></Link>
          <div>
            <span className="be-eyebrow">BeOnEdge Admin</span>
            <h1>Admin console access.</h1>
            <p>Use the admin credentials from the backend environment file. Client sign-in remains separate.</p>
          </div>
          <div className="auth-copy-grid">
            <div><strong>Separate session</strong><span>Admin login does not replace the client app session.</span></div>
            <div><strong>Environment backed</strong><span>Credentials are checked against admin env values.</span></div>
            <div><strong>Console only</strong><span>This route only opens the admin dashboard.</span></div>
          </div>
        </section>

        <section className="auth-card" aria-label="Admin access">
          <form className="auth-form" onSubmit={onSubmit}>
            <div>
              <h2>Admin sign in</h2>
              <p>Enter the admin ID and password.</p>
            </div>
            {err && <div className="apk-login-error" role="alert">{err}</div>}
            <div className="be-field">
              <label htmlFor="admin-ident">Admin ID</label>
              <input id="admin-ident" className="be-input" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </div>
            <div className="be-field">
              <label htmlFor="admin-pwd">Password</label>
              <input id="admin-pwd" className="be-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <button type="submit" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
