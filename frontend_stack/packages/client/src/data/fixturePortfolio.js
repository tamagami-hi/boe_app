// Offline portfolio fixture in the Option B shape: money on a ledger, no units.
// The figures mirror the model document's worked example — ₹4,50,000 of SIP over
// 18 months plus ₹6,00,000 across three lump sums, valued at ₹12,38,450.
export const fixturePortfolio = {
  currentValue: 1_238_450.0,
  invested: 1_050_000.0,
  totalReturn: 188_450.0,
  returnPercent: 17.95,
  returnSince: '2025-04-01',
  lastUpdated: '2026-07-31',
  summary: {
    sipInstallments: 18,
    sipTotal: 450_000.0,
    lumpSumCount: 3,
    lumpSumTotal: 600_000.0,
    redemptionCount: 0,
    redeemedTotal: 0,
    allocatedGain: 188_450.0,
  },
  pools: [
    {
      fundId: 'strategy_slot_1',
      invested: 1_050_000.0,
      currentValue: 1_238_450.0,
      totalReturn: 188_450.0,
      returnPercent: 17.95,
      sipInstallments: 18,
      sipTotal: 450_000.0,
      lumpSumCount: 3,
      lumpSumTotal: 600_000.0,
      redeemedTotal: 0,
      allocatedGain: 188_450.0,
      firstInvestmentDate: '2025-04-01',
      lastActivityDate: '2026-07-31',
    },
  ],
  // Legacy aliases a few older components still read.
  marketValue: 1_238_450.0,
  asOf: '2026-07-31',
  dataAsOf: '2026-07-31',
  staleFlag: false,
  source: 'mock',
};
