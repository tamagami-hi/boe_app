// Razorpay checkout, loaded when a payment starts rather than on every boot.
//
// The script tag used to sit in index.html, so a third-party CDN request ran on every
// cold launch of both targets — including the admin console, which never takes a
// payment. It also meant a blocked or slow CDN was only discovered at the moment the
// user pressed Pay, and reported with `alert()`.

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const LOAD_TIMEOUT_MS = 15000;
const THEME_COLOR = '#B5894A';

let loader = null;

export function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const script = existing || document.createElement('script');
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      // A failed load is not cached: the next attempt should be able to retry.
      if (!ok) loader = null;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
    script.addEventListener('load', () => { clearTimeout(timer); finish(Boolean(window.Razorpay)); });
    script.addEventListener('error', () => { clearTimeout(timer); finish(false); });

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return loader;
}

/**
 * Opens checkout. Reports every failure through `onFailure` with a reason, so the
 * calling screen can show its own state and release its submit lock.
 */
export async function openRazorpayCheckout({
  keyId, orderId, amount, currency, name, description, userEmail, userContact,
  onSuccess, onFailure,
}) {
  if (!keyId) {
    onFailure?.({ reason: 'not_configured', description: 'This payment is not configured. Please contact support.' });
    return;
  }

  const ready = await loadRazorpay();
  if (!ready) {
    onFailure?.({
      reason: 'checkout_unavailable',
      description: 'The payment window could not be loaded. Check your connection and try again.',
    });
    return;
  }

  const options = {
    key: keyId,
    amount: Math.round(amount * 100),
    currency: currency || 'INR',
    name: name || 'BeOnEdge',
    description: description || 'Investment payment',
    order_id: orderId,
    handler: (response) => onSuccess?.(response),
    modal: { ondismiss: () => onFailure?.({ reason: 'dismissed' }) },
    prefill: { email: userEmail || '', contact: userContact || '' },
    theme: { color: THEME_COLOR },
  };

  const checkout = new window.Razorpay(options);
  checkout.on('payment.failed', (response) => onFailure?.(response.error));
  checkout.open();
}
