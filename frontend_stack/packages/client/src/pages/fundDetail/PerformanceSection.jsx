import React, { useState } from 'react';
import { LineComparisonChart } from '../../components/Charts.jsx';
import { formatReturnPct, returnTone } from '../../utils/fundDisplay.js';

export default function PerformanceSection({ fund }) {
  const summary = fund.performanceSummary || {};
  const series = Array.isArray(fund.performanceSeries) ? fund.performanceSeries : [];
  const periods = Array.isArray(fund.performancePeriods) ? fund.performancePeriods : [];
  const [activeKey, setActiveKey] = useState(summary.selectedPeriod || periods[0]?.key || 'ALL');

  const headline = formatReturnPct(summary.annualizedReturnPct, { decimals: 2 });
  const oneDay = formatReturnPct(summary.oneDayReturnPct, { decimals: 2 });
  const hasSeries = series.length >= 2;
  if (!headline && !hasSeries) return null;
  const active = periods.find((p) => p.key === activeKey);

  return (
    <div className="be-card apk-pf">
      {headline && (
        <div className="apk-pf-head">
          <span className={`apk-pf-return apk-tone-${returnTone(summary.annualizedReturnPct)}`}>{headline}</span>
          {summary.selectedPeriod && <span className="apk-pf-period">{summary.selectedPeriod} annualised</span>}
          {oneDay && (
            <span className={`apk-pf-oneday apk-tone-${returnTone(summary.oneDayReturnPct)}`}>
              {oneDay} <span className="apk-pf-oneday-l">1D</span>
            </span>
          )}
        </div>
      )}
      {hasSeries ? (
        <LineComparisonChart series={series} width={340} height={150} padding={8} strokeWidth={2}
          showLegend legendFundLabel="Fund" legendBenchmarkLabel="Nifty 50" />
      ) : (
        <div className="apk-pf-pending">Performance data pending.</div>
      )}
      {periods.length > 0 && (
        /* Not a tablist. A tablist promises arrow-key navigation, aria-controls and
           a tabpanel, none of which exist here — these chips swap a series inside
           the same panel. `aria-pressed` is what they actually are. */
        <div className="apk-pf-chips" role="group" aria-label="Performance period">
          {periods.map((p) => (
            <button key={p.key} type="button" aria-pressed={activeKey === p.key}
              className={`apk-pf-chip ${activeKey === p.key ? 'is-active' : ''}`}
              onClick={() => setActiveKey(p.key)}>{p.label}</button>
          ))}
        </div>
      )}
      {active && (
        <div className="apk-pf-chip-detail">
          <span>Fund <strong className={`apk-tone-${returnTone(active.fundReturnPct)}`}>{formatReturnPct(active.fundReturnPct, { decimals: 2 })}</strong></span>
          <span>Nifty 50 <strong>{formatReturnPct(active.niftyReturnPct, { decimals: 2, sign: false })}</strong></span>
        </div>
      )}
      {/* Specific to this block. The general market-risk statement is made once, in
          the methodology disclosure at the foot of the page, where it also carries
          the disclosure version. Saying it three times dilutes it. */}
      <p className="apk-pf-disclaimer">Returns are admin-published and indicative.</p>
    </div>
  );
}
