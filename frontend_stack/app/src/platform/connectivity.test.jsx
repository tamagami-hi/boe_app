// The connectivity contract. The provider existed but was connected at neither end:
// its two "called by the request layer" hooks were never called (the transport is a
// plain module and cannot read a React context), and no screen read its state.
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  CONNECTIVITY,
  getConnectivity,
  isDegraded,
  reportTransportOutcome,
  resetConnectivity,
  setConnectivity,
  subscribeToConnectivity,
} from '@beonedge/shared/net/connectivity.js';
import AsyncState from '@beonedge/shared/components/AsyncState.jsx';
import NetworkStatusProvider, { useNetworkStatus } from './NetworkStatusProvider.jsx';
import ConnectivityBanner from './ConnectivityBanner.jsx';

let onLine = true;

beforeEach(() => {
  resetConnectivity();
  onLine = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConnectivity();
});

describe('the store', () => {
  test('starts online and reports degradation only after a real failure', () => {
    expect(getConnectivity().status).toBe(CONNECTIVITY.ONLINE);
    expect(isDegraded()).toBe(false);
    reportTransportOutcome(false);
    expect(getConnectivity().status).toBe(CONNECTIVITY.UNREACHABLE);
    expect(isDegraded()).toBe(true);
  });

  // The case navigator.onLine cannot see, and the reason UNREACHABLE exists.
  test('an interface that is up but a silent API is unreachable, not offline', () => {
    onLine = true;
    reportTransportOutcome(false);
    expect(getConnectivity().status).toBe(CONNECTIVITY.UNREACHABLE);
  });

  test('a failure with the interface down is offline', () => {
    onLine = false;
    reportTransportOutcome(false);
    expect(getConnectivity().status).toBe(CONNECTIVITY.OFFLINE);
  });

  test('a success is the strongest evidence and stamps the time', () => {
    reportTransportOutcome(false);
    reportTransportOutcome(true, 1234);
    expect(getConnectivity().status).toBe(CONNECTIVITY.ONLINE);
    expect(getConnectivity().lastSuccessAt).toBe(1234);
  });

  test('subscribers see changes and nothing else', () => {
    const seen = [];
    const unsubscribe = subscribeToConnectivity((next) => seen.push(next.status));
    setConnectivity(CONNECTIVITY.OFFLINE);
    setConnectivity(CONNECTIVITY.OFFLINE);
    setConnectivity(CONNECTIVITY.ONLINE);
    unsubscribe();
    setConnectivity(CONNECTIVITY.OFFLINE);
    expect(seen).toEqual([CONNECTIVITY.OFFLINE, CONNECTIVITY.ONLINE]);
  });

  test('an unknown status is refused', () => {
    setConnectivity('probably');
    expect(getConnectivity().status).toBe(CONNECTIVITY.ONLINE);
  });
});

function Probe() {
  const { status, isDegraded: degraded } = useNetworkStatus();
  return <output data-testid="status">{`${status}:${degraded}`}</output>;
}

describe('the provider', () => {
  test('mirrors what the transport reports', () => {
    render(<NetworkStatusProvider><Probe /></NetworkStatusProvider>);
    expect(screen.getByTestId('status').textContent).toBe('online:false');
    act(() => { reportTransportOutcome(false); });
    expect(screen.getByTestId('status').textContent).toBe('unreachable:true');
  });

  test('an offline event applies at once; an online event probes before believing it', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    render(<NetworkStatusProvider probe={probe}><Probe /></NetworkStatusProvider>);

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByTestId('status').textContent).toBe('offline:true');

    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(probe).toHaveBeenCalledTimes(1);
    // The probe said the API is still silent, so the app does not claim to be back.
    expect(screen.getByTestId('status').textContent).toBe('unreachable:true');
  });

  test('a successful probe restores online', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    render(<NetworkStatusProvider probe={probe}><Probe /></NetworkStatusProvider>);
    act(() => { reportTransportOutcome(false); });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByTestId('status').textContent).toBe('online:false');
  });

  test('without a provider the hook reads the store rather than lying', () => {
    reportTransportOutcome(false);
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('unreachable:true');
  });
});

describe('the banner', () => {
  test('is absent while online', () => {
    render(<NetworkStatusProvider><ConnectivityBanner /></NetworkStatusProvider>);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('names the two cases differently, because the fix differs', () => {
    const { rerender } = render(
      <NetworkStatusProvider><ConnectivityBanner /></NetworkStatusProvider>,
    );
    act(() => { setConnectivity(CONNECTIVITY.OFFLINE); });
    expect(screen.getByRole('status').textContent).toContain('No connection');

    act(() => { setConnectivity(CONNECTIVITY.UNREACHABLE); });
    rerender(<NetworkStatusProvider><ConnectivityBanner /></NetworkStatusProvider>);
    expect(screen.getByRole('status').textContent).toContain('Cannot reach BeOnEdge');
  });

  test('it says the values on screen may be out of date', () => {
    render(<NetworkStatusProvider><ConnectivityBanner /></NetworkStatusProvider>);
    act(() => { setConnectivity(CONNECTIVITY.OFFLINE); });
    expect(screen.getByRole('status').textContent).toMatch(/out of date/u);
  });

  test('Try again probes once per tap, even on a double tap', async () => {
    let resolve;
    const probe = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<NetworkStatusProvider probe={probe}><ConnectivityBanner /></NetworkStatusProvider>);
    act(() => { setConnectivity(CONNECTIVITY.UNREACHABLE); });
    const button = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(probe).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(true); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('retained data while degraded', () => {
  const resource = { data: [1], isLoading: false, error: null, updatedAt: new Date('2026-08-14T09:05:00').getTime() };

  test('cached figures are labelled with the time they were read', () => {
    setConnectivity(CONNECTIVITY.OFFLINE);
    render(<AsyncState resource={resource}><div>₹25,000</div></AsyncState>);
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Not connected');
    expect(note.textContent).toMatch(/as of 09:05/u);
  });

  test('nothing is labelled while online', () => {
    render(<AsyncState resource={resource}><div>₹25,000</div></AsyncState>);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('a failed refresh still wins the wording, because it is more specific', () => {
    setConnectivity(CONNECTIVITY.OFFLINE);
    render(
      <AsyncState resource={{ ...resource, error: new Error('nope') }}>
        <div>₹25,000</div>
      </AsyncState>,
    );
    expect(screen.getByRole('status').textContent).toContain('last values we could load');
  });
});


describe('session state', () => {
  test('a real transport failure at boot is not a logout', async () => {
    const { isRestoreFailure } = await import('@beonedge/client/store/sessionState.js');
    // It checked for 'TIMEOUT'/'NETWORK'/'OFFLINE'; the transport raises these two,
    // so the guard never fired and a timed-out cold start showed a login form.
    expect(isRestoreFailure({ code: 'REQUEST_TIMEOUT' })).toBe(true);
    expect(isRestoreFailure({ code: 'NETWORK_UNAVAILABLE' })).toBe(true);
    expect(isRestoreFailure({ status: 503 })).toBe(true);
    // A genuine "no session" must stay a logout.
    expect(isRestoreFailure({ status: 401 })).toBe(false);
    expect(isRestoreFailure(null)).toBe(false);
  });

  test('an invalidated session is distinguishable from never having had one', async () => {
    const { anonymousState, expiredState } = await import('@beonedge/client/store/sessionState.js');
    expect(anonymousState().endedReason).toBeNull();
    expect(expiredState().endedReason).toBe('expired');
    expect(expiredState().user).toBeNull();
  });
});
