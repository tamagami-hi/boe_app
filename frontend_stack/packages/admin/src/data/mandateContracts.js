const MANDATE_STATES = new Set([
  'setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'cancelled',
  'revoke_pending', 'revoked', 'expired', 'failed',
]);
const SIP_STATES = new Set([
  'draft', 'pending_mandate', 'active', 'paused', 'cancel_pending', 'cancelled',
  'completed', 'setup_failed', 'mandate_failed', 'expired', 'revoked',
]);
const SETUP_STATES = new Set(['created', 'dispatching', 'provider_pending', 'authorized', 'failed', 'expired']);
const NOTIFY_STATES = new Set(['created', 'dispatching', 'notified', 'failed']);
const CANCEL_STATES = new Set(['queued', 'dispatching', 'accepted', 'rejected', 'reconciliation_required']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function string(value, label, { optional = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${label}`);
  return value.trim();
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
}

function state(value, states, label, { optional = false } = {}) {
  const parsed = string(value, label, { optional });
  if (parsed === null) return null;
  if (!states.has(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

function timestamp(value, label, { optional = false } = {}) {
  const parsed = string(value, label, { optional });
  if (parsed === null) return null;
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`Invalid ${label}`);
  return parsed;
}

function optionalString(value, label) {
  return string(value, label, { optional: true });
}

export function parseMandateRow(value) {
  const row = object(value, 'mandate row');
  return {
    mandateId: string(row.mandateId, 'mandateId'),
    sipPlanId: string(row.sipPlanId, 'sipPlanId'),
    userId: string(row.userId, 'userId'),
    userEmail: optionalString(row.userEmail, 'userEmail'),
    userName: optionalString(row.userName, 'userName'),
    fundId: string(row.fundId, 'fundId'),
    fundName: optionalString(row.fundName, 'fundName'),
    amountPaise: integer(row.amountPaise, 'amountPaise'),
    debitDay: row.debitDay === null || row.debitDay === undefined ? null : integer(row.debitDay, 'debitDay'),
    sipState: state(row.sipState, SIP_STATES, 'sipState'),
    mandateState: state(row.mandateState, MANDATE_STATES, 'mandateState'),
    setupState: state(row.setupState, SETUP_STATES, 'setupState', { optional: true }),
    collectionState: state(row.collectionState, NOTIFY_STATES, 'collectionState', { optional: true }),
    cancelState: state(row.cancelState, CANCEL_STATES, 'cancelState', { optional: true }),
    latestDuePeriod: optionalString(row.latestDuePeriod, 'latestDuePeriod'),
    attentionReason: optionalString(row.attentionReason, 'attentionReason'),
    lastStatusCheckedAt: timestamp(row.lastStatusCheckedAt, 'lastStatusCheckedAt', { optional: true }),
    updatedAt: timestamp(row.updatedAt, 'updatedAt'),
  };
}

function parseSetup(value) {
  const row = object(value, 'setup attempt');
  return {
    setupAttemptId: string(row.setupAttemptId ?? row.id, 'setupAttemptId'),
    state: state(row.state ?? row.status, SETUP_STATES, 'setup state'),
    orderId: optionalString(row.orderId, 'setup orderId'),
    paymentId: optionalString(row.paymentId, 'setup paymentId'),
    paymentAttemptId: optionalString(row.paymentAttemptId, 'setup paymentAttemptId'),
    providerOrderId: optionalString(row.providerOrderId, 'setup providerOrderId'),
    failureCode: optionalString(row.failureCode, 'setup failureCode'),
    expiresAt: timestamp(row.expiresAt ?? row.setupExpiresAt, 'setup expiresAt'),
    lastStatusCheckedAt: timestamp(row.lastStatusCheckedAt, 'setup lastStatusCheckedAt', { optional: true }),
    updatedAt: timestamp(row.updatedAt, 'setup updatedAt'),
  };
}

function parseCollection(value) {
  const row = object(value, 'collection attempt');
  return {
    collectionId: string(row.collectionId ?? row.id, 'collectionId'),
    duePeriod: string(row.duePeriod, 'duePeriod'),
    amountPaise: integer(row.amountPaise, 'collection amountPaise'),
    notifyState: state(row.notifyState, NOTIFY_STATES, 'notifyState'),
    paymentState: optionalString(row.paymentState, 'collection paymentState'),
    orderId: string(row.orderId, 'collection orderId'),
    paymentId: string(row.paymentId, 'collection paymentId'),
    paymentAttemptId: string(row.paymentAttemptId, 'collection paymentAttemptId'),
    scheduledDebitAt: timestamp(row.scheduledDebitAt, 'scheduledDebitAt'),
    notifiedAt: timestamp(row.notifiedAt, 'notifiedAt', { optional: true }),
    failureCode: optionalString(row.failureCode ?? row.notifyFailureCode, 'collection failureCode'),
    updatedAt: timestamp(row.updatedAt, 'collection updatedAt'),
  };
}

function parseCancel(value) {
  const row = object(value, 'cancel command');
  return {
    commandId: string(row.commandId ?? row.id, 'commandId'),
    state: state(row.state, CANCEL_STATES, 'cancel state'),
    failureCode: optionalString(row.failureCode, 'cancel failureCode'),
    createdAt: timestamp(row.createdAt, 'cancel createdAt'),
    updatedAt: timestamp(row.updatedAt, 'cancel updatedAt'),
  };
}

export function parseMandatePage(payload) {
  const envelope = object(payload, 'mandate page');
  const data = object(envelope.data ?? envelope, 'mandate page data');
  if (!Array.isArray(data.items)) throw new Error('Invalid mandate items');
  const page = envelope.meta?.page ?? data.page ?? {};
  return {
    rows: data.items.map(parseMandateRow),
    nextCursor: optionalString(page.nextCursor, 'nextCursor'),
    hasMore: page.hasMore === true,
  };
}

export function parseMandateDetail(value) {
  const root = object(value?.data ?? value, 'mandate detail');
  const mandate = object(root.mandate, 'mandate');
  const user = object(root.user, 'mandate user');
  const fund = object(root.fund, 'mandate fund');
  const sip = object(root.sip, 'mandate SIP');
  return {
    mandate: {
      mandateId: string(mandate.mandateId ?? mandate.id, 'mandateId'),
      sipPlanId: string(mandate.sipPlanId, 'sipPlanId'),
      userId: string(mandate.userId, 'userId'),
      fundId: string(mandate.fundId, 'fundId'),
      amountPaise: integer(mandate.amountPaise, 'amountPaise'),
      state: state(mandate.state, MANDATE_STATES, 'mandate state'),
      merchantSubscriptionId: string(mandate.merchantSubscriptionId, 'merchantSubscriptionId'),
      providerSubscriptionId: optionalString(mandate.providerSubscriptionId, 'providerSubscriptionId'),
      failureCode: optionalString(mandate.failureCode, 'mandate failureCode'),
      lastStatusCheckedAt: timestamp(mandate.lastStatusCheckedAt, 'lastStatusCheckedAt', { optional: true }),
      updatedAt: timestamp(mandate.updatedAt, 'updatedAt'),
    },
    user: {
      id: string(user.id, 'user id'),
      name: optionalString(user.name, 'user name'),
      email: optionalString(user.email, 'user email'),
    },
    fund: { id: string(fund.id, 'fund id'), name: optionalString(fund.name, 'fund name') },
    sip: {
      id: string(sip.id, 'SIP id'),
      state: state(sip.state, SIP_STATES, 'SIP state'),
      collectionMode: string(sip.collectionMode, 'collectionMode'),
      debitDay: sip.debitDay === null || sip.debitDay === undefined ? null : integer(sip.debitDay, 'debitDay'),
    },
    setupAttempts: Array.isArray(root.setupAttempts) ? root.setupAttempts.map(parseSetup) : [],
    collectionAttempts: Array.isArray(root.collectionAttempts) ? root.collectionAttempts.map(parseCollection) : [],
    cancelCommands: Array.isArray(root.cancelCommands) ? root.cancelCommands.map(parseCancel) : [],
  };
}
