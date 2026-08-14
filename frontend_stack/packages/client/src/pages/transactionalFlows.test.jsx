// The money screens. These tests are about what must NOT happen: no second order
// from a double tap, no completed transaction left one Back press away, no silent
// failure after a gateway has taken a payment, and no permanent skeleton on a
// screen the investor opened to find out whether their money moved.
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HOME_PATH, buildPath } from '../navigation/routes.js';

/* ---- collaborators --------------------------------------------------------- */

const FUND = { id: 'f1', name: 'Alpha Pool', tagline: 'Growth', minSip: 500, minLumpsum: 1000 };

const createSip = vi.fn();
const createLumpsum = vi.fn();
const confirmRazorpayPayment = vi.fn();
const getPayment = vi.fn();
const getOrder = vi.fn();
const pollPaymentStatus = vi.fn();
const getMandate = vi.fn();
const authorizeMandate = vi.fn();

vi.mock('../services/fundsApi.js', () => ({ getFund: async () => FUND }));
vi.mock('../services/ordersApi.js', () => ({
  createSip: (...a) => createSip(...a),
  createLumpsum: (...a) => createLumpsum(...a),
  confirmRazorpayPayment: (...a) => confirmRazorpayPayment(...a),
  getPayment: (...a) => getPayment(...a),
  getOrder: (...a) => getOrder(...a),
  pollPaymentStatus: (...a) => pollPaymentStatus(...a),
  getMandate: (...a) => getMandate(...a),
  authorizeMandate: (...a) => authorizeMandate(...a),
}));

// Captures the checkout options so a test can drive onSuccess/onFailure itself.
let checkout = null;
const openRazorpayCheckout = vi.fn((options) => { checkout = options; });
vi.mock('../utils/razorpay.js', () => ({
  openRazorpayCheckout: (...a) => openRazorpayCheckout(...a),
}));

vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => ({ user: { id: 'u1', email: 'ada@example.com' }, status: 'authenticated' }),
}));

