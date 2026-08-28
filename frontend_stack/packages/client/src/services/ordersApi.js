import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';
import { paiseToRupees } from '@beonedge/shared/money.js';

// Client-safe order/payment projection (spec §9.2). The backend never returns
// raw internal order/payment/review enums to the browser; the UI groups the
// client-safe values for its coarse filters.
const ACTIVE_STATES = new Set([
  'payment_in_progress', 'processing', 'refund_in_progress',
  // Raw order states, tolerated if an older payload still carries them.
  'submitted', 'payment_pending', 'review_pending',
]);
const CLOSED_STATES = new Set([
  'payment_failed', 'support_required', 'refunded',
  'cancelled', 'refund_pending', 'refund_failed',
]);

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createIdempotencyKey(prefix = 'idem') {
  return `${prefix}-${idempotencyKey()}`;
}

// Money enters HTTP APIs as a decimal string (spec §9). The UI works in whole
// rupees; convert once here and refuse anything that is not a safe positive
// integer amount in paise.
function rupeesToPaiseString(amount) {
  const paise = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new Error('Enter a valid amount.');
  }
  return String(paise);
}

// Map a GET /v1/client/orders item to the UI order shape. Positive allowlist:
// allocation, review and operator fields must never reach the client bundle.
function mapOrder(item) {
  if (!item) return null;
  return {
    id: item.orderId,
    fundId: item.fundId,
    sipPlanId: item.sipPlanId ?? null,
    type: item.type,
    status: item.status,
    amount: paiseToRupees(item.amountPaise),
    currency: item.currency,
    requestedAt: item.requestedAt,
    createdAt: item.createdAt,
    source: 'canonical',
  };
}

function matchesOrderFilter(order, filter) {
  if (filter === 'active') return ACTIVE_STATES.has(order.status);
  if (filter === 'cancelled') return CLOSED_STATES.has(order.status);
  if (filter === 'paused') return false; // SIP pause lives on sip_plans, not orders
  return true;
}

/* ---- fixture-mode state (offline demo only; never a production fallback) ---- */

let orders = [];
let sipRequests = [];
const payments = new Map();

let oId = 1;
let pId = 1;
let rId = 1;

function nextId(prefix, n) { return `${prefix}_${String(n).padStart(3, '0')}`; }

// Map a SIP plan (POST /v1/client/sips) to the UI shape. Money is paise on the
// wire and rupees in the UI. There is no mandate: a SIP is a schedule/reminder
// and each due installment is paid through a fresh client-initiated checkout
// (spec §6.2 fallback).
function mapSip(sip) {
  if (!sip) return null;
  return {
    id: sip.sipId,
    type: 'sip',
    status: sip.status,
    fundId: sip.fundId,
    amount: paiseToRupees(sip.amountPaise),
    debitDay: sip.debitDay,
    durationMonths: sip.durationMonths ?? null,
    nextDueDate: sip.nextDueDate ?? null,
    source: 'canonical',
  };
}

const AUTO_PAY_STATES = new Set([
  'pending_mandate', 'active', 'paused', 'cancel_pending', 'cancelled',
  'completed', 'setup_failed', 'mandate_failed', 'expired', 'revoked',
]);

const AUTO_PAY_MANDATE_STATES = new Set([
  'setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending',
  'cancelled', 'revoke_pending', 'revoked', 'expired', 'failed',
]);

const AUTO_PAY_SETUP_STATES = new Set([
  'created', 'dispatching', 'provider_pending', 'authorized', 'failed', 'expired',
]);

