import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { platformLifecycle } from '@beonedge/client/platform/lifecycle.js';

/**
 * Keeps the Android status and navigation bar styling correct for the app's light
 * chrome, and re-applies it after the events that silently reset it.
 *
 * `capacitor.config.json` already sets `SystemBars.style: "LIGHT"`, which is
 * applied once at plugin load. That is not always enough: the style can be lost
 * when the activity is recreated (a configuration change, or Android reclaiming a
 * backgrounded process), which leaves white icons on the ivory app bar —
 * effectively invisible. Re-asserting on resume is cheap and idempotent.
 *
 * "LIGHT" means *light appearance*, i.e. DARK icons. From the plugin source:
 * `setAppearanceLightStatusBars(!style.equals("DARK"))`. BOE is light-only, so
 * dark icons are correct; "DARK" would be the invisible-icon case.
 *
 * No-op on web, where the browser owns its own chrome.
 */
export default function SystemBarsController({ style = 'LIGHT' }) {
  useEffect(() => {
    let native = false;
    try {
      native = Boolean(Capacitor.isNativePlatform?.());
    } catch {
      native = false;
    }
    if (!native) return undefined;

    let cancelled = false;

    async function applyStyle() {
      try {
        // Resolved lazily so the browser bundle never pulls the plugin in.
        const plugin = Capacitor.registerPlugin?.('SystemBars');
        if (cancelled || !plugin?.setStyle) return;
        await plugin.setStyle({ style });
      } catch {
        // An older WebView or a build without the capability: the theme-level
        // defaults still apply, so this is a refinement, not a requirement.
      }
    }

    applyStyle();

    // Re-apply on resume. Uses the existing lifecycle adapter rather than a second
    // appStateChange listener, so there is one place that understands the
    // native/web difference.
    const stopResume = platformLifecycle.onResume(() => { applyStyle(); });

    return () => {
      cancelled = true;
      stopResume?.();
    };
  }, [style]);

  return null;
}
