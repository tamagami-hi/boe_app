import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';
import { loadAppConfig, strategyById } from '@beonedge/shared/appConfig.js';

// Canonical fund catalogue -> the product shape the fund screens render.
//
// Option B: a pool has no per-unit price. What investors see is its Fund Size
// (the latest published monthly AUM, with the date it was last updated) and its
// stock list, each entry tagged with the quarter it entered.
function mapFund(row) {
  if (!row) return null;
  const fundSize = row.fundSize || {};
  const paiseToRupees = (value) =>
    value === null || value === undefined ? null : Number(value) / 100;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.objective,
    objective: row.objective,
    categoryEyebrow: row.category,
    status: row.status === 'published' ? 'active' : row.status,
    lifecycleStage: row.status === 'published' ? 'active' : row.status,
    riskLabel: row.riskLevel,
    returnTier: row.returnTier,
    minSip: paiseToRupees(row.minimumSipPaise),
    minLumpsum: paiseToRupees(row.minimumPurchasePaise),
    minDurationMonths: row.minimumDurationMonths,
    horizon: row.recommendedHoldingMonths ? `${row.recommendedHoldingMonths} months+` : '',
    lockInText: 'None',
    // "Fund Size (AUM)" plus its period and last-updated stamp; null until the
    // administrator publishes the fund's first snapshot. Never invent a value.
    totalPoolSize: paiseToRupees(fundSize.aumPaise),
    fundSizeAsOfPeriod: fundSize.periodStart ?? null,
    fundSizeUpdatedAt: fundSize.lastUpdatedAt ?? null,
    stockCount: row.stockCount ?? 0,
    version: row.version,
  };
}

// The administrator-curated stock list ("Fund Portfolio"): each row is a company
// and the reporting quarter it was added, with an optional published weight.
function mapStocks(stocks = []) {
  return {
    stocks: stocks.map((stock) => ({
      name: stock.stockName,
      quarterAdded: stock.quarterLabel,
      weight: stock.weightPercent === null || stock.weightPercent === undefined
        ? null
        : Number(stock.weightPercent),
    })),
    // Weighted entries can still drive the allocation chart; unweighted ones are
    // simply listed.
    allocation: stocks
      .filter((stock) => stock.weightPercent !== null && stock.weightPercent !== undefined)
      .map((stock) => ({ label: stock.stockName, pct: Number(stock.weightPercent) })),
  };
}

export async function listFunds() {
  if (useHttpApi()) {
    // No fixture fallback in HTTP mode: a catalogue or eligibility error must
    // surface as an error, never as hard-coded products or invented AUM.
    return listFromPayload(await apiRequest('/v1/client/funds?limit=100')).map(mapFund);
  }

  await delay();
  return clone(loadAppConfig().mobile.products);
}

export async function getFund(fundId) {
  if (useHttpApi()) {
    const payload = await apiRequest(`/v1/client/funds/${encodeURIComponent(fundId)}`);
    const fund = mapFund(payload?.fund);
    if (!fund) return null;
    return {
      ...fund,
      ...mapStocks(payload?.stocks),
      investments: [],
      disclosureVersion: payload?.disclosure?.version ?? null,
      methodology: payload?.disclosure?.body ?? '',
      fees: [],
      chartConfig: { showSectorDistribution: true, showInvestmentBreakdown: false, showCompanyNames: true },
    };
  }

  await delay();
  return clone(strategyById(loadAppConfig(), fundId));
}