vi.mock('../hooks/useAppConfig.js', () => ({
  useAppConfig: () => ({
    publishedAt: '2026-01-01',
    mobile: {
      screens: {
        invest: {
          sip: {
            defaultAmount: 1000, defaultMonths: 12, defaultDebitDay: 5, defaultStepUpPct: 10,
            stepUpEnabled: true, minDurationMonths: 12,
            amountPresets: [500, 1000], durationMonths: [12, 24], debitDays: [1, 5],
            stepUpPercents: [5, 10], disclosures: {},
          },
          oneTime: { defaultAmount: 1000, amountPresets: [1000, 5000], paymentDisclosure: 'Razorpay next.' },
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
const { default: MandateAuth } = await import('./MandateAuth.jsx');

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

beforeEach(() => {
  checkout = null;
  openRazorpayCheckout.mockClear();
  createSip.mockReset().mockResolvedValue({ paymentId: 'pay_1', amount: 1000, currency: 'INR' });
  createLumpsum.mockReset().mockResolvedValue({ paymentId: 'pay_2', amount: 1000, currency: 'INR' });
  confirmRazorpayPayment.mockReset().mockResolvedValue({});
  getPayment.mockReset().mockResolvedValue({
    id: 'pay_1', status: 'created', amount: 1000, currency: 'INR', provider: 'razorpay',
    providerPaymentId: 'rzp_1', providerOrderId: 'order_1', providerKeyId: 'key_1',
    createdAt: '2026-08-01T10:00:00Z',
  });
  getOrder.mockReset().mockResolvedValue({ id: 'ord_1', type: 'sip', fundName: 'Alpha Pool' });
  pollPaymentStatus.mockReset().mockResolvedValue({ id: 'pay_1', status: 'created', amount: 1000, createdAt: '2026-08-01T10:00:00Z' });
  getMandate.mockReset().mockResolvedValue({
    id: 'm1', provider: 'mock', status: 'pending_authorization', maxAmount: 1500, validTo: '2027-08-01',
  });
  authorizeMandate.mockReset().mockResolvedValue({ id: 'm1', provider: 'mock', status: 'active', maxAmount: 1500 });
});

afterEach(() => { vi.useRealTimers(); });

/* ---- SIP ------------------------------------------------------------------- */

describe('StartSipSheet cannot create two plans', () => {
  async function reachReview() {
    renderFlow(<StartSipSheet />, '/app/invest/sip/f1', '/app/invest/sip/:fundId');
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /Risk disclosure/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /UPI AutoPay mandate/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Review SIP details' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /market risks/i }));
  }

  test('a double tap on Confirm creates ONE SIP', async () => {
    // A held-open promise reproduces the real window: `disabled` has not rendered
    // yet when the second tap lands.
    createSip.mockImplementation(() => new Promise(() => {}));
    await reachReview();
    const confirm = screen.getByRole('button', { name: /Continue to Razorpay/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(createSip).toHaveBeenCalledTimes(1);
  });

  test('a successful payment REPLACES the flow, so Back cannot re-enter it', async () => {
    createSip.mockResolvedValue({
      paymentId: 'pay_1', amount: 1000, currency: 'INR',
      providerName: 'razorpay', providerOrderId: 'order_1', providerKeyId: 'key_1',
    });
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Razorpay/ }));
    await settle();
    expect(openRazorpayCheckout).toHaveBeenCalledTimes(1);

    await act(async () => { await checkout.onSuccess({ razorpay_payment_id: 'p' }); });
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_PATH);
  });

  test('a confirmation that fails after payment does NOT claim success', async () => {
    createSip.mockResolvedValue({
      paymentId: 'pay_1', amount: 1000, currency: 'INR',
      providerName: 'razorpay', providerOrderId: 'order_1', providerKeyId: 'key_1',
    });
    // The gateway took the money; our confirm call did not land.
    confirmRazorpayPayment.mockRejectedValue(new Error('confirm failed'));
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Razorpay/ }));
    await settle();
    await act(async () => { await checkout.onSuccess({ razorpay_payment_id: 'p' }); });
    // Sent to the authoritative payment state, not Home and not left stranded.
    expect(screen.getByTestId('location')).toHaveTextContent(buildPath('payment_status', { paymentId: 'pay_1' }));
  });

  test('dismissing the gateway lands on the payment, not a dead review screen', async () => {
    createSip.mockResolvedValue({
      paymentId: 'pay_1', amount: 1000, currency: 'INR',
      providerName: 'razorpay', providerOrderId: 'order_1', providerKeyId: 'key_1',
    });
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Razorpay/ }));
    await settle();
    await act(async () => { checkout.onFailure({ reason: 'dismissed' }); });
    expect(screen.getByTestId('location')).toHaveTextContent(buildPath('payment_status', { paymentId: 'pay_1' }));
  });

  test('a failed create releases the lock so the user can retry', async () => {
    createSip.mockRejectedValueOnce(new Error('gateway down'));
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Razorpay/ }));
    await settle();
    expect(screen.getByText('gateway down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Razorpay/ }));
    await settle();
    expect(createSip).toHaveBeenCalledTimes(2);
  });

  test('the step-up switch is a real button with a pressed state', async () => {
    renderFlow(<StartSipSheet />, '/app/invest/sip/f1', '/app/invest/sip/:fundId');
    await settle();
    const toggle = screen.getByRole('button', { name: /Increase SIP every year/ });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
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

  test('a confirmation failure routes to the payment state', async () => {
    createLumpsum.mockResolvedValue({
      paymentId: 'pay_2', amount: 1000, currency: 'INR',
      providerName: 'razorpay', providerOrderId: 'o', providerKeyId: 'k',
    });
    confirmRazorpayPayment.mockRejectedValue(new Error('nope'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Pay / }));
    await settle();
    await act(async () => { await checkout.onSuccess({}); });
    expect(screen.getByTestId('location')).toHaveTextContent(buildPath('payment_status', { paymentId: 'pay_2' }));
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

  test('a double tap opens ONE checkout', async () => {
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    const pay = screen.getByRole('button', { name: /Pay with Razorpay/ });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(openRazorpayCheckout).toHaveBeenCalledTimes(1);
  });

  test('dismissing the gateway releases the lock', async () => {
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Pay with Razorpay/ }));
    await act(async () => { checkout.onFailure({ reason: 'dismissed' }); });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Pay with Razorpay/ }));
    expect(openRazorpayCheckout).toHaveBeenCalledTimes(2);
  });

  test('polling stops after the 90 seconds the screen promises', async () => {
    vi.useFakeTimers();
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    const callsAtWindowEnd = pollPaymentStatus.mock.calls.length;
    expect(callsAtWindowEnd).toBeGreaterThan(10);

    // It used to poll every 2s forever on a payment that never settled.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(pollPaymentStatus.mock.calls.length).toBe(callsAtWindowEnd);
    expect(screen.getByText(/We stopped checking after 90 seconds/)).toBeInTheDocument();
  });

  test('a terminal status stops the poll early', async () => {
    vi.useFakeTimers();
    pollPaymentStatus.mockResolvedValue({ id: 'pay_1', status: 'approved', amount: 1000, createdAt: '2026-08-01T10:00:00Z' });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    const calls = pollPaymentStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(pollPaymentStatus.mock.calls.length).toBe(calls);
  });

  test('every exit replaces the completed payment in history', async () => {
    getPayment.mockResolvedValue({
      id: 'pay_1', status: 'approved', amount: 1000, provider: 'razorpay', createdAt: '2026-08-01T10:00:00Z',
    });
    renderFlow(<PaymentStatus />, '/app/payment/pay_1', '/app/payment/:paymentId');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_PATH);
  });
});

