import { apiRequest, clone, delay, listFromPayload, useHttpApi } from './_util.js';

// Canonical order states (spec 03 §2.1) grouped for the UI's coarse filter.
const ACTIVE_ORDER_STATES = new Set(['submitted', 'payment_pending', 'payment_confirmed', 'booked']);
const CANCELLED_ORDER_STATES = new Set(['cancelled', 'rejected', 'refunded', 'reversed']);

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

export async function createSip({ fundId, amount, frequency = 'monthly', durationMonths, debitDay, stepUp, consentTextVersion, consentedAt }) {
  if (useHttpApi()) {
    return apiRequest('/v1/client/sips', {
      method: 'POST',
      body: { fundId, amount, frequency, durationMonths, debitDay, stepUp, consentTextVersion, consentedAt },
    });
  }

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

export async function createLumpsum({ fundId, amount }) {
  if (useHttpApi()) {
    return apiRequest('/v1/client/lumpsum-orders', {
      method: 'POST',
      body: { fundId, amount },
    });
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

export async function getOrder(orderId) {
  if (useHttpApi()) return apiRequest(`/v1/client/orders/${encodeURIComponent(orderId)}`);

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

export async function listPendingPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=created,gateway_initiated,pending'));
  }

  await delay();
  const pendingStatuses = new Set(['created', 'gateway_initiated', 'pending']);
  const fromPayments = Array.from(payments.values()).filter((payment) => pendingStatuses.has(payment.status));
  return clone([...pendingPayments, ...fromPayments]);
}

export async function listFailedPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=failed,expired,rejected'));
  }

  await delay();
  const failedStatuses = new Set(['failed', 'expired', 'rejected']);
  return clone(Array.from(payments.values()).filter((payment) => failedStatuses.has(payment.status)));
}

export async function listApprovalPayments() {
  if (useHttpApi()) {
    return listFromPayload(await apiRequest('/v1/client/payments?status=success,confirmed,reconciled'));
  }

  await delay();
  const approvalStatuses = new Set(['success', 'confirmed', 'reconciled']);
  return clone(Array.from(payments.values()).filter((payment) => approvalStatuses.has(payment.status)));
}

export async function requestSipControl({ orderId, requestType, requestedValue, effectiveDate, reason }) {
  if (useHttpApi()) {
    return apiRequest('/v1/client/sip-control-requests', {
      method: 'POST',
      body: { planId: orderId, action: requestType, requestedValue, effectiveDate, reason },
    });
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
  if (useHttpApi()) {
    return listFromPayload(await apiRequest(`/v1/client/sip-control-requests?orderId=${encodeURIComponent(orderId)}`));
  }

  await delay();
  return clone(sipRequests.filter((r) => r.orderId === orderId));
}

export async function getPayment(paymentId) {
  if (useHttpApi()) return apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}`);

  await delay(80);
  const found = payments.get(paymentId);
  if (found) return clone(found);
  return { id: paymentId, orderId: '', amount: null, status: 'pending', method: '', createdAt: '' };
}

export async function confirmRazorpayPayment(paymentId, response) {
  if (useHttpApi()) {
    return apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}/confirm-razorpay`, {
      method: 'POST',
      body: {
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
      },
    });
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
  if (useHttpApi()) return apiRequest(`/v1/client/payments/${encodeURIComponent(paymentId)}`);

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