function requiredText(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function mapAutoPayDetail(payload) {
  const sipPlanId = requiredText(payload?.sipPlanId);
  const mandateId = requiredText(payload?.mandate?.mandateId ?? payload?.mandateId);
  const status = requiredText(payload?.status);
  const mandateStatus = requiredText(payload?.mandate?.status);
  const latestSetupState = payload?.latestSetupState == null ? null : requiredText(payload.latestSetupState);
  if (
    !sipPlanId || !mandateId || !AUTO_PAY_STATES.has(status) || !AUTO_PAY_MANDATE_STATES.has(mandateStatus) ||
    (latestSetupState !== null && !AUTO_PAY_SETUP_STATES.has(latestSetupState)) ||
    (payload?.canRetrySetup !== undefined && typeof payload.canRetrySetup !== 'boolean') ||
    (payload?.canRetrySetup === true && latestSetupState !== 'failed')
  ) {
    throw new Error("Couldn't load this AutoPay SIP. Try again.");
  }
  return {
    id: sipPlanId,
    type: 'sip',
    collectionMode: 'phonepe_autopay',
    status,
    fundId: requiredText(payload.fundId),
    amount: paiseToRupees(payload.amountPaise),
    debitDay: payload.debitDay ?? null,
    durationMonths: payload.durationMonths ?? null,
    latestSetupState,
    canRetrySetup: payload?.canRetrySetup === true,
    mandate: {
      id: mandateId,
      status: mandateStatus,
      authorizedAt: payload?.mandate?.authorizedAt ?? null,
      cancellationRequestedAt: payload?.mandate?.cancellationRequestedAt ?? null,
    },
    source: 'canonical',
  };
}

function mapAutoPaySetup(payload) {
  const sipPlanId = requiredText(payload?.sipPlanId);
  const mandateId = requiredText(payload?.mandateId);
  const orderId = requiredText(payload?.orderId);
  const paymentId = requiredText(payload?.paymentId);
  const checkout = mapPaymentCheckout(payload?.checkout);
  if (
    !sipPlanId || !mandateId || !orderId || !paymentId ||
    payload?.status !== 'mandate_setup_in_progress' || (checkout !== null && checkout.type !== 'redirect')
  ) {
    throw new Error("Couldn't start AutoPay authorization. Try again.");
  }
  return {
    id: sipPlanId,
    mandateId,
    orderId,
    paymentId,
    status: 'pending_mandate',
    collectionMode: 'phonepe_autopay',
    checkout,
  };
}

function autoPayInput({ fundId, amount, durationMonths, debitDay }) {
  const months = Number(durationMonths);
  const day = Number(debitDay);
  if (!requiredText(fundId) || !Number.isInteger(months) || months < 1 || months > 360) {
    throw new Error('AutoPay duration must be between 1 and 360 months.');
  }
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error('Choose a debit day between 1 and 28.');
  }
  const amountPaise = rupeesToPaiseString(amount);
  if (BigInt(amountPaise) > 1_500_000n) throw new Error('AutoPay SIP amount cannot exceed ₹15,000.');
  return { fundId, amountPaise, debitDay: day, durationMonths: months };
}

export async function createAutoPaySip(input, { requestKey } = {}) {
  const body = autoPayInput(input);
  if (useHttpApi()) {
    return mapAutoPaySetup(await apiRequest('/v1/client/sips/autopay', {
      method: 'POST',
      headers: { 'idempotency-key': requiredText(requestKey) ?? idempotencyKey() },
      body,
    }));
  }
  await delay(180);
  const id = nextId('sip_auto', oId++);
  const plan = {
    id,
    type: 'sip',
    collectionMode: 'phonepe_autopay',
    status: 'pending_mandate',
    fundId: input.fundId,
    amount: input.amount,
    debitDay: input.debitDay,
    durationMonths: input.durationMonths,
    mandate: { id: nextId('mandate', oId++), status: 'setup_pending', authorizedAt: null, cancellationRequestedAt: null },
    source: 'mock',
  };
  orders = [plan, ...orders];
  return { ...clone(plan), paymentId: nextId('payment', pId++), checkout: null };
}

export async function getAutoPaySip(sipPlanId) {
  if (useHttpApi()) {
    return mapAutoPayDetail(await apiRequest(`/v1/client/sips/autopay/${encodeURIComponent(sipPlanId)}`));
  }
  await delay(80);
  const plan = orders.find((item) => item.id === sipPlanId && item.collectionMode === 'phonepe_autopay');
  if (!plan) return null;
  return clone(plan);
}

export async function retryAutoPaySetup(sipPlanId) {
  if (useHttpApi()) {
    return mapAutoPaySetup(await apiRequest(`/v1/client/sips/autopay/${encodeURIComponent(sipPlanId)}/setup/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    }));
  }
  await delay(120);
  const plan = await getAutoPaySip(sipPlanId);
  if (!plan) throw new Error('AutoPay SIP unavailable.');
  return { ...plan, paymentId: nextId('payment', pId++), checkout: null };
}

export async function cancelAutoPaySip(sipPlanId) {
  if (useHttpApi()) {
    const result = await apiRequest(`/v1/client/sips/autopay/${encodeURIComponent(sipPlanId)}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    });
    if (requiredText(result?.mandateId) === null || !['cancel_pending', 'cancelled'].includes(result?.status)) {
      throw new Error("Couldn't request AutoPay cancellation. Try again.");
    }
    return { mandateId: result.mandateId, status: result.status };
  }
  await delay(120);
  orders = orders.map((item) => item.id === sipPlanId ? {
    ...item,
    status: 'cancel_pending',
    mandate: { ...item.mandate, status: 'cancel_pending', cancellationRequestedAt: new Date().toISOString() },
  } : item);
  return { mandateId: orders.find((item) => item.id === sipPlanId)?.mandate?.id, status: 'cancel_pending' };
}

