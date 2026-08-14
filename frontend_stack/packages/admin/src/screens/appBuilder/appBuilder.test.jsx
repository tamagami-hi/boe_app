// The App Builder. Its defects: everything it published was read back by nobody
// (see appConfigRoundTrip.test.js), a shortcut destination could be any string, and
// the strategy catalogue it presented beside the Publish button cannot be published
// at all.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  QUICK_ACTION_DESTINATIONS, copyLabel, isValidDestination, validateBuilderConfig,
} from './appBuilderModel.js';
import AppBuilderScreen from './AppBuilderScreen.jsx';
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from '@beonedge/shared/appConfig.js';

const publishAppConfig = vi.fn();
const loadRemoteAppConfig = vi.fn();
const resetAppConfig = vi.fn();

vi.mock('@beonedge/shared/appConfig.js', async () => {
  const actual = await vi.importActual('@beonedge/shared/appConfig.js');
  return {
    ...actual,
    loadAppConfig: () => actual.normalizeAppConfig(actual.DEFAULT_APP_CONFIG),
    loadRemoteAppConfig: (...args) => loadRemoteAppConfig(...args),
    publishAppConfig: (...args) => publishAppConfig(...args),
    resetAppConfig: (...args) => resetAppConfig(...args),
  };
});

const baseConfig = () => normalizeAppConfig(DEFAULT_APP_CONFIG);

beforeEach(() => {
  publishAppConfig.mockReset().mockImplementation(async (config) => config);
  loadRemoteAppConfig.mockReset().mockResolvedValue(null);
  resetAppConfig.mockReset().mockImplementation(() => baseConfig());
});

const renderBuilder = () => render(<MemoryRouter><AppBuilderScreen /></MemoryRouter>);

describe('destination validation', () => {
  test('every offered destination is a real, static, private client route', () => {
    expect(QUICK_ACTION_DESTINATIONS.length).toBeGreaterThan(3);
    for (const destination of QUICK_ACTION_DESTINATIONS) {
      expect(destination.path.startsWith('/app/')).toBe(true);
      expect(destination.path).not.toContain(':');
      expect(isValidDestination(destination.path)).toBe(true);
    }
  });

  test('a free-text path is not a destination', () => {
    expect(isValidDestination('/app/nonsense')).toBe(false);
    expect(isValidDestination('')).toBe(false);
    expect(isValidDestination('https://example.com')).toBe(false);
  });

  test('publish is refused for an unresolvable destination, an empty label or a bad icon', () => {
    const config = baseConfig();
    config.mobile.screens.dashboard.quickActions = [
      { id: 'a', label: '', icon: 'Plus', route: '/app/explore', enabled: true },
      { id: 'b', label: 'Go', icon: 'Plus', route: '/app/nowhere', enabled: true },
      { id: 'c', label: 'Go', icon: 'Sparkles', route: '/app/explore', enabled: true },
    ];
    const problems = validateBuilderConfig(config);
    expect(problems.some((p) => p.includes('Shortcut 1 has no label'))).toBe(true);
    expect(problems.some((p) => p.includes('/app/nowhere'))).toBe(true);
    expect(problems.some((p) => p.includes('Sparkles'))).toBe(true);
  });

  test('empty copy is refused, because a blank label ships a blank screen', () => {
    const config = baseConfig();
    config.mobile.screens.dashboard.copy.portfolioTitle = '   ';
    expect(validateBuilderConfig(config).some((p) => p.includes('Portfolio title'))).toBe(true);
  });

  test('copy longer than the canonical limit is refused', () => {
    const config = baseConfig();
    config.mobile.screens.explore.copy.title = 'x'.repeat(501);
    expect(validateBuilderConfig(config).some((p) => p.includes('longer than 500'))).toBe(true);
  });

  test('the default configuration is publishable', () => {
    expect(validateBuilderConfig(baseConfig())).toEqual([]);
  });

  test('copy keys read as operator language', () => {
    expect(copyLabel('noActiveCta')).toBe('No active cta');
    expect(copyLabel('portfolioTitle')).toBe('Portfolio title');
  });
});

describe('the staged editor', () => {
  test('sections are addressable and one is marked as not published', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /Components/u });
    fireEvent.click(screen.getByRole('button', { name: /Screen copy/u }));
    expect(screen.getByText('Screen copy', { selector: '.adm-card-title' })).toBeTruthy();
    const fixtures = screen.getByRole('button', { name: /Offline fixtures/u });
    expect(fixtures.textContent).toContain('not published');
  });

  test('a component toggle reports its state rather than an action', async () => {
    renderBuilder();
    const switches = await screen.findAllByRole('switch');
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(switches[0].textContent).toBe('Shown');
    fireEvent.click(switches[0]);
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('switch')[0].textContent).toBe('Hidden');
  });

  test('publishing sends the edited config once, even on a double tap', async () => {
    let resolve;
    publishAppConfig.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderBuilder();
    const button = await screen.findByRole('button', { name: /Publish/u });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(publishAppConfig).toHaveBeenCalledTimes(1);
    resolve(baseConfig());
  });

  test('a shortcut with no destination blocks the publish and says why', async () => {
    renderBuilder();
    fireEvent.click(await screen.findByRole('button', { name: /Shortcuts/u }));
    const destination = screen.getByLabelText('Shortcut 1 destination');
    // Simulate a previously published value that is no longer a route.
    fireEvent.change(destination, { target: { value: '/app/explore' } });
    fireEvent.click(screen.getByLabelText('Shortcut 1 label'), {});
    fireEvent.change(screen.getByLabelText('Shortcut 1 label'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish/u }));
    expect(publishAppConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/Shortcut 1 has no label/u)).toBeTruthy();
  });

  test('the destination picker only offers real routes', async () => {
    renderBuilder();
    fireEvent.click(await screen.findByRole('button', { name: /Shortcuts/u }));
    const options = Array.from(screen.getByLabelText('Shortcut 1 destination').querySelectorAll('option'));
    for (const option of options) expect(isValidDestination(option.value)).toBe(true);
  });

  test('a failed read of the published config says so instead of looking published', async () => {
    loadRemoteAppConfig.mockRejectedValue(new Error('offline'));
    renderBuilder();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('draft held in this browser');
  });

  test('the fixtures section states that it never leaves the browser', async () => {
    renderBuilder();
    fireEvent.click(await screen.findByRole('button', { name: /Offline fixtures/u }));
    expect(screen.getByText(/without a backend/u)).toBeTruthy();
    expect(screen.getByText(/Fund operations, not here/u)).toBeTruthy();
  });

  test('every button on the screen declares its type', async () => {
    renderBuilder();
    await screen.findByRole('button', { name: /Publish/u });
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
    for (const control of screen.getAllByRole('switch')) {
      expect(control.getAttribute('type')).toBe('button');
    }
  });
});
