import { useEffect, useMemo, useState } from 'react';
import { loadAppConfig, loadRemoteAppConfig, subscribeToAppConfig } from '@beonedge/shared/appConfig.js';
import { resolveInternalPath } from '../navigation/routes.js';

/**
 * Normalize the destinations an admin published into app config.
 *
 * Dashboard quick actions carry a free-text `route` that was handed straight to
 * `navigate()`. Anyone who can publish config could therefore steer the client
 * app to an arbitrary path — including a path that does not exist, which before
 * the wildcard fix looked to the user like the app restarting.
 *
 * Each action's route is resolved against the canonical route manifest. An action
 * whose destination cannot be resolved is dropped: the client must never render a
 * button that leads nowhere. That is a last line of defence, not the fix — the
 * App Builder should refuse to publish an invalid destination in the first place,
 * and validating there is what makes this filter rarely fire.
 *
 * Note on placement: this normalization lives in the client package rather than
 * in `@beonedge/shared/appConfig.js` because the route manifest is client-owned
 * and `shared` must not depend on `client` (the dependency runs the other way).
 * Config reaching the client passes through this hook, so this is the edge.
 */
function normalizeAppConfig(config) {
  const quickActions = config?.mobile?.screens?.dashboard?.quickActions;
  if (!Array.isArray(quickActions)) return config;

  const safeActions = quickActions
    .map((action) => {
      const path = resolveInternalPath(action?.route);
      return path ? { ...action, route: path } : null;
    })
    .filter(Boolean);

  // Preserve object identity when nothing was rejected or rewritten, so
  // consumers do not see a new config object on every render.
  const unchanged =
    safeActions.length === quickActions.length &&
    safeActions.every((action, index) => action.route === quickActions[index].route);
  if (unchanged) return config;

  return {
    ...config,
    mobile: {
      ...config.mobile,
      screens: {
        ...config.mobile.screens,
        dashboard: {
          ...config.mobile.screens.dashboard,
          quickActions: safeActions,
        },
      },
    },
  };
}

export function useAppConfig() {
  const [config, setConfig] = useState(() => loadAppConfig());

  useEffect(() => {
    let cancelled = false;
    loadRemoteAppConfig().then((remoteConfig) => {
      if (!cancelled && remoteConfig) setConfig(remoteConfig);
    }).catch(() => {});

    const unsubscribe = subscribeToAppConfig(setConfig);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Normalized on read rather than on write: config also arrives from
  // localStorage and from the cross-tab `storage` event, and every one of those
  // paths must be validated, not just the network response.
  return useMemo(() => normalizeAppConfig(config), [config]);
}

export { normalizeAppConfig };
