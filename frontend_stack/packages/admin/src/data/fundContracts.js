const FUND_STATES = new Set(['draft', 'published', 'paused', 'archived']);

function fail(operation, detail) {
  const error = new Error(
    `${operation} returned a payload this console does not understand (${detail}). `
    + 'The API and the console are out of step; reload, and report it if it persists.',
  );
  error.code = 'CONTRACT_MISMATCH';
  return error;
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPaise = (value) => typeof value === 'string' && /^-?\d{1,19}$/u.test(value);
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
const isId = (value) => typeof value === 'string' && value.length > 0;

function readFundSize(value, operation) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw fail(operation, 'aum is not an object');
  if (!isPaise(value.aumPaise)) throw fail(operation, 'aum.aumPaise is not a paise string');
  if (value.asOfDate !== null && !isDate(value.asOfDate)) {
    throw fail(operation, 'aum.asOfDate is not a date');
  }
  return value;
}

export function parseFundRow(row, operation = 'The fund catalogue') {
  if (!isObject(row)) throw fail(operation, 'a fund row is not an object');
  if (!isId(row.id)) throw fail(operation, 'a fund row has no id');
  if (!isId(row.slug)) throw fail(operation, 'a fund row has no slug');
  if (!FUND_STATES.has(row.status)) throw fail(operation, `unknown fund state "${row.status}"`);
  readFundSize(row.aum, operation);
  if (row.stockCount !== undefined && !Number.isInteger(row.stockCount)) {
    throw fail(operation, 'stockCount is not an integer');
  }
  return row;
}

export function parseFundSummary(summary, operation = 'The fund catalogue') {
  if (summary === undefined || summary === null) return null;
  if (!isObject(summary)) throw fail(operation, 'summary is not an object');
  if (!Number.isInteger(summary.total)) throw fail(operation, 'summary.total is not an integer');
  if (!isObject(summary.byState)) throw fail(operation, 'summary.byState is not an object');
  for (const state of FUND_STATES) {
    if (!Number.isInteger(summary.byState[state])) {
      throw fail(operation, `summary.byState.${state} is not an integer`);
    }
  }
  return summary;
}

export function parseFundDetail(payload) {
  const operation = 'The fund detail';
  if (!isObject(payload)) throw fail(operation, 'the payload is not an object');
  parseFundRow(payload.fund, operation);
  for (const key of ['versions', 'stocks', 'disclosures']) {
    if (!Array.isArray(payload[key])) throw fail(operation, `${key} is not an array`);
  }
  return payload;
}

export function parseCreatedFund(payload) {
  const operation = 'Creating the fund';
  if (!isObject(payload) || !isObject(payload.fund)) throw fail(operation, 'no fund was returned');
  if (!isId(payload.fund.id)) throw fail(operation, 'the new fund has no id');
  return payload;
}

export function parseAumSnapshot(snapshot, operation = 'The AUM history') {
  if (!isObject(snapshot)) throw fail(operation, 'a snapshot is not an object');
  if (!isId(snapshot.id)) throw fail(operation, 'a snapshot has no id');
  if (!isDate(snapshot.asOfDate)) throw fail(operation, 'a snapshot has no as-of date');
  if (!Number.isInteger(snapshot.revision)) throw fail(operation, 'revision is not an integer');
  if (!isPaise(snapshot.aumPaise)) throw fail(operation, 'aumPaise is not a paise string');
  return snapshot;
}

export function parseAumPreview(payload) {
  const operation = 'The collective preview';
  if (!isObject(payload)) throw fail(operation, 'the payload is not an object');
  if (typeof payload.basisHash !== 'string' || !/^[0-9a-f]{64}$/u.test(payload.basisHash)) {
    throw fail(operation, 'basisHash is missing or malformed');
  }
  if (!Array.isArray(payload.items)) throw fail(operation, 'items is not an array');
  for (const item of payload.items) {
    if (!isObject(item)) throw fail(operation, 'a preview row is not an object');
    if (!isId(item.fundId)) throw fail(operation, 'a preview row has no fundId');
    for (const key of ['beforeAumPaise', 'deltaPaise', 'afterAumPaise']) {
      if (!isPaise(item[key])) throw fail(operation, `a preview row has no ${key}`);
    }
  }
  return payload;
}
