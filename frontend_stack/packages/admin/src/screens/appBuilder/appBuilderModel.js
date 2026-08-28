import { CLIENT_ROUTES } from '@beonedge/client/navigation/routes.js';

/**
 * Destinations offerable as a dashboard shortcut, derived from the client's
 * canonical route manifest so this list cannot drift from the routes the app
 * actually mounts.
 *
 * Excluded: parameterised routes (a static shortcut has no fund or payment id to
 * supply), public pre-auth screens, and transactional flows (which must be entered
 * from the screen that produced their id, not from a shortcut).
 */
export const QUICK_ACTION_DESTINATIONS = CLIENT_ROUTES
  .filter((route) => !route.path.includes(':') && !route.isPublic && !route.isTransactional)
  .map((route) => ({
    path: route.path,
    destinationId: route.destinationId,
    label: `${route.destinationId.replace(/_/gu, ' ')} — ${route.path}`,
  }));

const VALID_PATHS = new Set(QUICK_ACTION_DESTINATIONS.map((destination) => destination.path));

// The four the client renders. `Dashboard.jsx` maps these through ACTION_ICONS and
// falls back to Compass, so an unknown name is a silently wrong icon.
export const QUICK_ACTION_ICONS = ['Plus', 'Repeat', 'Receipt', 'Compass'];

export const MAX_QUICK_ACTIONS = 8;

export const SECTIONS = [
  { id: 'components', label: 'Components', scope: 'published' },
  { id: 'copy', label: 'Screen copy', scope: 'published' },
  { id: 'shortcuts', label: 'Shortcuts', scope: 'published' },
  { id: 'amounts', label: 'Amounts', scope: 'published' },
];

export const SECTION_IDS = SECTIONS.map((section) => section.id);

export const COPY_SCREENS = [
  { id: 'dashboard', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'fundDetail', label: 'Fund detail' },
];

/** A copy key in operator language: `noActiveCta` -> `No active cta`. */
export function copyLabel(key) {
  const spaced = String(key).replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/[_-]+/gu, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Refuse to publish what the client would have to throw away.
 *
 * The client already drops a shortcut whose destination it cannot resolve
 * (`useAppConfig`), but that is a last line of defence. An invalid destination
 * should be impossible to publish, and a shortcut with no label ships a button with
 * no text on it.
 */
export function validateBuilderConfig(config) {
  const problems = [];
  const actions = config?.mobile?.screens?.dashboard?.quickActions || [];

  if (actions.length > MAX_QUICK_ACTIONS) {
    problems.push(`Only ${MAX_QUICK_ACTIONS} shortcuts can be published; there are ${actions.length}.`);
  }

  actions.forEach((action, index) => {
    const position = index + 1;
    if (!String(action.label || '').trim()) {
      problems.push(`Shortcut ${position} has no label.`);
    }
    if (!VALID_PATHS.has(action.route)) {
      problems.push(`Shortcut ${position} points at ${action.route || 'nothing'}, which is not a client destination.`);
    }
    if (!QUICK_ACTION_ICONS.includes(action.icon)) {
      problems.push(`Shortcut ${position} uses the icon "${action.icon}", which the app does not have.`);
    }
  });

  for (const screen of COPY_SCREENS) {
    const copy = config?.mobile?.screens?.[screen.id]?.copy || {};
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue;
      if (!value.trim()) problems.push(`${screen.label}: "${copyLabel(key)}" is empty.`);
      // The canonical presentation record caps a value at 500 characters.
      if (value.length > 500) problems.push(`${screen.label}: "${copyLabel(key)}" is longer than 500 characters.`);
    }
  }

  return problems;
}

export function isValidDestination(path) {
  return VALID_PATHS.has(path);
}
