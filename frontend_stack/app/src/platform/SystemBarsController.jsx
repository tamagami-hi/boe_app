import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { platformLifecycle } from '@beonedge/client/platform/lifecycle.js';
import {
  getSystemChrome,
  subscribeToSystemChrome,
} from '@beonedge/shared/platform/systemBarStyle.js';

const plugins = {};

function resolvePlugin(name) {
  if (name in plugins) return plugins[name];
  try {
    plugins[name] = Capacitor.registerPlugin?.(name);
  } catch {
    plugins[name] = undefined;
  }
  return plugins[name];
}

function isNative() {
  try {
    return Boolean(Capacitor.isNativePlatform?.());
  } catch {
    return false;
  }
}

export default function SystemBarsController() {
  const [chrome, setChrome] = useState(getSystemChrome);

  useEffect(() => {
    setChrome(getSystemChrome());
    return subscribeToSystemChrome(setChrome);
  }, []);

  useEffect(() => {
    if (!isNative()) return undefined;

    let cancelled = false;

    async function apply() {
      if (cancelled) return;

      const bars = resolvePlugin('SystemBars');
      if (bars?.setStyle) {
        try {
          await bars.setStyle({ style: chrome.style });
        } catch {
          /* the theme defaults still apply */
        }
      }

      if (cancelled) return;

      const systemChrome = resolvePlugin('SystemChrome');
      if (systemChrome?.setBarBackground) {
        try {
          await systemChrome.setBarBackground({ color: chrome.background });
        } catch {
          /* an older build without the plugin keeps the theme background */
        }
      }
    }

    apply();
    const stopResume = platformLifecycle.onResume(() => { apply(); });

    return () => {
      cancelled = true;
      stopResume?.();
    };
  }, [chrome]);

  return null;
}
