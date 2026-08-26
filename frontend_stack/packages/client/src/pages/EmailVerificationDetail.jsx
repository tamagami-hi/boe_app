import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Clock, MailCheck, ShieldAlert } from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import { fetchKycStatus } from '../services/kycApi.js';
import { fmtDate } from '../utils/format.js';
import { buildPath } from '../navigation/routes.js';

// KYC on BeOnEdge is an email one-time code: requesting it and entering it is the
// whole flow, after which the account can invest. This screen reports where that
// stands and links to the step that moves it forward. There is no document upload
// or FATCA/nominee capture — nothing collects or stores that today, so the screen
// does not pretend to.

const PRESENTATION = {
  not_started: {
    label: 'Not started',
    tone: 'paused',
    Icon: ShieldAlert,
    summary: 'Verify your email address to unlock investing.',
    action: 'Start verification',
  },
  in_progress: {
    label: 'Code sent',
    tone: 'paused',
    Icon: MailCheck,
    summary: 'We emailed you a 6-character code. Enter it exactly as shown to finish verification.',
    action: 'Enter code',
  },
  submitted: {
    label: 'In review',
    tone: 'paused',
    Icon: Clock,
    summary: 'Your verification is being processed.',
    action: null,
  },
  in_review: {
    label: 'In review',
    tone: 'paused',
    Icon: Clock,
    summary: 'Your verification is being processed.',
    action: null,
  },
  approved: {
    label: 'Verified',
    tone: 'active',
    Icon: BadgeCheck,
    summary: 'Your account is verified and can invest.',
    action: null,
  },
  rejected: {
    label: 'Not verified',
    tone: 'paused',
    Icon: ShieldAlert,
    summary: 'Verification did not complete. Start it again to try once more.',
    action: 'Try again',
  },
};

const FALLBACK = PRESENTATION.not_started;

export default function KycDetail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetchKycStatus()
      .then((next) => {
        setStatus(next);
        setError('');
      })
      .catch((loadError) => setError(loadError?.message || 'Your verification status is unavailable.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  if (!loaded) {
    return (
      <>
        <AppBar title="KYC & Compliance" />
        <div className="apk-screen">
          <Skeleton variant="card" height={200} />
        </div>
      </>
    );
  }

  const key = status?.status ?? 'not_started';
  const view = PRESENTATION[key] ?? FALLBACK;
  const { Icon } = view;
  const expired = status?.expired === true;

  return (
    <>
      <AppBar title="KYC & Compliance" />
      <div className="apk-screen">
        <section className="be-card apk-kyc-card">
          <div className="apk-mandate-head">
            <span className="apk-kyc-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.6} />
            </span>
            <span className={`be-badge be-badge-${expired ? 'paused' : view.tone}`}>
              <span className="be-badge-dot" />
              {expired ? 'Re-verification due' : view.label}
            </span>
          </div>
          <h1 className="apk-h-sm">Email verification</h1>
          <p className="apk-body-text">
            {expired
              ? 'Your verification has lapsed. Verify again to keep investing.'
              : view.summary}
          </p>

          <dl className="apk-kyc-facts">
            <div>
              <dt>Method</dt>
              <dd>Email one-time code</dd>
            </div>
            {status?.decidedAt && (
              <div>
                <dt>Verified on</dt>
                <dd>{fmtDate(status.decidedAt)}</dd>
              </div>
            )}
            {status?.expiresAt && (
              <div>
                <dt>{expired ? 'Expired on' : 'Valid until'}</dt>
                <dd>{fmtDate(status.expiresAt)}</dd>
              </div>
            )}
          </dl>

          {(view.action !== null || expired) && (
            <button
              type="button"
              className="be-btn be-btn-primary"
              onClick={() => navigate(buildPath('verify_email'))}
            >
              {expired ? 'Verify again' : view.action}
            </button>
          )}
        </section>

        {error !== '' && <p className="be-error">{error}</p>}

        <p className="be-disclosure">
          BeOnEdge verifies your email address before you can invest. If regulations require further
          documentation later, you will be asked for it here.
        </p>
      </div>
    </>
  );
}
