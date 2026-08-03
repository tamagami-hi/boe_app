import { Suspense } from 'react';
import VerifyEmailClient from './VerifyEmailClient';

// Landing page for the onboarding verification link. The application email links
// to `/verify-email?token=…`; the client half posts that token to the same-origin
// BFF, which calls the canonical `POST /v1/applications/verify-email`. Verifying
// is what moves an application into the admin approval queue.

export const metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <main className="section" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="container" style={{ textAlign: 'center', maxWidth: '32rem' }}>
        <Suspense
          fallback={
            <>
              <h1 className="section__title" style={{ marginBottom: '1rem' }}>Verifying your email…</h1>
              <p className="section__lead">One moment while we confirm your link.</p>
            </>
          }
        >
          <VerifyEmailClient />
        </Suspense>
      </div>
    </main>
  );
}