/* ---- MandateAuth ---------------------------------------------------------- */

describe('MandateAuth', () => {
  test('a failed read reports it instead of a permanent skeleton', async () => {
    getMandate.mockRejectedValue(new Error('down'));
    renderFlow(<MandateAuth />, '/app/mandates/m1/authorize', '/app/mandates/:mandateId/authorize');
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load this mandate');
  });

  test('a double tap authorises ONCE', async () => {
    authorizeMandate.mockImplementation(() => new Promise(() => {}));
    renderFlow(<MandateAuth />, '/app/mandates/m1/authorize', '/app/mandates/:mandateId/authorize');
    await settle();
    const confirm = screen.getByRole('button', { name: /completed authorization/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(authorizeMandate).toHaveBeenCalledTimes(1);
  });

  test('a failure says so and lets the user retry', async () => {
    authorizeMandate.mockRejectedValueOnce(new Error('provider refused'));
    renderFlow(<MandateAuth />, '/app/mandates/m1/authorize', '/app/mandates/:mandateId/authorize');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /completed authorization/ }));
    await settle();
    // It used to leave the button stuck on "Verifying…" with nothing said.
    expect(screen.getByRole('alert')).toHaveTextContent('provider refused');
    fireEvent.click(screen.getByRole('button', { name: /completed authorization/ }));
    await settle();
    expect(authorizeMandate).toHaveBeenCalledTimes(2);
  });

  test('authorisation hands off to Home with replace', async () => {
    vi.useFakeTimers();
    renderFlow(<MandateAuth />, '/app/mandates/m1/authorize', '/app/mandates/:mandateId/authorize');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /completed authorization/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_PATH);
  });

  test('the mock "Open UPI app" button does not claim to have copied anything', async () => {
    renderFlow(<MandateAuth />, '/app/mandates/m1/authorize', '/app/mandates/:mandateId/authorize');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Open UPI app' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/simulated mandate/);
    expect(status).not.toHaveTextContent(/copied/);
  });
});
