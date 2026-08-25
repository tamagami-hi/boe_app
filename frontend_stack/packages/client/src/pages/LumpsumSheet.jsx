import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import ErrorState from '@beonedge/shared/components/ErrorState.jsx';
import * as fundsApi from '../services/fundsApi.js';
import * as ordersApi from '../services/ordersApi.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { fmtMoney } from '../utils/format.js';
import { useOrderCheckout } from '../payments/CheckoutProvider.jsx';

const RISK_DISCLOSURE = 'Investments are subject to market risk. Please read all scheme-related documents carefully before investing.';

export default function LumpsumSheet() {
  const { fundId } = useParams();
  const startOrderCheckout = useOrderCheckout();
  const appConfig = useAppConfig();
  const settings = appConfig.mobile.screens.invest.oneTime;
  const [fund, setFund] = useState(null);
  const [amount, setAmount] = useState(settings.defaultAmount ?? '');
  const [riskConsent, setRiskConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const submitLockRef = useRef(false);

  const [loadError, setLoadError] = useState('');
  const loadFund = useCallback(() => {
    setLoadError('');
    fundsApi.getFund(fundId)
      .then(setFund)
      .catch((error) => setLoadError(error?.message || 'Could not load this pool.'));
  }, [fundId]);

  useEffect(() => { loadFund(); }, [loadFund, appConfig.publishedAt]);

  if (loadError) {
    return (
      <>
        <AppBar title="One-time" />
        <div className="apk-screen">
          <ErrorState
            title="We could not load this pool"
            description={loadError}
            onRetry={loadFund}
          />

        </div>

      </>
    );
  }

  if (!fund) return (<><AppBar title="One-time" /><div className="apk-screen"><Skeleton variant="card" height={200} /></div></>);

  const amountNumber = Number(amount) || 0;
  const minLumpsum = Number(fund.minLumpsum) || 0;
  const valid = amount !== '' && amountNumber >= minLumpsum;

  function onAmountChange(e) {
    const next = e.target.value;
    setAmount(next === '' ? '' : Math.max(0, Math.floor(Number(next))));
  }

  async function onContinue() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setErr('');
    setSubmitting(true);
    try {
      const order = await ordersApi.createLumpsum({ fundId, amount: amountNumber });
      await startOrderCheckout(order.id);
      return;
    } catch (e) {
      // Server envelope messages are client-safe; anything else gets the
      // generic line. Internals (codes, stack, provider detail) stay hidden.
      const message = e?.message || "Couldn't start investment. Try again.";
      setErr(message);
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  return (
    <>
      <AppBar title="One-time" />
      <div className="apk-screen">
        <div className="be-eyebrow">One-time investment</div>

        <h1 className="apk-h-sm">{fund.name}</h1>

        <div className="be-field">

          <label className="be-field__label" htmlFor="lumpsum-amount">Amount</label>

          <div className="apk-amount-row">
            <span className="apk-amount-prefix" aria-hidden="true">₹</span>

            <input
              id="lumpsum-amount"
              className="apk-amount-input be-money"
              type="number"
              inputMode="numeric"
              min={minLumpsum || 0}
              step="500"
              value={amount}
              onChange={onAmountChange}
              placeholder="0"
              aria-invalid={!valid}
              aria-describedby="lumpsum-amount-min"
            />
          </div>

          <div className="apk-chip-row apk-mt-2" role="group" aria-label="Amount presets">
            {settings.amountPresets.map((v) => (
              <button type="button" key={v} className={'apk-chip' + (amount === v ? ' is-active' : '')} onClick={() => setAmount(v)}>{fmtMoney(v)}</button>
            ))}
          </div>

          <div className="be-field-error" id="lumpsum-amount-min" hidden={valid}>
            Minimum is {fmtMoney(minLumpsum)}.
          </div>

        </div>

        <div className="apk-sheet-summary">
          <div className="apk-sheet-summary-row"><span>One-time investment</span><strong className="be-money">{fmtMoney(amountNumber)}</strong></div>

          <div className="be-disclosure apk-mt-1">{settings.paymentDisclosure}</div>

          <div className="be-disclosure apk-mt-1">{RISK_DISCLOSURE}</div>

        </div>

        <label className="apk-consent-row">
          <input type="checkbox" checked={riskConsent} onChange={(e) => setRiskConsent(e.target.checked)} />

          <span>I understand that investments are subject to market risks and have read the scheme-related documents.</span>

        </label>

        {err && <div className="apk-banner apk-banner-red">{err}</div>}

        <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" disabled={!valid || !riskConsent || submitting} onClick={onContinue}>
          {submitting ? 'Opening secure checkout…' : (
            <>
              <CreditCard size={18} strokeWidth={2} /> Pay {fmtMoney(amountNumber)}

            </>
          )}
        </button>

      </div>

    </>
  );
}
