# Backend and Data Contract Plan

## Current State

Admin fund records currently accept free-form fund fields plus structured `sectors`, `investments`, and `chartConfig` in `backend_controller/src/admin/services/fundsService.js:108`.

`computeFundAnalytics` currently computes sector total, total invested, investment count, fund age, and initial investment in `fundsService.js:50`.

Client fund payloads are sanitized by `toClientFund` in `fundsService.js:284` and `fundCatalogService.js:93`. The sanitizer currently:

- hides non-client lifecycle stages
- optionally hides sectors via `chartConfig.showSectorDistribution`
- optionally hides investments via `chartConfig.showInvestmentBreakdown`
- masks company names when `showCompanyNames` is false
- creates `allocation` and `topHoldings`

## Proposed Fund Shape

Add optional fields to the existing fund object. Keep every field optional so old fund records continue to render.

```js
{
  category: 'Equity',
  subCategory: 'Flexi Cap',
  riskText: 'Very High Risk',
  fundIconUrl: '',
  nav: {
    value: 90.79,
    asOf: '2026-05-20'
  },
  rating: {
    value: 5,
    scale: 5
  },
  performanceSummary: {
    selectedPeriod: '3Y',
    annualizedReturnPct: 16.9,
    oneDayReturnPct: 0.21,
    niftyReturnPct: 13.4,
    asOf: '2026-05-20'
  },
  performanceSeries: [
    { date: '2023-05-20', fund: 100, nifty: 100 },
    { date: '2024-05-20', fund: 118.4, nifty: 111.2 }
  ],
  performancePeriods: [
    { key: '1M', label: '1M', fundReturnPct: 2.1, niftyReturnPct: 1.3 },
    { key: '3Y', label: '3Y', fundReturnPct: 16.9, niftyReturnPct: 13.4, annualized: true }
  ],
  assetAllocation: [
    { id: 'equity', label: 'Equity', percentage: 97.17, color: '#7C79D8' },
    { id: 'cash', label: 'Cash', percentage: 2.6, color: '#4AA9D8' },
    { id: 'debt', label: 'Debt', percentage: 0.23, color: '#A9BD63' }
  ],
  holdingsAsOf: '2026-04-30',
  advancedRatios: {
    pe: 28.36,
    pb: 3.59,
    beta: 0.87,
    alpha: 3.0,
    sharpe: 0.81,
    sortino: 1.21
  },
  chartConfig: {
    showBenchmarkComparison: true,
    showAssetAllocation: true,
    showSectorDistribution: true,
    showAdvancedRatios: true,
    showInvestmentBreakdown: false,
    showCompanyNames: false
  }
}
```

## Sanitization Rules

Update both `toClientFund` implementations so clients receive only display-safe fields:

- Keep `performanceSeries`, `performancePeriods`, `performanceSummary`, `assetAllocation`, `advancedRatios`, `holdingsAsOf`, `nav`, `rating`, `category`, `subCategory`, `riskText`, and `fundIconUrl`.
- Continue to strip raw investment amounts.
- Continue to apply `showSectorDistribution`, `showInvestmentBreakdown`, and `showCompanyNames`.
- Add chart visibility gates:
  - `showBenchmarkComparison === false` removes performance series/periods.
  - `showAssetAllocation === false` removes asset allocation.
  - `showAdvancedRatios === false` removes advanced ratios.

## Backend Validation

Add lightweight validation during create/update, ideally in small helper functions near `plainObject` in `fundsService.js`:

- Percentages must be finite numbers from 0 to 100.
- Asset allocation total should warn or mark invalid if not close to 100; decide whether to block publish/active only.
- Performance series dates must be ISO-like date strings and sorted before persistence.
- Series values must be finite positive numbers, normalized to an index baseline such as 100.
- Advanced ratios must be finite numbers, but allow blanks.

## Backward Compatibility

Fallbacks should be deterministic:

- If `assetAllocation` is missing, derive an approximate split:
  - invested amount from `analytics.totalInvested`
  - cash = `totalPoolSize - totalInvested`
  - equity = total invested if sectors/investments exist
  - debt = 0 unless admin explicitly sets it
- If `performanceSeries` is missing, hide the comparison chart rather than drawing fake data.
- If `performanceSummary` is missing, compute rough total return from `initialInvestment/currentValue/launchDate` only for admin preview, not as client-facing Nifty comparison.

## Implementation Status

✅ **Complete.**

- `backend_controller/src/shared/services/fundClientView.js` — Single source of truth for client view with all sanitizers.
- `backend_controller/src/admin/services/fundsService.js` — `buildFundDisplayFields()` persists all new optional fields.
- `toClientFund` gates new display fields behind `showBenchmarkComparison`, `showAssetAllocation`, `showAdvancedRatios`.
- Raw investment amounts stripped; client-safe analytics only.
- All fields are optional so legacy fund records remain valid.
