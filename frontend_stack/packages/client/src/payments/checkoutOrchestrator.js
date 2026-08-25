import { buildPath } from '../navigation/routes.js';

const CHECKOUT_ERROR = "Couldn't start the payment. Try again.";
const MOBILE_CHECKOUT_DISABLED = 'MOBILE_CHECKOUT_DISABLED';

async function beginCheckout(beginPayment, orderId, checkoutChannel) {
  try {
    return { checkoutChannel, begun: await beginPayment(orderId, { checkoutChannel }) };
  } catch (error) {
    if (checkoutChannel !== 'phonepe_mobile_sdk' || error?.code !== MOBILE_CHECKOUT_DISABLED) throw error;
    return {
      checkoutChannel: 'hosted_redirect',
      begun: await beginPayment(orderId, { checkoutChannel: 'hosted_redirect' }),
    };
  }
}

export async function executeOrderCheckout({
  orderId,
  beginPayment,
  platform,
  navigate,
  redirect,
  persistPendingPayment,
}) {
  const resolvedChannel = await platform.resolveChannel();
  if (resolvedChannel !== 'hosted_redirect' && resolvedChannel !== 'phonepe_mobile_sdk') {
    throw new Error(CHECKOUT_ERROR);
  }
  const { checkoutChannel, begun } = await beginCheckout(beginPayment, orderId, resolvedChannel);
  const paymentId = begun?.paymentId;
  const checkout = begun?.checkout;

  if (!checkout) {
    if (!paymentId) throw new Error(CHECKOUT_ERROR);
    persistPendingPayment(paymentId);
    navigate(buildPath('payment_status', { paymentId }), { replace: true });
    return { leaving: false, paymentId };
  }

  const expectedType = checkoutChannel === 'phonepe_mobile_sdk' ? 'phonepe_sdk' : 'redirect';
  if (checkout.type !== expectedType) throw new Error(CHECKOUT_ERROR);
  if (paymentId) persistPendingPayment(paymentId);

  if (checkout.type === 'redirect') {
    if (!checkout.url || !redirect(checkout.url).ok) {
      if (!paymentId) throw new Error(CHECKOUT_ERROR);
      navigate(buildPath('payment_status', { paymentId }), { replace: true });
      return { leaving: false, paymentId };
    }
    return { leaving: true, paymentId };
  }

  if (!paymentId) throw new Error(CHECKOUT_ERROR);
  try {
    await platform.start({ checkout, paymentId });
  } finally {
    navigate(buildPath('payment_status', { paymentId }), { replace: true });
  }
  return { leaving: false, paymentId };
}
