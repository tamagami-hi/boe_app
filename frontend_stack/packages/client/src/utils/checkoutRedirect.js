import { DESTINATION_KIND, resolveDestination } from '../navigation/routes.js';

/**
 * Redirect the browser to a PhonePe hosted checkout URL.
 *
 * The URL comes from `POST /v1/client/orders/:orderId/pay`. It is validated
 * through the same trust boundary as every other remote destination — only a
 * classified external HTTPS URL is ever navigated to, so a malformed or hostile
 * payload cannot become a `javascript:` navigation.
 *
 * The redirect is UX only: it never confirms a payment. PhonePe's return URL
 * re-opens the in-app payment status route, which polls the backend for the
 * authoritative state (spec §7).
 */
export function redirectToCheckout(url) {
  const destination = resolveDestination(url);
  if (destination.kind !== DESTINATION_KIND.EXTERNAL) {
    return { ok: false, reason: destination.reason || 'not-a-checkout-url' };
  }
  try {
    window.location.assign(destination.url);
    return { ok: true, url: destination.url };
  } catch {
    // jsdom and locked-down WebViews can refuse navigation; the caller falls
    // back to the payment status route, which is the honest destination anyway.
    return { ok: false, reason: 'navigation-refused' };
  }
}
