import { Capacitor } from '@capacitor/core';

const SDK_PLUGIN_NAME = 'PhonePePaymentSDK';
const SDK_ENVIRONMENTS = new Set(['SANDBOX', 'PRODUCTION']);
const SDK_RESULT_STATUSES = new Set(['SUCCESS', 'FAILURE', 'INTERRUPTED']);
const CONFIGURATION_ERROR = 'Mobile checkout configuration is unavailable.';
const SDK_ERROR = 'Mobile checkout is unavailable. Check your payment status and try again if needed.';
const MIN_CHECKOUT_LIFETIME_MS = 30000;

const loadPhonePePlugin = async () => {
  const module = await import('ionic-capacitor-phonepe-pg');
  return { plugin: module.PhonePePaymentPlugin };
};

const unwrapPlugin = (loaded) => (loaded && typeof loaded === 'object' && 'plugin' in loaded ? loaded.plugin : loaded);

const validateText = (value) =>
  typeof value === 'string' && value.trim().length > 0 && value === value.trim();

const flowIdFor = (value) => {
  const flowId = String(value || '').replace(/[^a-zA-Z0-9]/gu, '');
  if (!flowId) throw new Error(CONFIGURATION_ERROR);
  return flowId;
};

const validateCheckout = (checkout, now) => {
  const expiresAt = Date.parse(checkout?.expiresAt);
  if (
    checkout?.type !== 'phonepe_sdk' ||
    !SDK_ENVIRONMENTS.has(checkout.environment) ||
    !validateText(checkout.providerOrderId) ||
    !validateText(checkout.token) ||
    !validateText(checkout.merchantId) ||
    !Number.isFinite(expiresAt) ||
    expiresAt - now() < MIN_CHECKOUT_LIFETIME_MS
  ) throw new Error(CONFIGURATION_ERROR);
};

export function createPhonePeMobileCheckout({
  isNativePlatform,
  isPluginAvailable,
  loadPlugin,
  generateFlowId,
  now = () => Date.now(),
}) {
  let initializedConfiguration = null;

  const resolveChannel = async () => {
    if (!isNativePlatform() || !isPluginAvailable(SDK_PLUGIN_NAME)) throw new Error(CONFIGURATION_ERROR);
    try {
      const plugin = unwrapPlugin(await loadPlugin());
      if (!plugin) throw new Error(CONFIGURATION_ERROR);
      return 'phonepe_mobile_sdk';
    } catch {
      throw new Error(CONFIGURATION_ERROR);
    }
  };

  const start = async ({ checkout }) => {
    validateCheckout(checkout, now);
    try {
      const plugin = unwrapPlugin(await loadPlugin());
      const configuration = `${checkout.environment}:${checkout.merchantId}`;
      if (initializedConfiguration !== configuration) {
        const initialized = await plugin.init({
          environment: checkout.environment,
          merchantId: checkout.merchantId,
          flowId: flowIdFor(generateFlowId()),
          enableLogging: false,
        });
        if (initialized?.status !== true) throw new Error(SDK_ERROR);
        initializedConfiguration = configuration;
      }
      const result = await plugin.startTransaction({
        request: JSON.stringify({
          orderId: checkout.providerOrderId,
          merchantId: checkout.merchantId,
          token: checkout.token,
          paymentMode: { type: 'PAY_PAGE' },
        }),
        showLoaderFlag: true,
        appSchema: null,
      });
      return { status: SDK_RESULT_STATUSES.has(result?.status) ? 'returned' : 'unavailable' };
    } catch {
      throw new Error(SDK_ERROR);
    }
  };

  return Object.freeze({ resolveChannel, start });
}

export const phonePeMobileCheckout = createPhonePeMobileCheckout({
  isNativePlatform: () => Capacitor.isNativePlatform(),
  isPluginAvailable: (name) => Capacitor.isPluginAvailable(name),
  loadPlugin: loadPhonePePlugin,
  generateFlowId: () => globalThis.crypto.randomUUID(),
});
