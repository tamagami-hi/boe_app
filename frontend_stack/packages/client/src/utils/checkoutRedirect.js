import { DESTINATION_KIND, resolveDestination } from '../navigation/routes.js';

export function redirectToCheckout(url) {
  const destination = resolveDestination(url);
  if (destination.kind !== DESTINATION_KIND.EXTERNAL) {
    return { ok: false, reason: destination.reason || 'not-a-checkout-url' };
  }
  try {
    window.location.assign(destination.url);
    return { ok: true, url: destination.url };
  } catch {
    return { ok: false, reason: 'navigation-refused' };
  }
}
