import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';
import { fixtureStatements } from '../data/fixtureStatements.js';
import { paiseToRupees } from '@beonedge/shared/money.js';

const rupees = (paise) => paiseToRupees(paise) ?? 0;

/**
 * A statement is derived from the investor's own ledger, one per month in which
 * something moved — there is no generated PDF and no stored document, so the row
 * carries the figures themselves.
 */
function mapStatement(row) {
  return {
    id: row.id,
    period: row.period,
    from: row.periodStart,
    to: row.periodEnd,
    openingValue: rupees(row.openingValuePaise),
    contributions: rupees(row.contributionsPaise),
    returns: rupees(row.returnsPaise),
    withdrawals: rupees(row.withdrawalsPaise),
    closingValue: rupees(row.closingValuePaise),
    totalInvestment: rupees(row.totalInvestmentPaise),
    entryCount: row.entryCount ?? 0,
  };
}

export async function listStatements() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/statements')).map(mapStatement);
  }

  await delay();
  return clone(fixtureStatements);
}
