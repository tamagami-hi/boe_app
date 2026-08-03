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
    // administrator publishes the pool's first monthly update.
    totalPoolSize: paiseToRupees(fundSize.aumPaise) ?? 0,
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
    try {
      return listFromPayload(await apiRequest('/v1/client/funds?limit=100')).map(mapFund);
    } catch (error) {
      if (error?.code !== 'USER_NOT_APPROVED') throw error;
      return clone(loadAppConfig().mobile.products);
    }
  }

  await delay();
  return clone(loadAppConfig().mobile.products);
}

export async function getFund(fundId) {
  if (useHttpApi()) {
    try {
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
    } catch (error) {
      if (error?.code !== 'USER_NOT_APPROVED') throw error;
      return clone(strategyById(loadAppConfig(), fundId));
    }
  }

  await delay();
  return clone(strategyById(loadAppConfig(), fundId));
}

/**
 * Submit a redemption (Option B). The investor picks a mode — the full available
 * value, returns only, half, or a custom amount — and the backend splits it into
 * its principal and returns components. Submitting does not move money: value
 * changes when the request is settled.
 */
export async function submitRedemption({ fundId, mode, amount } = {}) {
  if (useHttpApi()) {
    const body = { fundId, mode };
    // Rupees in the UI, paise on the wire.
    if (mode === 'custom') body.amountPaise = Math.round(Number(amount) * 100);
    const payload = await apiRequest('/v1/client/redemptions', { method: 'POST', body });
    return mapRedemptionRequest(payload?.redemption, payload?.availableValuePaise);
  }

  await delay(220);
  return {
    id: 'mock-redemption',
    status: 'submitted',
    mode,
    requestedAmount: mode === 'custom' ? Number(amount) : null,
    principalComponent: null,
    returnsComponent: null,
  };
}

function mapRedemptionRequest(row, availableValuePaise) {
  if (!row) return null;
  const toRupees = (paise) =>
    paise === null || paise === undefined ? null : Number(paise) / 100;
  return {
    id: row.id,
    fundId: row.fundId,
    fundSlug: row.fundSlug,
    status: row.status,
    mode: row.mode,
    requestedAmount: toRupees(row.requestedAmountPaise),
    principalComponent: toRupees(row.principalComponentPaise),
    returnsComponent: toRupees(row.returnsComponentPaise),
    settledAmount: toRupees(row.settledAmountPaise),
    submittedAt: row.submittedAt,
    settledAt: row.settledAt,
    availableValue: toRupees(availableValuePaise),
  };
}

export async function listRedemptionRequests() {
  if (useHttpApi()) {
    const payload = await apiRequest('/v1/client/redemptions');
    return listFromPayload(payload).map((row) => mapRedemptionRequest(row));
  }
  await delay(200);
  return [];
}
