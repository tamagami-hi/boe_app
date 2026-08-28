import { apiRequest } from './_util.js';
import { paiseToRupees } from '@beonedge/shared/money.js';

// Option B: an investor's position is money on a dated ledger — there are no
// units and no NAV. `GET /v1/client/portfolio` derives every figure from that
// ledger on each read, so this adapter only converts paise to the rupees the UI
// renders. Nothing is cached client-side.

/** One pool's position: what went in, what it is worth now, and the difference. */
function mapPool(pool) {
  return {
    fundId: pool.fundId,
    invested: paiseToRupees(pool.totalInvestmentPaise),
    currentValue: paiseToRupees(pool.currentValuePaise),
    totalReturn: paiseToRupees(pool.totalGrowthPaise),
    returnPercent: pool.returnPercent,
    sipInstallments: pool.sipInstallmentCount,
    sipTotal: paiseToRupees(pool.sipTotalPaise),
    lumpSumCount: pool.lumpSumCount,
    lumpSumTotal: paiseToRupees(pool.lumpSumTotalPaise),
    redeemedTotal: paiseToRupees(pool.redeemedTotalPaise),
    allocatedGain: paiseToRupees(pool.allocatedGainPaise),
    firstInvestmentDate: pool.firstInvestmentDate,
    lastActivityDate: pool.lastActivityDate,
  };
}

/**
 * The "My Investment" card and the "Investment Summary" block in one read.
 *
 *   currentValue  = previous value + allocated gains - redemptions + new money
 *   invested      = SIP paid + lump sums - principal redeemed
 *   totalReturn   = currentValue - invested
 */
export async function getPortfolio() {
  const payload = await apiRequest('/v1/client/portfolio');
  const summary = payload?.summary ?? {};
  return {
      currentValue: paiseToRupees(payload?.currentValuePaise) ?? 0,
      invested: paiseToRupees(payload?.totalInvestmentPaise) ?? 0,
      totalReturn: paiseToRupees(payload?.totalGrowthPaise) ?? 0,
      returnPercent: payload?.returnPercent ?? null,
      // "Return Since First Investment" and "Last Updated" on the card.
      returnSince: payload?.returnSince ?? null,
      lastUpdated: payload?.lastUpdated ?? null,
      summary: {
        sipInstallments: summary.sipInstallmentCount ?? 0,
        sipTotal: paiseToRupees(summary.sipTotalPaise) ?? 0,
        lumpSumCount: summary.lumpSumCount ?? 0,
        lumpSumTotal: paiseToRupees(summary.lumpSumTotalPaise) ?? 0,
        redemptionCount: summary.redemptionCount ?? 0,
        redeemedTotal: paiseToRupees(summary.redeemedTotalPaise) ?? 0,
        allocatedGain: paiseToRupees(summary.allocatedGainPaise) ?? 0,
      },
      pools: (payload?.pools ?? []).map(mapPool),
      staleFlag: false,
      source: 'canonical',
  };
}
