// Retry policy. A dropped GET is normal on a mobile network and worth replaying; a
// write is never replayed, because the app cannot know whether it arrived and a
// duplicated payment or redemption is the one failure that costs real money.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CONNECTIVITY, getConnectivity, resetConnectivity,
} from '@beonedge/shared/net/connectivity.js';

const { apiRequest, isTransportError } = await import('./_util.js');

const ok = (body = { ok: true, data: {} }) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  resetConnectivity();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetConnectivity();
});

/** Runs a request to completion while draining the retry backoff timers. */
async function run(promise) {
  const settled = promise.then((value) => ({ value }), (error) => ({ error }));
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
  }
  return settled;
}

describe('idempotent reads', () => {
  test('a dropped GET is retried and can succeed on a later attempt', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok({ ok: true, data: { items: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const { value, error } = await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(error).toBeUndefined();
    expect(value).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('retries are bounded, and the caller still sees a transport error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { error } = await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(isTransportError(error)).toBe(true);
    // One attempt plus the two bounded retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('an HTTP error is not retried: the server answered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ ok: false, error: { message: 'Nope' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { error } = await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(error.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('writes', () => {
  test('a dropped POST is never replayed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { error } = await run(apiRequest('/v1/client/orders', {
      method: 'POST',
      auth: false,
      body: { amountPaise: 500000 },
    }));
    expect(isTransportError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a dropped PATCH is never replayed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await run(apiRequest('/v1/admin/redemption-requests/r1', {
      method: 'PATCH',
      auth: false,
      body: { action: 'approved' },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('connectivity is learned from real traffic', () => {
  test('a failed request marks the app unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(getConnectivity().status).toBe(CONNECTIVITY.UNREACHABLE);
  });

  test('a successful request clears it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(getConnectivity().status).toBe(CONNECTIVITY.UNREACHABLE);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));
    await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(getConnectivity().status).toBe(CONNECTIVITY.ONLINE);
  });

  test('an HTTP 500 is a server problem, not a connectivity one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ ok: false, error: { message: 'boom' } }),
    }));
    await run(apiRequest('/v1/client/funds', { auth: false }));
    expect(getConnectivity().status).toBe(CONNECTIVITY.ONLINE);
  });
});
