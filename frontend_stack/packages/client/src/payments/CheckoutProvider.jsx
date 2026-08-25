import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { redirectToCheckout } from '../utils/checkoutRedirect.js';
import { buildPath } from '../navigation/routes.js';
import { executeOrderCheckout } from './checkoutOrchestrator.js';
import {
  clearPendingPayment,
  persistPendingPayment,
  readPendingPayment,
  shouldClearPendingPaymentForSession,
} from './pendingPayment.js';
import { clearPendingAutoPaySetup, readPendingAutoPaySetup } from './pendingAutoPaySetup.js';

const browserPlatform = Object.freeze({
  resolveChannel: async () => 'hosted_redirect',
  start: async () => ({ status: 'unavailable' }),
});

const CheckoutContext = createContext(browserPlatform);

export function CheckoutProvider({ platform = browserPlatform, children }) {
  return <CheckoutContext.Provider value={platform}>{children}</CheckoutContext.Provider>;
}

export function useCheckoutPlatform() {
  return useContext(CheckoutContext);
}

export function useOrderCheckout() {
  const navigate = useNavigate();
  const platform = useContext(CheckoutContext);
  const { user } = useSession();
  const persistForPrincipal = useCallback(
    (paymentId) => persistPendingPayment(paymentId, user?.id),
    [user?.id],
  );
  return useCallback((orderId) => executeOrderCheckout({
    orderId,
    beginPayment: ordersApi.beginOrderPayment,
    platform,
    navigate,
    redirect: redirectToCheckout,
    persistPendingPayment: persistForPrincipal,
  }), [navigate, persistForPrincipal, platform]);
}

export function PendingPaymentRecovery() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, user, error, endedReason } = useSession();
  const recoveredOwnerId = useRef(null);

  useEffect(() => {
    if (shouldClearPendingPaymentForSession({ status, error, endedReason })) {
      clearPendingPayment();
      clearPendingAutoPaySetup();
      recoveredOwnerId.current = null;
      return;
    }
    if (status !== 'authenticated' || !user?.id || recoveredOwnerId.current === user.id) return;
    recoveredOwnerId.current = user.id;
    const pendingAutoPay = readPendingAutoPaySetup(user.id);
    if (pendingAutoPay?.sipPlanId) {
      clearPendingAutoPaySetup();
      const mandatePath = buildPath('mandate_detail', { mandateId: pendingAutoPay.sipPlanId });
      if (location.pathname !== mandatePath) navigate(mandatePath, { replace: true });
      return;
    }
    const paymentId = readPendingPayment(user.id);
    if (location.pathname.startsWith('/app/payment/')) return;
    if (paymentId) navigate(buildPath('payment_status', { paymentId }), { replace: true });
  }, [endedReason, error, location.pathname, navigate, status, user?.id]);

  return null;
}
