import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { ErrorState, Skeleton } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import { HOME_PATH } from '../navigation/routes.js';

/** Time the confirmation stays on screen before handing back to Home. */
const HANDOFF_DELAY_MS = 600;

export default function MandateAuth() {
  const { mandateId } = useParams();
  const navigate = useNavigate();
  const [mandate, setMandate] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const [toast, setToast] = useState('');

  const mountedRef = useRef(true);
  // `disabled` is not a lock: setCompleting is async, so a double tap could
  // authorise twice.
  const completeLockRef = useRef(false);
  const timersRef = useRef([]);

  const track = (id) => { timersRef.current.push(id); return id; };

  const load = useCallback(async () => {
    try {
      const row = await ordersApi.getMandate(mandateId);
      if (!mountedRef.current) return;
      setMandate(row);
      setLoadError(null);
    } catch (error) {
      // Was `.catch(() => setMandate(null))`, which is indistinguishable from
      // "still loading" — the screen showed a skeleton forever with no way out.
      if (mountedRef.current) setLoadError(error);
    }
  }, [mandateId]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      // Without this the deferred hand-off fired after unmount and navigated the
      // user out of whatever screen they had moved to.
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current = [];
    };
  }, [load]);

  const onComplete = useCallback(async () => {
    if (completeLockRef.current) return;
    completeLockRef.current = true;
    setCompleteError('');
    setCompleting(true);
    try {
      const updated = await ordersApi.authorizeMandate(mandateId);
      if (!mountedRef.current) return;
      setMandate(updated);
      setCompleting(false);
      // `replace`: an authorised mandate is done. Pushing Home on top of it left
      // the completed authorisation one Back press away.
      track(setTimeout(() => navigate(HOME_PATH, { replace: true }), HANDOFF_DELAY_MS));
    } catch (error) {
      // The call used to have no error path at all: a failure left `completing`
      // true, so the button read "Verifying…" and was disabled for good, with no
      // indication that anything had gone wrong.
      if (!mountedRef.current) return;
      setCompleting(false);
      completeLockRef.current = false;
      setCompleteError(error?.message || 'We could not confirm the authorization. Please try again.');
    }
  }, [mandateId, navigate]);

  function onOpenUpi() {
    // Was "UPI app deep-link copied." — nothing was copied and no deep link
    // exists. This is the mock provider, so say what is actually true.
    setToast('This is a simulated mandate. Use "I\u2019ve completed authorization" to continue.');
    track(setTimeout(() => setToast(''), 2400));
  }

  if (!mandate) {
    return (
      <>
        <AppBar title="Authorize AutoPay" />
        <div className="apk-screen">
          {loadError ? (
            <ErrorState
              title="We could not load this mandate"
              description="Nothing has been authorised. This screen could not reach the server."
              onRetry={load}
            />
          ) : (
            <Skeleton variant="card" height={200} />
          )}
        </div>
      </>
    );
  }

  const isRazorpayPending = mandate.provider === 'razorpay' && !mandate.providerMandateId;
  const isMock = mandate.provider === 'mock';

  return (
    <>
      <AppBar title="Authorize AutoPay" />
      <div className="apk-screen">
        <h1 className="apk-h-sm">Authorize UPI AutoPay</h1>

        {isRazorpayPending ? (
          <div className="be-card be-pad-6 apk-text-center">
            <Info size={40} strokeWidth={1.5} className="apk-auth-icon" aria-hidden="true" />
            <h3 className="apk-auth-title">AutoPay setup is pending</h3>
            <p className="apk-body-text">
              Your UPI AutoPay mandate will be set up automatically after your first successful payment.
              You don't need to do anything right now.
            </p>
          </div>
        ) : (
          <div className="be-card apk-mandate-card">
            <ol aria-label="AutoPay authorization steps" className="apk-steps-list">
              {['Open UPI app', `Authorize mandate up to ${fmtMoney(mandate.maxAmount)}`, 'Return to app'].map((step, i) => (
                <li key={i} className="apk-timeline-row">
                  <div className="apk-timeline-dot is-active" aria-hidden="true" />
                  <div>{i + 1}. {step}</div>
                  <div />
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="be-card apk-mandate-card">
          <div className="apk-sheet-summary-row"><span>Max per cycle</span><strong className="be-money">{fmtMoney(mandate.maxAmount)}</strong></div>
          {mandate.validTo && <div className="apk-sheet-summary-row"><span>Valid until</span><strong>{fmtDate(mandate.validTo)}</strong></div>}
          <div className="apk-sheet-summary-row"><span>Status</span>
            <span className={'be-badge ' + (mandate.status === 'active' ? 'be-badge-active' : 'be-badge-paused')}>
              <span className="be-badge-dot" />{mandate.status === 'active' ? 'Active' : mandate.status.replace('_', ' ')}
            </span>
          </div>
          {mandate.provider && (
            <div className="apk-sheet-summary-row"><span>Provider</span><span className="be-badge be-badge-neutral">{mandate.provider}</span></div>
          )}
        </div>

        <div className="be-disclosure">
          {mandate.validTo
            ? `We can debit only up to ${fmtMoney(mandate.maxAmount)} per cycle until ${fmtDate(mandate.validTo)}. You can pause or cancel from support.`
            : `We can debit only up to ${fmtMoney(mandate.maxAmount)} per cycle. You can pause or cancel from support.`}
        </div>

        {mandate.status === 'active' && (
          <div className="be-disclosure">Your UPI AutoPay mandate is active.</div>
        )}

        {completeError && (
          <div className="apk-banner apk-banner-red" role="alert">{completeError}</div>
        )}

        {!isRazorpayPending && (
          <div className="apk-action-bar">
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-lg"
              onClick={onComplete}
              disabled={completing || mandate.status === 'active'}
            >
              {mandate.status === 'active' ? 'Authorized' : completing ? 'Verifying…' : "I've completed authorization"}
            </button>
            {isMock && (
              <button type="button" className="be-btn be-btn-primary be-btn-lg" onClick={onOpenUpi}>
                Open UPI app
              </button>
            )}
          </div>
        )}

        {isRazorpayPending && (
          <div className="apk-action-bar">
            <button
              type="button"
              className="be-btn be-btn-primary be-btn-lg"
              onClick={() => navigate(HOME_PATH, { replace: true })}
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
      {/* role=status so the confirmation is announced, not only drawn. */}
      {toast && <div className="apk-toast" role="status">{toast}</div>}
    </>
  );
}