export async function createSip({ fundId, amount, durationMonths, debitDay }) {
  if (useHttpApi()) {
    const created = await apiRequest('/v1/client/sips', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
      body: {
        fundId,
        amountPaise: rupeesToPaiseString(amount),
        debitDay: debitDay ?? 1,
        ...(durationMonths ? { durationMonths } : {}),
      },
    });
    return mapSip(created);
  }

  await delay(180);
  const plan = {
    id: nextId('sip', oId++),
    type: 'sip',
    fundId,
    amount,
    durationMonths,
    debitDay,
    status: 'active',
    nextDueDate: null,
    createdAt: new Date().toISOString(),
    source: 'mock',
  };
  orders.unshift(plan);
  return clone(plan);
}

/** The investor's SIP plans. */
export async function listSips() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/sips')).map(mapSip);
  }

  await delay();
  return clone(orders.filter((order) => order.type === 'sip'));
}

const sipControl = (action) => async (sipId) => {
  if (useHttpApi()) {
    const sip = await apiRequest(`/v1/client/sips/${encodeURIComponent(sipId)}/${action}`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    });
    return mapSip(sip);
  }
  await delay(140);
  const statusByAction = { pause: 'paused', resume: 'active', cancel: 'cancelled' };
  return { id: sipId, status: statusByAction[action] };
};

export const pauseSip = sipControl('pause');
export const resumeSip = sipControl('resume');
export const cancelSip = sipControl('cancel');

export async function createLumpsum({ fundId, amount }) {
  if (useHttpApi()) {
    // POST /v1/client/orders creates a one-time order in `submitted`. It does
    // NOT return a payment: beginOrderPayment() is a separate call (spec §9.1).
    const created = await apiRequest('/v1/client/orders', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
      body: { fundId, amountPaise: rupeesToPaiseString(amount) },
    });
    return mapOrder(created);
  }

  await delay(180);
  const order = {
    id: nextId('ord_lump', oId++),
    type: 'lump_sum',
    fundId,
    amount,
    status: 'payment_in_progress',
    createdAt: new Date().toISOString(),
    source: 'mock',
    currency: 'INR',
  };
  orders.unshift(order);
  return clone(order);
}

export function mapPaymentCheckout(checkout) {
  if (checkout === null || checkout === undefined) return null;
  if (checkout.type === 'redirect' && typeof checkout.url === 'string') {
    let url;
    try {
      url = new URL(checkout.url);
    } catch {
      throw new Error("Couldn't start the payment. Try again.");
    }
    if (url.protocol === 'https:' && url.username === '' && url.password === '') {
      return { type: 'redirect', url: url.toString() };
    }
  }
  throw new Error("Couldn't start the payment. Try again.");
}

export async function beginOrderPayment(orderId, { checkoutChannel = 'hosted_redirect' } = {}) {
  if (useHttpApi()) {
    const payload = await apiRequest(`/v1/client/orders/${encodeURIComponent(orderId)}/pay`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
      body: { checkoutChannel },
    });
    const row = payload?.payment ?? payload;
    return {
      orderId: row?.orderId ?? orderId,
      paymentId: row?.paymentId ?? null,
      provider: row?.provider ?? null,
      checkout: mapPaymentCheckout(row?.checkout),
      expiresAt: row?.checkout?.expiresAt ?? row?.expiresAt ?? null,
    };
  }

  await delay(160);
  const paymentId = nextId('pay', pId++);
  payments.set(paymentId, {
    id: paymentId,
    orderId,
    amount: orders.find((o) => o.id === orderId)?.amount ?? null,
    status: 'payment_in_progress',
    provider: 'phonepe',
    createdAt: new Date().toISOString(),
  });
  // No checkout in offline demo mode: the caller lands on the status route,
  // which keeps polling and never asserts success locally.
  return { orderId, paymentId, provider: 'phonepe', checkout: null, expiresAt: null };
}

