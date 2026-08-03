import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

// Canonical order states (spec 03 §2.1) grouped for the UI's coarse filter.
const ACTIVE_ORDER_STATES = new Set(['submitted', 'payment_pending', 'payment_confirmed', 'booked']);
const CANCELLED_ORDER_STATES = new Set(['cancelled', 'rejected', 'refunded', 'reversed']);

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Map a canonical GET /v1/client/orders item to the UI order shape. Money is
// integer paise (string) on the wire and rupees in the UI.
function mapOrder(item) {
  return {
    id: item.orderId,
    fundId: item.fundId,
    sipPlanId: item.sipPlanId,
    type: item.type,
    status: item.status,
    amount: item.amountPaise === null || item.amountPaise === undefined ? null : Number(item.amountPaise) / 100,
    requestedUnits: item.requestedUnits === null ? null : Number(item.requestedUnits),
    currency: item.currency,
    requestedAt: item.requestedAt,
    bookedAt: item.bookedAt,
    cancelledAt: item.cancelledAt,
    failureCode: item.failureCode,
    createdAt: item.createdAt,
    source: 'canonical',
  };
}

function matchesOrderFilter(order, filter) {
  if (filter === 'active') return ACTIVE_ORDER_STATES.has(order.status);
  if (filter === 'cancelled') return CANCELLED_ORDER_STATES.has(order.status);
  if (filter === 'paused') return false; // SIP pause lives on sip_plans, not orders
  return true;
}

let orders = [];
let mandates = [];
let pendingPayments = [];
let sipRequests = [];
const payments = new Map();

let oId = 1;
let pId = 1;
let mId = 1;
let rId = 1;

function nextId(prefix, n) { return `${prefix}_${String(n).padStart(3, '0')}`; }

// Map a canonical SIP (POST /v1/client/sips) to the UI shape. Money is paise on
// the wire and rupees in the UI.
function mapSip(sip) {
  return {
    id: sip.sipId,
    type: 'sip',
    status: sip.status,
    fundId: sip.fundId,
    amount: sip.amountPaise === null || sip.amountPaise === undefined ? null : Number(sip.amountPaise) / 100,
    debitDay: sip.debitDay,
    durationMonths: sip.durationMonths ?? null,
    mandateId: sip.mandateId ?? null,
    mandateStatus: sip.mandateStatus ?? null,
    nextDueDate: sip.nextDueDate ?? null,
    source: 'canonical',
  };
}

export async function createSip({ fundId, amount, frequency = 'monthly', durationMonths, debitDay, stepUp, consentTextVersion, consentedAt }) {
  if (useHttpApi()) {
    // Canonical: POST /v1/client/sips creates a draft SIP. The client then
    // requests the debit mandate (requestSipMandate); the mandate is activated
    // by the signed provider webhook, after which the scheduler generates
    // installment orders that flow through the payment/booking pipeline.
    const created = await apiRequest('/v1/client/sips', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
      body: {
        fundId,
        amountPaise: Math.round(amount * 100),
        debitDay: debitDay ?? 1,
        ...(durationMonths ? { durationMonths } : {}),
      },
    });
    return mapSip(created);
  }
  void frequency;
  void stepUp;
  void consentTextVersion;
  void consentedAt;

  await delay(180);
  const orderId = nextId('ord_sip', oId++);
  const paymentId = nextId('pay', pId++);
  const mandateId = nextId('mnd', mId++);
  const providerOrderId = nextId('rzp_order', oId++);
  const order = {
    id: orderId,
    type: 'sip',
    fundId,
    amount,
    durationMonths,
    debitDay,
    createdAt: new Date().toISOString(),
    status: 'pending_first_payment',
    paymentId,
    mandateId,
    stepUp: stepUp || null,
    nextDueDate: '',
    consentTextVersion: consentTextVersion || '',
    consentedAt: consentedAt || '',
    source: 'mock',
    asOf: new Date().toISOString(),
    providerOrderId,
    providerKeyId: 'rzp_test_mock',
    providerName: 'mock',
    currency: 'INR',
  };
  orders.unshift(order);
  payments.set(paymentId, {
    id: paymentId, orderId, amount, status: 'created', method: 'upi',
    createdAt: new Date().toISOString(), upiHandle: '',
    providerOrderId,
    providerKeyId: 'rzp_test_mock',
    provider: 'mock',
    currency: 'INR',
  });
  mandates.push({
    id: mandateId, orderId, fundId, maxAmount: amount ?? null,
    bank: '', upiHandle: '', status: 'setup_required',
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: '',
  });
  return clone(order);
}

