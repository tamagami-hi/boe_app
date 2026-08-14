import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as fundsApi from '../services/fundsApi.js';
import * as ordersApi from '../services/ordersApi.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { fmtMoney } from '../utils/format.js';
import { openRazorpayCheckout } from '../utils/razorpay.js';
import { useSession } from '../store/SessionContext.jsx';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { HOME_PATH, buildPath } from '../navigation/routes.js';

export default function StartSipSheet() {
  const { fundId } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const appConfig = useAppConfig();
  const settings = appConfig.mobile.screens.invest.sip;
  const [fund, setFund] = useState(null);
  const [amount, setAmount] = useState(settings.defaultAmount ?? '');
  const [months, setMonths] = useState(settings.defaultMonths ?? '');
  const [day, setDay] = useState(settings.defaultDebitDay ?? '');
  const [stepUpOn, setStepUpOn] = useState(false);
  const [stepUpPct, setStepUpPct] = useState(settings.defaultStepUpPct);
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewConsent, setReviewConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  // `disabled={!canConfirm}` is not enough: setSubmitting is async, so a fast
  // double tap can enter onConfirm twice before the re-render disables the button —
  // and that would create two SIP plans.
  const submitLockRef = useRef(false);

  useEffect(() => { fundsApi.getFund(fundId).then(setFund).catch(() => setFund(null)); }, [fundId, appConfig.publishedAt]);

  if (!fund) return (<><AppBar title="Start SIP" /><div className="apk-screen"><Skeleton variant="card" height={200} /></div></>);

  const minSip = Number(fund.minSip) || 0;
  const minDurationMonths = Number(settings.minDurationMonths) || 0;
  const amountNumber = Number(amount) || 0;
  const monthsNumber = Number(months) || 0;
  const validAmt = amount !== '' && amountNumber >= minSip;
  const validDur = months !== '' && (!minDurationMonths || monthsNumber >= minDurationMonths);
  const validDebitDay = day !== '';
  const canReview = validAmt && validDur && validDebitDay && c1 && c2;
  const canConfirm = reviewConsent && !submitting;
  const disclosures = {
    minimumPrefix: 'Minimum',
    stepUpTitle: 'Increase SIP every year',
    stepUpBody: 'Optional step-up. Default off.',
    riskConsent: 'I have read the Risk disclosure and understand market risk.',
    mandateConsent: 'I authorize BeOnEdge to set up a UPI AutoPay mandate for the recurring debits described above.',
    paymentDisclosure: 'Razorpay checkout opens after review for the first SIP payment and mandate setup.',
    reviewRiskText: '',
    ...(settings.disclosures || {}),
  };
  const amountPresets = normalizeOptions(settings.amountPresets, [minSip, 1000, 2500, 5000, 10000])
    .filter((value) => value >= minSip);
  const durationOptions = normalizeOptions(settings.durationMonths, [12, 24, 36, 60, 120]);
  const debitDayOptions = normalizeOptions(settings.debitDays, [1, 5, 10, 15, 20]);

  const mandateCap = Math.round(amountNumber * 1.5);
  const durationYears = Math.floor(monthsNumber / 12);
  const durationRemainingMonths = monthsNumber % 12;
  const durationText = durationYears > 0
    ? `${monthsNumber} months (${durationYears}${durationRemainingMonths > 0 ? ` yr ${durationRemainingMonths} mo` : ' years'})`
    : `${monthsNumber} months`;
  const debitDayText = day ? `${day}${getOrdinal(day)} of every month` : 'Configured debit day';

  const riskDisclosure = disclosures.reviewRiskText
    || 'Investments are subject to market risk. Please read all scheme-related documents carefully before investing.';

  function normalizeOptions(values, fallback) {
    const source = Array.isArray(values) && values.length ? values : fallback;
    return [...new Set(source.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  }

  function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  function onAmountChange(e) {
    const next = e.target.value;
    setAmount(next === '' ? '' : Math.max(0, Math.floor(Number(next))));
  }

  function onContinue() {
    setErr('');
    setReviewMode(true);
    setReviewConsent(false);
  }

  function onBack() {
    setReviewMode(false);
    setReviewConsent(false);
    setErr('');
  }

  async function onConfirm() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setErr('');
    setSubmitting(true);
    try {
      const order = await ordersApi.createSip({
        fundId,
        amount: amountNumber,
        frequency: 'monthly',
        durationMonths: monthsNumber,
        debitDay: day,
        stepUp: stepUpOn ? { amount: 0, percent: stepUpPct, frequencyMonths: 12, nextDate: '' } : null,
        consentTextVersion: 'v1.0-2026-05-05',
        consentedAt: new Date().toISOString(),
      });
      if (!order.paymentId) {
        setErr("Couldn't create SIP. Try again.");
        setSubmitting(false);
        submitLockRef.current = false;
        return;
      }
      const paymentPath = buildPath('payment_status', { paymentId: order.paymentId });
      if (order.providerName === 'razorpay' && order.providerOrderId && order.providerKeyId) {
        await openRazorpayCheckout({
          keyId: order.providerKeyId,
          orderId: order.providerOrderId,
          amount: order.amount,
          currency: order.currency,
          name: fund.name,
          description: 'SIP Setup',
          userEmail: user?.email || '',
          userContact: user?.phone || '',
          onSuccess: async (response) => {
            try {
              await ordersApi.confirmRazorpayPayment(order.paymentId, response);
              // `replace`: the flow is finished. Without it, one Back press
              // re-entered this review screen with its Confirm button still live.
              navigate(HOME_PATH, { replace: true });
            } catch {
              // Money may already have moved, so the app must not claim success
              // and must not strand the user on a dead review screen. The payment
              // route polls the authoritative server state.
              navigate(paymentPath, { replace: true });
            }
          },
          // Also fires when the user dismisses the Razorpay sheet. The order
          // exists either way, so its status page is the honest destination.
          onFailure: () => {
            navigate(paymentPath, { replace: true });
          },
        });
      } else {
        navigate(paymentPath, { replace: true });
      }
    } catch (e) {
      const message = e?.message || e?.code || "Couldn't create SIP. Try again.";
      setErr(message);
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  if (reviewMode) {
    return (
      <>
        <AppBar title="Review SIP" />
        <div className="apk-screen">
          <div className="be-eyebrow">Review your SIP</div>
          <h1 className="apk-h-sm apk-mt-1">{fund.name}</h1>
          <p className="apk-review-tagline">{fund.tagline}</p>

          <div className="be-card-flat apk-review-summary">
            <div className="apk-sheet-summary-row"><span>Amount per month</span><strong className="be-money"><MoneyValue amount={amountNumber} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
            <div className="apk-sheet-summary-row"><span>Duration</span><strong>{durationText}</strong></div>
            <div className="apk-sheet-summary-row"><span>Debit day</span><strong>{debitDayText}</strong></div>
            {stepUpOn && <div className="apk-sheet-summary-row"><span>Step-up</span><strong>+{stepUpPct}% every 12 months</strong></div>}
            <div className="apk-sheet-summary-row"><span>Mandate cap</span><strong className="be-money"><MoneyValue amount={mandateCap} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          </div>

          <div className="be-disclosure apk-mt-4">{riskDisclosure}</div>

          <label className="apk-consent-row apk-mt-2">
            <input type="checkbox" checked={reviewConsent} onChange={(e) => setReviewConsent(e.target.checked)} />
            <span>I understand that investments are subject to market risks and have read the scheme-related documents.</span>
          </label>

          {err && <div className="apk-banner apk-banner-red apk-mt-2">{err}</div>}

        <div className="apk-review-actions">
            <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={!canConfirm} onClick={onConfirm}>
              {submitting ? 'Setting up SIP…' : (
                <>
                  <CreditCard size={18} strokeWidth={2} /> Continue to Razorpay
                </>
              )}
            </button>
            <button type="button" className="be-btn be-btn-secondary be-btn-block be-btn-lg" onClick={onBack} disabled={submitting}>
              Back
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="Start SIP" />
      <div className="apk-screen sip-setup-screen">
        <div className="sip-setup-head">
          <div>
            <div className="be-eyebrow">Start SIP</div>
            <h1 className="apk-h-sm">Choose monthly amount</h1>
            <p>{fund.name}</p>
          </div>
          <span className="be-badge be-badge-neutral">Razorpay next</span>
        </div>

        <section className="sip-amount-panel" aria-labelledby="sip-amount-label">
          <div className="sip-amount-head">
            <span id="sip-amount-label">Monthly SIP amount</span>
            <strong>{disclosures.minimumPrefix} {fmtMoney(minSip)}</strong>
          </div>
          <div className="apk-amount-row sip-amount-row">
            <span className="apk-amount-prefix">₹</span>
            <input
              id="sip-amount-input"
              className="apk-amount-input be-money"
              type="number"
              inputMode="numeric"
              min={minSip || 0}
              step="500"
              value={amount}
              onChange={onAmountChange}
              placeholder="0"
              aria-invalid={amount !== '' && !validAmt}
              aria-describedby="sip-amount-help"
            />
          </div>
          <div className="apk-chip-row sip-amount-presets" role="group" aria-label="Amount presets">
            {amountPresets.map((v) => (
              <button type="button" key={v} className={'apk-chip' + (amount === v ? ' is-active' : '')} onClick={() => setAmount(v)}>{fmtMoney(v)}</button>
            ))}
          </div>
          {amount !== '' && !validAmt && <div className="be-field-error">Minimum is {fmtMoney(minSip)}.</div>}
          <div className="be-disclosure" id="sip-amount-help">Enter the amount you want debited every month.</div>
        </section>

        <div className="sip-setup-grid">
          <div className="be-field sip-setup-field">
            {/* A chip row is a set of buttons, not a form control, so the caption
                labels a group rather than pretending to be a <label>. */}
            <span className="be-field__label" id="sip-duration-label">Duration</span>
            <div className="apk-chip-row" role="group" aria-labelledby="sip-duration-label">
              {durationOptions.map((m) => (
                <button type="button" key={m} className={'apk-chip' + (months === m ? ' is-active' : '')} onClick={() => setMonths(m)}>{m} mo</button>
              ))}
            </div>
            {months !== '' && !validDur && <div className="be-field-error">Minimum SIP duration is {minDurationMonths} months.</div>}
          </div>

          <div className="be-field sip-setup-field">
            <span className="be-field__label" id="sip-debit-day-label">Monthly debit date</span>
            <div className="apk-chip-row" role="group" aria-labelledby="sip-debit-day-label">
              {debitDayOptions.map((d) => (
                <button type="button" key={d} className={'apk-chip' + (day === d ? ' is-active' : '')} onClick={() => setDay(d)}>{d}</button>
              ))}
            </div>
          </div>
        </div>

        {/* The step-up switch was a `<div role="button" aria-pressed>` with an
            onClick and no tabIndex or key handler, so the role was a promise the
            element could not keep. A real button with aria-pressed is the switch. */}
        {settings.stepUpEnabled && (
          <button
            type="button"
            className="apk-stepup-toggle"
            onClick={() => setStepUpOn((v) => !v)}
            aria-pressed={stepUpOn}
          >
            <span className="apk-stepup-toggle-text">
              <span className="apk-toggle-label">{disclosures.stepUpTitle}</span>
              <span className="apk-toggle-hint">{disclosures.stepUpBody}</span>
            </span>
            <span className={'apk-toggle' + (stepUpOn ? ' is-on' : '')} aria-hidden="true" />
          </button>
        )}
        {settings.stepUpEnabled && stepUpOn && (
          <div>
            <div className="apk-chip-row" role="group" aria-label="Annual step-up percentage">
              {normalizeOptions(settings.stepUpPercents, [5, 10, 15]).map((p) => (
                <button type="button" key={p} className={'apk-chip' + (stepUpPct === p ? ' is-active' : '')} onClick={() => setStepUpPct(p)}>{p}%</button>
              ))}
            </div>
            <div className="be-disclosure apk-mt-2">Your SIP amount will increase by {stepUpPct}% every 12 months. You can change or cancel this from Profile → Mandates.</div>
          </div>
        )}

        <hr className="be-rule" />

        <label className="apk-consent-row">
          <input type="checkbox" checked={c1} onChange={(e) => setC1(e.target.checked)} />
          <span>{disclosures.riskConsent}</span>
        </label>
        <label className="apk-consent-row">
          <input type="checkbox" checked={c2} onChange={(e) => setC2(e.target.checked)} />
          <span>{disclosures.mandateConsent}</span>
        </label>

        <div className="apk-sheet-summary sip-setup-summary">
          <div className="apk-sheet-summary-row"><span>Monthly SIP</span><strong className="be-money"><MoneyValue amount={amountNumber} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          <div className="apk-sheet-summary-row"><span>Debit schedule</span><strong>{day || 'Configured debit day'} of every month</strong></div>
          <div className="apk-sheet-summary-row"><span>Total over {months || 'configured'} mo</span><strong className="be-money"><MoneyValue amount={amountNumber * monthsNumber} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          <div className="apk-sheet-summary-row"><span>Mandate cap preview</span><strong className="be-money"><MoneyValue amount={mandateCap} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          {stepUpOn && <div className="apk-sheet-summary-row"><span>Step-up</span><strong>+{stepUpPct}% every 12 mo</strong></div>}
          <div className="be-disclosure apk-mt-1">{disclosures.paymentDisclosure}</div>
        </div>

        {err && <div className="apk-banner apk-banner-red">{err}</div>}

        <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={!canReview} onClick={onContinue}>
          Review SIP details
        </button>
      </div>
    </>
  );
}
