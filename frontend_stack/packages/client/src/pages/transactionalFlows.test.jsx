// The money screens. These tests are about what must NOT happen: no second order
// from a double tap, no completed transaction left one Back press away, no
// browser-side assertion of payment success (the PhonePe callback, not the
// browser, moves a payment), and no permanent skeleton on a screen the investor
// opened to find out whether their money moved.
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HOME_PATH, buildPath } from '../navigation/routes.js';

/* ---- collaborators --------------------------------------------------------- */

const FUND = { id: 'f1', name: 'Alpha Pool', tagline: 'Growth', minSip: 500, minLumpsum: 1000 };

const createSip = vi.fn();
const createLumpsum = vi.fn();
const beginOrderPayment = vi.fn();
const getPayment = vi.fn();
const getOrder = vi.fn();
const listSips = vi.fn();
const listOrders = vi.fn();
const requestSipControl = vi.fn();

vi.mock('../services/fundsApi.js', () => ({ getFund: async () => FUND }));
vi.mock('../services/ordersApi.js', () => ({
  createSip: (...a) => createSip(...a),
  createLumpsum: (...a) => createLumpsum(...a),
  beginOrderPayment: (...a) => beginOrderPayment(...a),
  getPayment: (...a) => getPayment(...a),
  getOrder: (...a) => getOrder(...a),
  listSips: (...a) => listSips(...a),
  listOrders: (...a) => listOrders(...a),
  requestSipControl: (...a) => requestSipControl(...a),
}));

// The PhonePe redirect is a seam: tests capture the URL instead of navigating.
const redirectToCheckout = vi.fn(() => ({ ok: true }));
vi.mock('../utils/checkoutRedirect.js', () => ({
  redirectToCheckout: (...a) => redirectToCheckout(...a),
}));

vi.mock('../hooks/useAppConfig.js', () => ({
  useAppConfig: () => ({
    publishedAt: '2026-01-01',
    mobile: {
      screens: {
        invest: {
          sip: {
            defaultAmount: 1000, defaultMonths: 12, defaultDebitDay: 5,
            minDurationMonths: 12,
            amountPresets: [500, 1000], durationMonths: [12, 24], debitDays: [1, 5],
            disclosures: {},
          },
          oneTime: { defaultAmount: 1000, amountPresets: [1000, 5000], paymentDisclosure: 'Secure PhonePe checkout.' },
        },
      },
    },
  }),
}));

vi.mock('../layout/AppBar.jsx', () => ({
  default: ({ title, onLeft }) => (
    <div>
      <span>{title}</span>
      {onLeft && <button type="button" onClick={onLeft}>Close</button>}
    </div>
  ),
}));

const { default: StartSipSheet } = await import('./StartSipSheet.jsx');
const { default: LumpsumSheet } = await import('./LumpsumSheet.jsx');
const { default: PaymentStatus } = await import('./PaymentStatus.jsx');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/** Renders `element` at `path`; every other path reports where we landed. */
function renderFlow(element, path, routePath) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const CHECKOUT = {
  orderId: 'ord_1',
  paymentId: 'pay_1',
  provider: 'phonepe',
  checkout: { type: 'redirect', url: 'https://checkout.phonepe.example/pay/abc' },
  expiresAt: '2026-08-18T12:00:00Z',
};

beforeEach(() => {
  redirectToCheckout.mockClear();
  createSip.mockReset().mockResolvedValue({ id: 'sip_1', status: 'active', amount: 1000, debitDay: 5 });
  createLumpsum.mockReset().mockResolvedValue({ id: 'ord_1', status: 'submitted', amount: 1000 });
  beginOrderPayment.mockReset().mockResolvedValue(CHECKOUT);
  getPayment.mockReset().mockResolvedValue({
    id: 'pay_1', orderId: 'ord_1', status: 'payment_in_progress', amount: 1000, currency: 'INR',
    provider: 'phonepe', createdAt: '2026-08-01T10:00:00Z',
  });
  getOrder.mockReset().mockResolvedValue({ id: 'ord_1', type: 'lump_sum' });
  listSips.mockReset().mockResolvedValue([]);
  listOrders.mockReset().mockResolvedValue([]);
  requestSipControl.mockReset().mockResolvedValue({});
});

afterEach(() => { vi.useRealTimers(); });

/* ---- SIP ------------------------------------------------------------------- */

describe('StartSipSheet (schedule/reminder SIP)', () => {
  async function reachReview() {
    renderFlow(<StartSipSheet />, '/app/invest/sip/f1', '/app/invest/sip/:fundId');
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /Risk disclosure/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /no automatic debit/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review SIP details' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /market risks/i }));
  }

  test('a double tap on Create SIP creates ONE plan', async () => {
    // A held-open promise reproduces the real window: `disabled` has not rendered
    // yet when the second tap lands.
    createSip.mockImplementation(() => new Promise(() => {}));
    await reachReview();
    const confirm = screen.getByRole('button', { name: /Create SIP/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(createSip).toHaveBeenCalledTimes(1);
  });

  test('a created plan REPLACES the flow on the plan detail, so Back cannot re-enter it', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Create SIP/ }));
    await settle();
    expect(screen.getByTestId('location')).toHaveTextContent(buildPath('mandate_detail', { mandateId: 'sip_1' }));
  });

  test('a failed create releases the lock so the user can retry', async () => {
    createSip.mockRejectedValueOnce(new Error('server unavailable'));
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Create SIP/ }));
    await settle();
    expect(screen.getByText('server unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create SIP/ }));
    await settle();
    expect(createSip).toHaveBeenCalledTimes(2);
  });

  test('there is no mandate or step-up UI: the SIP is a schedule paid per installment', async () => {
    renderFlow(<StartSipSheet />, '/app/invest/sip/f1', '/app/invest/sip/:fundId');
    await settle();
    expect(screen.queryByRole('button', { name: /Increase SIP every year/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/mandate cap/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/razorpay/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no automatic debit is set up/i)).toBeInTheDocument();
  });

  test('every chip declares type=button', async () => {
    const { container } = renderFlow(<StartSipSheet />, '/app/invest/sip/f1', '/app/invest/sip/:fundId');
    await settle();
    const chips = [...container.querySelectorAll('.apk-chip')];
    expect(chips.length).toBeGreaterThan(3);
    for (const chip of chips) expect(chip).toHaveAttribute('type', 'button');
  });
});