/** The investor's SIP plans. */
export async function listSips() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/sips')).map(mapSip);
  }

  await delay();
  return clone(orders.filter((order) => order.type === 'sip'));
}

/** Request the debit mandate for a draft SIP (spec 03 §5.2). Returns { mandateId, status }. */
export async function requestSipMandate(sipId) {
  if (useHttpApi()) {
    const sip = await apiRequest(`/v1/client/sips/${encodeURIComponent(sipId)}/mandate`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    });
    return mapSip(sip);
  }
  await delay(160);
  return { id: sipId, status: 'pending_mandate', mandateId: null };
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
    // Canonical: POST /v1/client/orders creates a one-time purchase order in
    // `submitted`. Money is integer paise on the wire; the UI works in rupees.
    const created = await apiRequest('/v1/client/orders', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
      body: { fundId, amountPaise: Math.round(amount * 100) },
    });
    return mapOrder(created);
  }

  await delay(180);
  const orderId = nextId('ord_lump', oId++);
  const paymentId = nextId('pay', pId++);
  const providerOrderId = nextId('rzp_order', oId++);
  const order = {
    id: orderId, type: 'lumpsum', fundId, amount,
    createdAt: new Date().toISOString(),
    status: 'pending_first_payment',
    paymentId, nextDueDate: '',
    source: 'mock',
    asOf: new Date().toISOString(),
    providerOrderId,
    providerKeyId: 'rzp_test_mock',
    providerName: 'mock',
    currency: 'INR',
  };
  orders.unshift(order);
  payments.set(paymentId, {
    id: paymentId, orderId, amount, status: 'created', method: 'upi',
    createdAt: new Date().toISOString(), upiHandle: '',
    providerOrderId,
    providerKeyId: 'rzp_test_mock',
    provider: 'mock',
    currency: 'INR',
  });
  return clone(order);
}

/**
 * Begin payment for a submitted order (spec 03 §5.2 `beginPayment`). Moves the
 * order to `payment_pending` and returns the payment/attempt identifiers; the
 * provider call itself is driven by the backend worker.
 */
export async function beginOrderPayment(orderId) {
  if (useHttpApi()) {
    return apiRequest(`/v1/client/orders/${encodeURIComponent(orderId)}/pay`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    });
  }

  await delay(160);
  const found = payments.get(orders.find((o) => o.id === orderId)?.paymentId);
  return clone(found ?? { orderId, status: 'payment_pending' });
}

// The canonical detail endpoints wrap their row (`{ order }` / `{ payment }`) and
// report money in paise as strings. The screens were written against a legacy
// rupee-denominated shape, so translate once here.
function mapOrderDetail(payload) {
  const row = payload?.order ?? payload;
  if (!row) return null;
  return {
    ...mapOrder(row),
    id: row.orderId,
    fundId: row.fundId,
    status: row.status,
    amount: row.amountPaise === null || row.amountPaise === undefined ? null : Number(row.amountPaise) / 100,
  };
}

// `succeeded` is the canonical terminal success state; the status screen keys off
// the legacy `success`. Failure/expiry map straight through.
const PAYMENT_STATUS_WIRE = {
  created: 'created',
  provider_pending: 'pending',
  succeeded: 'success',
  failed: 'failed',
  expired: 'expired',
  refunded: 'refunded',
};

