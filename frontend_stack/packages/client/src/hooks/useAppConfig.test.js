// Published quick-action destination validation (Task 5).
//
// Dashboard quick actions carry a free-text `route` published from the admin App
// Builder and previously passed straight to `navigate()`. This is the client-side
// last line of defence; the publisher should reject invalid destinations first.
import { describe, expect, test } from 'vitest';
import { normalizeAppConfig } from './useAppConfig.js';

function configWithActions(actions) {
  return {
    version: '1',
    mobile: { screens: { dashboard: { quickActions: actions, components: [] } } },
  };
}

const actionsOf = (config) => config.mobile.screens.dashboard.quickActions;

describe('normalizeAppConfig', () => {
  test('keeps valid published routes', () => {
    const config = configWithActions([
      { id: 'start_sip', label: 'Start SIP', route: '/app/explore', enabled: true },
      { id: 'history', label: 'History', route: '/app/transactions', enabled: true },
    ]);

    expect(actionsOf(normalizeAppConfig(config)).map((a) => a.route))
      .toEqual(['/app/explore', '/app/transactions']);
  });

  test('accepts a stable destination id and rewrites it to a path', () => {
    const config = configWithActions([{ id: 'home', label: 'Home', route: 'portfolio' }]);

    expect(actionsOf(normalizeAppConfig(config))[0].route).toBe('/app/portfolio');
  });

  test('drops an action whose route does not exist', () => {
    // A button that navigates nowhere is worse than a missing button: before the
    // wildcard fix it looked to the user like the app restarting.
    const config = configWithActions([
      { id: 'ok', label: 'Explore', route: '/app/explore' },
      { id: 'dead', label: 'Orders', route: '/app/orders' },
    ]);

    const actions = actionsOf(normalizeAppConfig(config));
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('ok');
  });

  test('drops hostile and cross-scope routes', () => {
    const config = configWithActions([
      { id: 'a', label: 'A', route: 'javascript:alert(1)' },
      { id: 'b', label: 'B', route: '//evil.example' },
      { id: 'c', label: 'C', route: '/admin/users/approvals' },
      { id: 'd', label: 'D', route: 'https://evil.example' },
      { id: 'e', label: 'E' },
    ]);

    expect(actionsOf(normalizeAppConfig(config))).toHaveLength(0);
  });

  test('preserves every other field on a surviving action', () => {
    const config = configWithActions([
      { id: 'start_sip', label: 'Start SIP', icon: 'Plus', route: '/app/explore', enabled: true },
    ]);

    expect(actionsOf(normalizeAppConfig(config))[0]).toEqual({
      id: 'start_sip', label: 'Start SIP', icon: 'Plus', route: '/app/explore', enabled: true,
    });
  });

  test('returns the same object when nothing needed changing', () => {
    // Avoids handing consumers a new config object on every render.
    const config = configWithActions([{ id: 'a', label: 'A', route: '/app/explore' }]);
    expect(normalizeAppConfig(config)).toBe(config);
  });

  test('tolerates configs with no quick actions at all', () => {
    expect(normalizeAppConfig({})).toEqual({});
    expect(normalizeAppConfig(null)).toBeNull();
    expect(normalizeAppConfig(configWithActions(undefined)).mobile).toBeDefined();
  });
});