/* ---- Lumpsum --------------------------------------------------------------- */

describe('LumpsumSheet', () => {
  async function ready() {
    renderFlow(<LumpsumSheet />, '/app/invest/lumpsum/f1', '/app/invest/lumpsum/:fundId');
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /market risks/i }));
  }

  test('a double tap creates ONE order', async () => {
    createLumpsum.mockImplementation(() => new Promise(() => {}));
    await ready();
    const pay = screen.getByRole('button', { name: /Pay / });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(createLumpsum).toHaveBeenCalledTimes(1);
  });

  test('the amount input is labelled', async () => {
    await ready();
    expect(screen.getByLabelText('Amount').tagName).toBe('INPUT');
  });

  test('create order -> begin payment -> redirect to the PhonePe checkout URL', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Pay / }));
    await settle();
    expect(createLumpsum).toHaveBeenCalledTimes(1);
    expect(beginOrderPayment).toHaveBeenCalledWith('ord_1');
    expect(redirectToCheckout).toHaveBeenCalledWith('https://checkout.phonepe.example/pay/abc');
  });

  test('a begin-payment failure shows a neutral error and releases the lock', async () => {
    beginOrderPayment.mockRejectedValueOnce(new Error('checkout unavailable'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Pay / }));
    await settle();
    expect(screen.getByText('checkout unavailable')).toBeInTheDocument();
    expect(redirectToCheckout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Pay / }));
    await settle();
    expect(beginOrderPayment).toHaveBeenCalledTimes(2);
  });

  test('without a checkout URL the user lands on the status route — never a local success claim', async () => {
    beginOrderPayment.mockResolvedValue({ orderId: 'ord_1', paymentId: 'pay_9', checkout: null });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Pay / }));
    await settle();
    expect(screen.getByTestId('location')).toHaveTextContent(buildPath('payment_status', { paymentId: 'pay_9' }));
  });
});

/* ---- PaymentStatus --------------------------------------------------------- */

describe('PaymentStatus', () => {
  test('a failed read reports it instead of showing a skeleton forever', async () => {
    getPayment.mockRejectedValue(new Error('backend down'));
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load this payment');
  });

  test('provider success shows the neutral processing copy, never review/bank internals', async () => {
    getPayment.mockResolvedValue({
      id: 'pay_1', orderId: 'ord_1', status: 'processing', amount: 1000, createdAt: '2026-08-01T10:00:00Z',
    });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    expect(screen.getByText('Payment received — investment is being processed')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/bank|verification|review|approval|allocation|rejected/i);
  });

  test('a rejected/refunded payment shows only a neutral refund/support message', async () => {
    getPayment.mockResolvedValue({
      id: 'pay_1', orderId: 'ord_1', status: 'support_required', amount: 1000, createdAt: '2026-08-01T10:00:00Z',
    });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    expect(screen.getAllByText(/contact support/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/bank|verification|review|reject/i);
  });

  test('polling stops after the 90 seconds the screen promises', async () => {
    vi.useFakeTimers();
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    const callsAtWindowEnd = getPayment.mock.calls.length;
    expect(callsAtWindowEnd).toBeGreaterThan(10);

    // It used to poll every 2s forever on a payment that never settled.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(getPayment.mock.calls.length).toBe(callsAtWindowEnd);
    expect(screen.getByText(/We stopped checking after 90 seconds/)).toBeInTheDocument();
  });

  test('a terminal status stops the poll early', async () => {
    vi.useFakeTimers();
    getPayment.mockResolvedValue({ id: 'pay_1', orderId: 'ord_1', status: 'confirmed', amount: 1000, createdAt: '2026-08-01T10:00:00Z' });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    const calls = getPayment.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(getPayment.mock.calls.length).toBe(calls);
  });

  test('a failed payment offers a retry that begins a FRESH checkout', async () => {
    getPayment.mockResolvedValue({
      id: 'pay_1', orderId: 'ord_1', status: 'payment_failed', amount: 1000, createdAt: '2026-08-01T10:00:00Z',
    });
    beginOrderPayment.mockResolvedValue({ ...CHECKOUT, paymentId: 'pay_2' });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await settle();
    expect(beginOrderPayment).toHaveBeenCalledWith('ord_1');
    expect(redirectToCheckout).toHaveBeenCalledWith(CHECKOUT.checkout.url);
  });

  test('every exit replaces the completed payment in history', async () => {
    getPayment.mockResolvedValue({
      id: 'pay_1', orderId: 'ord_1', status: 'confirmed', amount: 1000, createdAt: '2026-08-01T10:00:00Z',
    });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_PATH);
  });
});