function mapPaymentDetail(payload) {
  const row = payload?.payment ?? payload;
  if (!row) return null;
  return {
    id: row.paymentId,
    orderId: row.orderId,
    fundId: row.fundId,
    amount: Number(row.amountPaise) / 100,
    currency: row.currency,
    status: PAYMENT_STATUS_WIRE[row.status] || row.status,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    // No gateway key is ever returned to the client, so the SDK launch path stays
    // disabled until a real gateway is configured server-side.
    providerKeyId: null,
    failureReason: row.failureCode,
    expiresAt: row.expiresAt,
    confirmedAt: row.succeededAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrder(orderId) {
  if (useHttpApi()) {
    return mapOrderDetail(await apiRequest(`/v1/client/orders/${encodeURIComponent(orderId)}`));
  }

  await delay(80);
  return clone(orders.find((o) => o.id === orderId));
}

export async function listOrders({ filter = 'all' } = {}) {
  if (useHttpApi()) {
    // The canonical endpoint returns the full owner-scoped history via an opaque
    // keyset cursor; the coarse UI filter is applied client-side over the page.
    const payload = await apiRequest('/v1/client/orders?limit=100');
    const mapped = listFromPayload(payload).map(mapOrder);
    return mapped.filter((order) => matchesOrderFilter(order, filter));
  }

  await delay();
  let out = orders;
  if (filter === 'active') out = out.filter((o) => o.status === 'active' || o.status === 'pending_first_payment');
  if (filter === 'paused') out = out.filter((o) => o.status === 'paused');
  if (filter === 'cancelled') out = out.filter((o) => o.status === 'cancelled' || o.status === 'closed');
  return clone(out);
}

// The payments list carries the same fields as the detail read, so the screens can
// show a row and its detail sheet from one mapper.
function mapPaymentRow(row) {
  return {
    id: row.id,
    orderId: row.orderId,
    fundId: row.fundId ?? null,
    amount: row.amountPaise === null || row.amountPaise === undefined ? null : Number(row.amountPaise) / 100,
    status: row.status,
    provider: row.provider ?? null,
    method: row.provider ?? '',
    failureCode: row.failureCode ?? null,
    confirmedAt: row.succeededAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPendingPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=pending')).map(mapPaymentRow);
  }

  await delay();
  const pendingStatuses = new Set(['created', 'gateway_initiated', 'pending']);
  const fromPayments = Array.from(payments.values()).filter((payment) => pendingStatuses.has(payment.status));
  return clone([...pendingPayments, ...fromPayments]);
}

export async function listFailedPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=failed,expired')).map(mapPaymentRow);
  }

  await delay();
  const failedStatuses = new Set(['failed', 'expired', 'rejected']);
  return clone(Array.from(payments.values()).filter((payment) => failedStatuses.has(payment.status)));
}

export async function listApprovalPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=succeeded')).map(mapPaymentRow);
  }

  await delay();
  const approvalStatuses = new Set(['success', 'confirmed', 'reconciled']);
  return clone(Array.from(payments.values()).filter((payment) => approvalStatuses.has(payment.status)));
}

/**
 * Apply a plan control. Pause, resume and cancel act on the plan directly — there
 * is no approval queue in between, so the caller sees the new plan state rather
 * than a pending request.
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
  return { id: paymentId, orderId: '', amount: null, status: 'pending', method: '', createdAt: '' };
}

/**
 * Confirm a gateway checkout. A live gateway confirms server-side on its signed
 * webhook, and the mock provider is settled by the payment worker — in both cases
 * the client's job is to read the resulting state, not to assert it. So against a
 * real backend this reads the payment back instead of posting a confirmation.
 */
export async function confirmRazorpayPayment(paymentId) {
  if (useHttpApi()) {
    return mapPaymentDetail(await apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}`));
  }

  const found = payments.get(paymentId);
  if (found) {
    found.status = 'success';
    found.confirmedAt = new Date().toISOString();
  }
  return clone(found);
}

// Simulates a full lifecycle: created -> gateway_initiated -> pending -> success.
const _pollState = new Map();
export async function pollPaymentStatus(paymentId) {
  if (useHttpApi()) {
    return mapPaymentDetail(await apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}`));
  }

  await delay(800);
  const p = payments.get(paymentId);
  if (!p) return { id: paymentId, status: 'pending', amount: null, method: '', orderId: '', createdAt: '' };
  const tick = (_pollState.get(paymentId) || 0) + 1;
  _pollState.set(paymentId, tick);
  const path = ['gateway_initiated', 'pending', 'pending', 'success'];
  p.status = path[Math.min(tick - 1, path.length - 1)];
  if (p.status === 'success') p.confirmedAt = new Date().toISOString();
  return clone(p);
}

export async function getMandate(mandateId) {
  if (useHttpApi()) return apiRequest(`/v1/client/mandates/${encodeURIComponent(mandateId)}`);

  await delay(80);
  return clone(mandates.find((m) => m.id === mandateId));
}

export async function authorizeMandate(mandateId) {
  if (useHttpApi()) {
    return apiRequest(`/v1/client/mandates/${encodeURIComponent(mandateId)}/authorize`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey() },
    });
  }

  await delay(900);
  const m = mandates.find((x) => x.id === mandateId);
  if (m) m.status = 'active';
  // Also flip the linked order to active.
  if (m) {
    const ord = orders.find((o) => o.mandateId === mandateId);
    if (ord) ord.status = 'active';
  }
  return clone(m);
}
