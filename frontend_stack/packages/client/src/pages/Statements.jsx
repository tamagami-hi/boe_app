import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, FileText, FolderOpen, TrendingUp } from 'lucide-react';
import { ErrorState } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as statementsApi from '../services/statementsApi.js';
import { fmtDate, fmtMoney } from '../utils/format.js';
import PageSheet from '../layout/PageSheet.jsx';

// A statement is derived from the investor's own transaction history, one per
// month in which something moved. There is no generated document: the figures
// below are read from the ledger on request, so a statement can never disagree
// with what the dashboard shows.

const MONTH_LABEL = (period) => {
  const [year, month] = String(period).split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function Figure({ label, value, tone }) {
  return (
    <div className="apk-stmt-figure">
      <dt>{label}</dt>
      <dd className={'be-money' + (tone ? ` apk-stmt-${tone}` : '')}>{fmtMoney(value, { decimals: 2 })}</dd>
    </div>
  );
}

export default function Statements() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    statementsApi
      .listStatements()
      .then((rows) => { setItems(rows); setLoadError(null); })
      // Was `.catch(() => setItems([]))`, which rendered "Statements appear here
      // once your account has activity." — telling an investor with a year of
      // history that they have none, whenever the read failed.
      .catch((error) => setLoadError(error))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const latest = items[0] ?? null;
  const totalReturns = useMemo(
    () => items.reduce((sum, statement) => sum + Number(statement.returns || 0), 0),
    [items],
  );

  return (
    <>
      <AppBar title="Statements" />
      <div className="apk-screen apk-statements-screen">
        {loadError && (
          <ErrorState
            title="We could not load your statements"
            description="Your documents are unaffected. This screen could not reach the server."
            onRetry={load}
          />
        )}

        <header className="apk-statements-head">
          <div className="apk-statements-head-copy">
            <span className="be-eyebrow">Documents</span>
            <h1 className="apk-h">Statements</h1>
            <p className="apk-statements-sub">
              {/* An unknown count is not zero. When the read failed the subtitle
                  used to assert the account had no activity. */}
              {loadError
                ? 'We could not read your statement history.'
                : items.length > 0
                  ? `A statement for every month your account moved. ${items.length} on file.`
                  : 'Statements appear here once your account has activity.'}
            </p>
          </div>
          <dl className="apk-statements-summary" aria-label="Statement summary">
            <div>
              <dt className="be-num">{loadError ? '—' : items.length}</dt>
              <dd>Months</dd>
            </div>
            <div>
              {/* '—' rather than ₹0: a failed read must not state a figure. */}
              <dt className="be-num be-money">{loadError ? '—' : fmtMoney(totalReturns)}</dt>
              <dd>Returns to date</dd>
            </div>
          </dl>
        </header>

        {latest !== null && (
          <section className="be-card apk-stmt-latest" aria-label="Latest statement">
            <div className="apk-stmt-latest-head">
              <span className="be-eyebrow">Latest · {MONTH_LABEL(latest.period)}</span>
              <span className="apk-stmt-latest-value be-money">
                {fmtMoney(latest.closingValue, { decimals: 2 })}
              </span>
              <span className="apk-stmt-latest-label">Closing value</span>
            </div>
            <dl className="apk-stmt-figures">
              <Figure label="Opening value" value={latest.openingValue} />
              <Figure label="Invested" value={latest.contributions} tone="in" />
              <Figure label="Returns credited" value={latest.returns} tone="gain" />
              <Figure label="Withdrawn" value={latest.withdrawals} tone="out" />
            </dl>
          </section>
        )}

        {loaded && items.length === 0 ? (
          <div className="be-card apk-empty apk-statements-empty">
            <span className="apk-statements-empty-icon" aria-hidden="true">
              <FolderOpen size={22} strokeWidth={1.5} />
            </span>
            <h2 className="apk-h-sm">Nothing here yet</h2>
            <p>
              Your first statement is available for the month of your first investment. It is produced from
              your transaction history, so it is always up to date.
            </p>
          </div>
        ) : (
          <ul className="be-card apk-statements-list" role="list" aria-label="Monthly statements">
            {items.map((statement) => (
              <li key={statement.id} className="apk-statements-row">
                <button
                  type="button"
                  className="apk-statements-main"
                  onClick={() => setOpen(statement)}
                  aria-label={`Open the statement for ${MONTH_LABEL(statement.period)}`}
                >
                  <span className="apk-statements-icon" aria-hidden="true">
                    <FileText size={18} strokeWidth={1.5} />
                  </span>
                  <span className="apk-statements-text">
                    <span className="apk-statements-period">{MONTH_LABEL(statement.period)}</span>
                    <span className="apk-statements-meta">
                      <span className="be-tnum">
                        {fmtDate(statement.from)} — {fmtDate(statement.to)}
                      </span>
                      <span className="apk-statements-dot" aria-hidden="true">•</span>
                      {statement.entryCount} {statement.entryCount === 1 ? 'entry' : 'entries'}
                    </span>
                  </span>
                  <span className="apk-statements-amount be-money">
                    {fmtMoney(statement.closingValue)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Shared PageSheet wrapper: portal, focus trap and restore, ref-counted body
          lock, and overlay-stack registration so Android Back closes the statement
          rather than navigating the list behind it. */}
      <PageSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        label={open ? `Statement for ${MONTH_LABEL(open.period)}` : 'Statement'}
      >
        {open !== null && (
          <>
            <header className="apk-sheet-head">
              <h2 className="apk-h-sm">{MONTH_LABEL(open.period)}</h2>
              <p className="be-tnum apk-sheet-sub">
                {fmtDate(open.from)} — {fmtDate(open.to)}
              </p>
            </header>

            <dl className="apk-stmt-detail">
              <div>
                <dt>Opening value</dt>
                <dd className="be-money">{fmtMoney(open.openingValue, { decimals: 2 })}</dd>
              </div>
              <div>
                <dt>
                  <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" /> Invested this month
                </dt>
                <dd className="be-money">{fmtMoney(open.contributions, { decimals: 2 })}</dd>
              </div>
              <div>
                <dt>
                  <TrendingUp size={14} strokeWidth={1.75} aria-hidden="true" /> Returns credited
                </dt>
                <dd className="be-money">{fmtMoney(open.returns, { decimals: 2 })}</dd>
              </div>
              <div>
                <dt>
                  <ArrowDownRight size={14} strokeWidth={1.75} aria-hidden="true" /> Withdrawn
                </dt>
                <dd className="be-money">{fmtMoney(open.withdrawals, { decimals: 2 })}</dd>
              </div>
              <div className="apk-stmt-detail-total">
                <dt>Closing value</dt>
                <dd className="be-money">{fmtMoney(open.closingValue, { decimals: 2 })}</dd>
              </div>
              <div>
                <dt>Total invested to date</dt>
                <dd className="be-money">{fmtMoney(open.totalInvestment, { decimals: 2 })}</dd>
              </div>
            </dl>

            <p className="be-disclosure">
              Produced from your transaction history on request. Returns are published by BeOnEdge for each
              period.
            </p>
            <button type="button" className="be-btn be-btn-primary" onClick={() => setOpen(null)}>
              Close
            </button>
          </>
        )}
      </PageSheet>
    </>
  );
}
