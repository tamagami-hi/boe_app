import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MailCheck, ShieldCheck } from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import { startKyc, resendKyc, verifyKyc } from '../services/kycApi.js';
import { getInvestingEligibility } from '../services/eligibilityApi.js';

// Email-OTP KYC — the step that turns an activated account into an eligible one.
//
// Flow: `POST /v1/client/kyc/start` emails a 6-digit code from the company
// mailbox, `POST /v1/client/kyc/verify` approves the case, and eligibility then
// reports `eligible`. Resend is cooldown-guarded server-side (429) and the code
// has an attempt cap (409) and expiry (410); each is surfaced verbatim rather
// than being flattened into one generic failure.

const CODE_LENGTH = 6;

export default function KycVerify() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('sending');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = useCallback(async (resend) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = resend ? await resendKyc() : await startKyc();
      // An already-approved case short-circuits: nothing left to verify.
      if (result?.status === 'approved') {
        setPhase('approved');
        return;
      }
      setPhase('code_sent');
      setNotice(resend ? 'A new code is on its way.' : 'We emailed you a 6-digit code.');
    } catch (requestError) {
      setPhase('code_sent');
      setError(requestError?.message || 'We could not send a code. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Check eligibility first: a user who is already verified should not be
    // asked for a code at all.
    let cancelled = false;
    getInvestingEligibility()
      .then((eligibility) => {
        if (cancelled) return;
        if (eligibility?.canInvest || eligibility?.eligibility === 'eligible') {
          setPhase('approved');
          return;
        }
        void requestCode(false);
      })
      .catch(() => {
        if (!cancelled) void requestCode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestCode]);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (code.trim().length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await verifyKyc(code.trim());
      setPhase('approved');
    } catch (verifyError) {
      setError(verifyError?.message || 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'approved') {
    return (
      <>
        <AppBar title="Verification complete" />
        <div className="apk-screen apk-state-screen">
          <div className="be-card apk-approval-card">
            <div className="apk-approval-icon"><ShieldCheck size={22} strokeWidth={1.6} /></div>
            <div>
              <div className="be-eyebrow">Verified</div>
              <h1 className="apk-h-sm">Your account is ready to invest.</h1>
              <p>Email verification is complete, so investing, payments, and SIPs are unlocked.</p>
            </div>
          </div>
          <button
            type="button"
            className="be-btn be-btn-primary be-btn-block be-btn-lg"
            onClick={() => navigate('/app/explore', { replace: true })}
          >
            Browse strategies
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="Verify your email" />
      <div className="apk-screen apk-state-screen">
        <div className="be-card apk-approval-card">
          <div className="apk-approval-icon"><MailCheck size={22} strokeWidth={1.6} /></div>
          <div>
            <div className="be-eyebrow">One last step</div>
            <h1 className="apk-h-sm">Enter your verification code.</h1>
            <p>
              We send a {CODE_LENGTH}-digit code to your registered email address. It expires in a few
              minutes.
            </p>
          </div>
        </div>

        <form className="apk-login-form" onSubmit={onSubmit} noValidate>
          <label className="apk-field">
            <span>Verification code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              aria-label={`${CODE_LENGTH}-digit verification code`}
            />
          </label>

          {notice && <div className="apk-alert" role="status">{notice}</div>}
          {error && <div className="apk-alert apk-alert-error" role="alert">{error}</div>}

          <button type="submit" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify email'}
          </button>
        </form>

        <button
          type="button"
          className="be-btn be-btn-ghost be-btn-block"
          onClick={() => void requestCode(true)}
          disabled={busy || phase === 'sending'}
        >
          Resend code
        </button>
      </div>
    </>
  );
}
