import React from 'react';
import { DonutChart } from '../../components/Charts.jsx';
import { fmtMoney } from '../../utils/format.js';
import { formatNavDate } from '../../utils/fundDisplay.js';
import { ADVANCED_RATIO_ROWS, withPaletteColors } from './fundDetailModel.js';
import AllocationLegend from './AllocationLegend.jsx';

// Sector allocation is deliberately NOT here. It was rendered twice on this page —
// once in this card and again in the dedicated sector card below, from the same
// `fund.sectors`. The sector card keeps it: it carries the "largest concentration"
// note and is what the allocation_chart / showSectorDistribution toggles govern.
export default function HoldingsAnalysis({ fund }) {
  const assetAllocation = withPaletteColors(Array.isArray(fund.assetAllocation) ? fund.assetAllocation : []);
  const ratios = fund.advancedRatios || {};
  const ratioRows = ADVANCED_RATIO_ROWS.filter((r) => Number.isFinite(Number(ratios[r.key])));

  const hasAsset = assetAllocation.length > 0;
  const hasRatios = ratioRows.length > 0;
  if (!hasAsset && !hasRatios) return null;
  const poolLabel = fund.totalPoolSize ? fmtMoney(fund.totalPoolSize) : '';

  return (
    <div className="be-card apk-ha">
      <div className="be-eyebrow">Holdings analysis</div>

      {hasAsset && (
        <div className="apk-ha-block">
          <h4 className="apk-ha-title">Equity / Debt / Cash split</h4>
          <DonutChart data={assetAllocation} size={184} thickness={28} centerLabel={poolLabel}
            ariaLabel="Equity debt cash split" />
          <AllocationLegend items={assetAllocation} />
        </div>
      )}

      {hasRatios && (
        <div className="apk-ha-block">
          <h4 className="apk-ha-title">Advanced ratios</h4>
          <div className="apk-ha-ratios">
            {ratioRows.map((r) => (
              <div key={r.key} className="apk-ha-ratio">
                <span>{r.label}</span>
                <strong className="be-num">{Number(ratios[r.key]).toFixed(2)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {fund.holdingsAsOf && <div className="apk-ha-asof">*Holdings as of {formatNavDate(fund.holdingsAsOf)}</div>}
    </div>
  );
}
