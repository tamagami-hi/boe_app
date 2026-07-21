import { fixturePortfolio } from '../data/fixturePortfolio.js';
import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

// Canonical money is integer paise (string); NAV/units are numeric(24,8) strings
// (spec 03 §1). The UI works in rupees, so convert at the adapter boundary.
const paiseToRupees = (paise) => (paise === null || paise === undefined ? null : Number(paise) / 100);
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

// Map a canonical GET /v1/client/holdings item to the UI holding shape.
function mapHolding(item) {
  const units = toNumber(item.totalUnits);
  const investedRupees = paiseToRupees(item.costBasisPaise);
  const marketValueRupees = paiseToRupees(item.marketValuePaise);
  return {
    fundId: item.fundId,
    fundName: item.fundName ?? item.fundSlug,
    fundSlug: item.fundSlug,
    units,
    reservedUnits: toNumber(item.reservedUnits),
    availableUnits: toNumber(item.availableUnits),
    avgCost: units && investedRupees ? investedRupees / units : null,
    invested: investedRupees,
    currentNav: toNumber(item.currentNav),
    marketValue: marketValueRupees,
    navAsOf: item.navAsOfDate,
    riskLevel: item.fundRiskLevel,
    category: item.fundCategory,
    status: item.fundState,
    dataAsOf: item.updatedAt,
    asOf: item.updatedAt,
    source: 'canonical',
  };
}

/** The authoritative holdings list (spec 03 §4.3), owner-scoped, native-authenticated. */
export async function getHoldings() {
  if (useHttpApi()) {
    const payload = await apiRequest('/v1/client/holdings');
    return listFromPayload(payload).map(mapHolding);
  }

  await delay();
  return clone(fixturePortfolio.holdings);
}

/**
 * Portfolio summary. In HTTP mode this is derived from the authoritative
 * holdings (there is no separate cached portfolio table in the canonical schema;
 * holdings and lots are ownership truth per spec 03 §4.3).
 */
export async function getPortfolio() {
  if (useHttpApi()) {
    const holdings = await getHoldings();
    const invested = holdings.reduce((total, h) => total + (h.invested ?? 0), 0);
    const marketValue = holdings.reduce((total, h) => total + (h.marketValue ?? 0), 0);
    const navDates = holdings.map((h) => h.navAsOf).filter(Boolean).sort();
    return {
      invested,
      marketValue,
      asOf: new Date().toISOString(),
      dataAsOf: navDates.length ? navDates[navDates.length - 1] : null,
      staleFlag: false,
      source: 'canonical',
      holdings,
    };
  }

  await delay();
  return clone(fixturePortfolio);
}
