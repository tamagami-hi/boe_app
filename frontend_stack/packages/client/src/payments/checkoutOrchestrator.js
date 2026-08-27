import { buildPath } from '../navigation/routes.js';

const CHECKOUT_ERROR = "Couldn't start the payment. Try again.";
export async function executeOrderCheckout({
  orderId,
  beginPayment,
  navigate,
  redirect,
  persistPendingPayment,
}) {
  const begun = await beginPayment(orderId, { checkoutChannel: 'hosted_redirect' });
  const paymentId = begun?.paymentId;
  const checkout = begun?.checkout;

  if (!checkout) {
    if (!paymentId) throw new Error(CHECKOUT_ERROR);
    if (!persistPendingPayment(paymentId)) throw new Error(CHECKOUT_ERROR);
    navigate(buildPath('payment_status', { paymentId }), { replace: true });
    return { leaving: false, paymentId };
  }

  if (checkout.type !== 'redirect') throw new Error(CHECKOUT_ERROR);
  if (paymentId && !persistPendingPayment(paymentId)) throw new Error(CHECKOUT_ERROR);

  if (!paymentId) throw new Error(CHECKOUT_ERROR);
  const opened = redirect(checkout.url);
  if (!opened?.ok) {
    navigate(buildPath('payment_status', { paymentId }), { replace: true });
    throw new Error(CHECKOUT_ERROR);
  }
  return { leaving: true, paymentId };
}
