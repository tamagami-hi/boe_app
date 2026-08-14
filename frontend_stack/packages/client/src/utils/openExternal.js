import { Capacitor } from '@capacitor/core';
import { DESTINATION_KIND, resolveDestination } from '../navigation/routes.js';

/**
 * Open a non-internal destination through one central, validated path.
 *
 * Why centralised: external URLs, mailto: and tel: targets all arrive from
 * remote content (disclosure documents, grievance escalation steps, published
 * config). Handing those straight to `window.open` or an `<a href>` means a
 * hostile or merely stale value decides where the user goes, and on native it
 * decides which app is launched.
 *
 * Nothing is opened unless `resolveDestination` classifies it as external, email
 * or phone — so `javascript:`, `data:`, cleartext `http:`, protocol-relative
 * `//host` and the WebView's own `https://localhost` origin are all refused
 * before they reach the platform.
 *
 * @param {unknown} value raw destination from remote content
 * @returns {Promise<{ok: true, kind: string, url: string} | {ok: false, reason: string}>}
 *   Always resolves. Callers are expected to surface `ok: false` to the user
 *   rather than leaving a tap with no visible result.
 */
export async function openExternal(value) {
  const destination = resolveDestination(value);

  const openable = new Set([
    DESTINATION_KIND.EXTERNAL,
    DESTINATION_KIND.EMAIL,
    DESTINATION_KIND.PHONE,
  ]);

  if (!openable.has(destination.kind)) {
    return { ok: false, reason: destination.reason || `not-openable:${destination.kind}` };
  }

  const { url } = destination;

  try {
    // mailto:/tel: must go to the OS handler, not the in-app browser view —
    // Capacitor's Browser plugin cannot service them.
    const useSystemHandler = destination.kind !== DESTINATION_KIND.EXTERNAL;

    if (Capacitor.isNativePlatform() && !useSystemHandler) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return { ok: true, kind: destination.kind, url };
    }

    // `noopener` matters on web: without it the opened page gets a handle back
    // into this window via `window.opener`.
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened && !useSystemHandler) return { ok: false, reason: 'blocked' };
    return { ok: true, kind: destination.kind, url };
  } catch (err) {
    return { ok: false, reason: 'open-failed' };
  }
}
