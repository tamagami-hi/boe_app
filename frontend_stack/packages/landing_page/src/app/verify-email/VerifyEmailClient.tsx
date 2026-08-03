'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Client half of the verification page. `useSearchParams` makes this dynamic, so
// the server page wraps it in Suspense to keep the rest of the route static.

type Phase = 'verifying' | 'verified' | 'failed' | 'missing';

export default function VerifyEmailClient() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [phase, setPhase] = useState<Phase>('verifying');
  const [message, setMessage] = useState('');

  const verify = useCallback(async () => {
    setPhase('verifying');
    setMessage('');
    try {
      const response = await fetch('/api/onboarding/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json()) as { verified?: boolean; error?: string };
      if (response.ok && body.verified === true) {
        setPhase('verified');
        return;
      }
      setPhase('failed');
      setMessage(body.error ?? 'We could not verify your email.');
    } catch {
      setPhase('failed');
      setMessage('The network request failed. Check your connection and try again.');
    }
  }, [token]);

  useEffect(() => {
    if (token === '') {
      setPhase('missing');
      return;
    }
    void verify();
  }, [token, verify]);

  if (phase === 'verifying') {
    return (
      <>
        <h1 className="section__title" style={{ marginBottom: '1rem' }}>Verifying your email…</h1>
        <p className="section__lead">One moment while we confirm your link.</p>
      </>
    );
  }

  if (phase === 'verified') {
    return (
      <>
        <h1 className="section__title" style={{ marginBottom: '1rem' }}>Email verified</h1>
        <p className="section__lead" style={{ marginBottom: '2rem' }}>
          Thanks — your application is now with our team for review. We will email you an activation
          link once it is approved.
        </p>
        <a className="btn btn--primary" href="/">Back to home</a>
      </>
    );
  }

  if (phase === 'missing') {
    return (
      <>
        <h1 className="section__title" style={{ marginBottom: '1rem' }}>Verification link incomplete</h1>
        <p className="section__lead" style={{ marginBottom: '2rem' }}>
          This page needs the token from your verification email. Open the link in that email directly.
        </p>
        <a className="btn btn--ghost" href="/signup">Back to signup</a>
      </>
    );
  }

  return (
    <>
      <h1 className="section__title" style={{ marginBottom: '1rem' }}>We could not verify that link</h1>
      <p className="section__lead" style={{ marginBottom: '2rem' }}>{message}</p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button type="button" className="btn btn--primary" onClick={() => void verify()}>
          Try again
        </button>
        <a className="btn btn--ghost" href="/signup">Start a new application</a>
      </div>
    </>
  );
}
