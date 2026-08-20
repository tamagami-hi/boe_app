import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as fundsApi from '../services/fundsApi.js';
import * as ordersApi from '../services/ordersApi.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { fmtMoney } from '../utils/format.js';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { buildPath } from '../navigation/routes.js';

/**
 * Start a SIP. In the current product a SIP is a schedule/reminder (spec §6.2
 * fallback): there is no automatic debit and no mandate to authorise. Each due
 * installment is paid by the client through a fresh PhonePe checkout using the
 * same order/pay flow as a one-time investment.
 */
export default function StartSipSheet() {
  const { fundId } = useParams();
  const navigate = useNavigate();
  const appConfig = useAppConfig();
  const settings = appConfig.mobile.screens.invest.sip;
  const [fund, setFund] = useState(null);
  const [amount, setAmount] = useState(settings.defaultAmount ?? '');
  const [months, setMonths] = useState(settings.defaultMonths ?? '');
  const [day, setDay] = useState(settings.defaultDebitDay ?? '');
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
    riskConsent: 'I have read the Risk disclosure and understand market risk.',
    scheduleConsent: 'I understand this SIP is a monthly schedule. Each installment is paid by me through a fresh checkout — no automatic debit is set up.',
    // A new key on purpose: legacy published configs carry provider-branded
    // `paymentDisclosure` copy that must not override the neutral fallback text.
    scheduleDisclosure: 'Each due installment is paid by you through a fresh PhonePe checkout. Nothing is debited automatically.',
    reviewRiskText: '',
    ...(settings.disclosures || {}),
  };
  const amountPresets = normalizeOptions(settings.amountPresets, [minSip, 1000, 2500, 5000, 10000])
    .filter((value) => value >= minSip);
  const durationOptions = normalizeOptions(settings.durationMonths, [12, 24, 36, 60, 120]);
  const debitDayOptions = normalizeOptions(settings.debitDays, [1, 5, 10, 15, 20]);

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
      const plan = await ordersApi.createSip({
        fundId,
        amount: amountNumber,
        durationMonths: monthsNumber,
        debitDay: day,
      });
      if (!plan?.id) {
        setErr("Couldn't create SIP. Try again.");
        setSubmitting(false);
        submitLockRef.current = false;
        return;
      }
      // `replace`: the flow is finished. Without it, one Back press re-entered
      // this review screen with its Confirm button still live. The plan detail
      // is where due installments are paid, one fresh checkout at a time.
      navigate(buildPath('mandate_detail', { mandateId: plan.id }), { replace: true });
    } catch (e) {
      const message = e?.message || "Couldn't create SIP. Try again.";
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
          </div>

          <div className="be-disclosure apk-mt-2">{disclosures.scheduleDisclosure}</div>

          <div className="be-disclosure apk-mt-2">{riskDisclosure}</div>

          <label className="apk-consent-row apk-mt-2">
            <input type="checkbox" checked={reviewConsent} onChange={(e) => setReviewConsent(e.target.checked)} />
            <span>I understand that investments are subject to market risks and have read the scheme-related documents.</span>
          </label>

          {err && <div className="apk-banner apk-banner-red apk-mt-2">{err}</div>}

        <div className="apk-review-actions">
            <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={!canConfirm} onClick={onConfirm}>
              {submitting ? 'Creating SIP…' : (
                <>
                  <CalendarClock size={18} strokeWidth={2} /> Create SIP
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
          <span className="be-badge be-badge-neutral">Schedule only</span>
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
          <div className="be-disclosure" id="sip-amount-help">Enter the amount you want to invest every month.</div>
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

        <hr className="be-rule" />

        <label className="apk-consent-row">
          <input type="checkbox" checked={c1} onChange={(e) => setC1(e.target.checked)} />
          <span>{disclosures.riskConsent}</span>
        </label>
        <label className="apk-consent-row">
          <input type="checkbox" checked={c2} onChange={(e) => setC2(e.target.checked)} />
          <span>{disclosures.scheduleConsent}</span>
        </label>

        <div className="apk-sheet-summary sip-setup-summary">
          <div className="apk-sheet-summary-row"><span>Monthly SIP</span><strong className="be-money"><MoneyValue amount={amountNumber} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          <div className="apk-sheet-summary-row"><span>Debit schedule</span><strong>{day || 'Configured debit day'} of every month</strong></div>
          <div className="apk-sheet-summary-row"><span>Total over {months || 'configured'} mo</span><strong className="be-money"><MoneyValue amount={amountNumber * monthsNumber} source="derived" asOf={new Date().toISOString()} showBadge={false} /></strong></div>
          <div className="be-disclosure apk-mt-1">{disclosures.scheduleDisclosure}</div>
        </div>

        {err && <div className="apk-banner apk-banner-red">{err}</div>}

        <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={!canReview} onClick={onContinue}>
          Review SIP details
        </button>
      </div>
    </>
  );
}