function mapOrderDetail(payload) {
  const row = payload?.order ?? payload;
  return mapOrder(row);
}

// The payment detail read returns the client-safe status projection (§9.2):
// payment_in_progress | processing | confirmed | refund_in_progress |
// support_required | refunded | payment_failed. It is passed through verbatim —
// there is no browser-side mapping of gateway internals.
function mapPaymentDetail(payload) {
  const row = payload?.payment ?? payload;
  if (!row) return null;
  return {
    id: row.paymentId,
    orderId: row.orderId,
    amount: paiseToRupees(row.amountPaise),
    currency: row.currency,
    status: row.status,
    provider: row.provider ?? null,
    expiresAt: row.expiresAt ?? null,
    confirmedAt: row.confirmedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrder(orderId) {
  if (useHttpApi()) {
    return mapOrderDetail(await apiRequest(`/v1/client/orders/${encodeURIComponent(orderId)}`));
  }

  await delay(80);
  return clone(orders.find((o) => o.id === orderId) ?? null);
}

export async function listOrders({ filter = 'all' } = {}) {
  if (useHttpApi()) {
    // Owner-scoped history via an opaque keyset cursor; the coarse UI filter is
    // applied client-side over the page.
    const payload = await apiRequest('/v1/client/orders?limit=100');
    const mapped = listFromPayload(payload).map(mapOrder);
    return mapped.filter((order) => matchesOrderFilter(order, filter));
  }

  await delay();
  let out = orders;
  if (filter !== 'all') out = out.filter((order) => matchesOrderFilter(order, filter));
  return clone(out);
}

// The payments list carries the same client-safe fields as the detail read, so
// the screens can show a row and its detail sheet from one mapper.
function mapPaymentRow(row) {
  return {
    id: row.paymentId ?? row.id,
    orderId: row.orderId,
    fundId: row.fundId ?? null,
    amount: paiseToRupees(row.amountPaise),
    status: row.status,
    provider: row.provider ?? null,
    confirmedAt: row.confirmedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Repeatable canonical status params (spec §9.1) — never comma-packed values.
function paymentsQuery(statuses) {
  const params = new URLSearchParams();
  for (const status of statuses) params.append('status', status);
  params.set('limit', '100');
  return `/v1/client/payments?${params.toString()}`;
}

export async function listPendingPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest(paymentsQuery(['payment_in_progress']))).map(mapPaymentRow);
  }

  await delay();
  return clone(Array.from(payments.values()).filter((payment) => payment.status === 'payment_in_progress'));
}

export async function listFailedPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest(paymentsQuery(['payment_failed']))).map(mapPaymentRow);
  }

  await delay();
  return clone(Array.from(payments.values()).filter((payment) => payment.status === 'payment_failed'));
}

/** Payments received and being processed (the old "approval" queue). */
export async function listApprovalPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest(paymentsQuery(['processing']))).map(mapPaymentRow);
  }

  await delay();
  return clone(Array.from(payments.values()).filter((payment) => payment.status === 'processing'));
}

/**
 * Apply a plan control. Pause, resume and cancel act on the plan directly —
 * there is no approval queue in between, so the caller sees the new plan state
 * rather than a pending request.
 */
export async function requestSipControl({ orderId, requestType, requestedValue, effectiveDate, reason }) {
  if (useHttpApi()) {
    const action = { pause: pauseSip, resume: resumeSip, cancel: cancelSip }[requestType];
    if (!action) {
      throw new Error(`Unsupported plan control '${requestType}'. Pause, resume and cancel are available.`);
    }
    return action(orderId);
  }

  await delay(180);
  const req = {
    id: nextId('req', rId++),
    orderId, requestType, requestedValue, effectiveDate,
    status: 'pending',
    reason: reason || '',
    createdAt: new Date().toISOString(),
  };
  sipRequests.unshift(req);
  return clone(req);
}

export async function listSipControlRequests(orderId) {
  // Controls apply immediately, so there is nothing pending to list against a
  // live backend; the plan's own state is the record.
  if (useHttpApi()) return [];

  await delay();
  return clone(sipRequests.filter((r) => r.orderId === orderId));
}

export async function getPayment(paymentId) {
  if (useHttpApi()) {
    return mapPaymentDetail(await apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}`));
  }

  await delay(80);
  const found = payments.get(paymentId);
  if (found) return clone(found);
  return { id: paymentId, orderId: '', amount: null, status: 'payment_in_progress', provider: 'phonepe', createdAt: '' };
}
