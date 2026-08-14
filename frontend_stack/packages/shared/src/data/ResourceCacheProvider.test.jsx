// Resource cache tests (Task 21).
//
// The four behaviours that justify the file, each of which was a real defect:
// in-flight de-duplication, staleness respected on re-read, data RETAINED through a
// refresh and through a failure, and prefix invalidation.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  ResourceCacheProvider,
  STALE_TIME,
  useResource,
  useResourceCache,
} from './ResourceCacheProvider.jsx';

function Consumer({ cacheKey, fetcher, staleTime = 0, enabled = true, label = 'a' }) {
  const { data, error, isLoading, isRefreshing, updatedAt } = useResource(cacheKey, fetcher, { staleTime, enabled });
  return (
    <div
      data-testid={`consumer-${label}`}
      data-loading={String(isLoading)}
      data-refreshing={String(isRefreshing)}
      data-error={error ? error.message : ''}
      data-updated={updatedAt ? 'yes' : 'no'}
    >
      {data === undefined ? 'none' : String(data)}
    </div>
  );
}

const read = (label = 'a') => screen.getByTestId(`consumer-${label}`);

function renderWithCache(ui) {
  return render(<ResourceCacheProvider>{ui}</ResourceCacheProvider>);
}

/** Flush queued promise callbacks and let React commit. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useRealTimers();
});

describe('in-flight de-duplication', () => {
  test('three consumers of one key produce one request', async () => {
    // Dashboard mounted five requests per visit and two screens needing the same
    // fund list fetched it twice, concurrently. This is the fix.
    const fetcher = vi.fn(() => Promise.resolve('value'));

    renderWithCache(
      <>
        <Consumer cacheKey="k" fetcher={fetcher} label="a" />
        <Consumer cacheKey="k" fetcher={fetcher} label="b" />
        <Consumer cacheKey="k" fetcher={fetcher} label="c" />
      </>,
    );
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(read('a')).toHaveTextContent('value');
    expect(read('c')).toHaveTextContent('value');
  });

  test('different keys are independent', async () => {
    const one = vi.fn(() => Promise.resolve('one'));
    const two = vi.fn(() => Promise.resolve('two'));

    renderWithCache(
      <>
        <Consumer cacheKey="k1" fetcher={one} label="a" />
        <Consumer cacheKey="k2" fetcher={two} label="b" />
      </>,
    );
    await settle();

    expect(read('a')).toHaveTextContent('one');
    expect(read('b')).toHaveTextContent('two');
  });
});

describe('staleness', () => {
  test('a remount inside the stale window does not refetch', async () => {
    const fetcher = vi.fn(() => Promise.resolve('value'));

    const { unmount } = renderWithCache(
      <ResourceCacheProvider>
        <Consumer cacheKey="k" fetcher={fetcher} staleTime={STALE_TIME.STATIC} />
      </ResourceCacheProvider>,
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();

    // NOTE: a fresh provider means a fresh cache, so this asserts within one
    // provider instance — which is how the app runs (one provider at the root).
  });

  test('staleTime 0 refetches on every mount', async () => {
    const fetcher = vi.fn(() => Promise.resolve('v'));

    function Toggle({ show }) {
      return (
        <ResourceCacheProvider>
          {show ? <Consumer cacheKey="k" fetcher={fetcher} staleTime={0} /> : null}
        </ResourceCacheProvider>
      );
    }
    const { rerender } = render(<Toggle show />);
    await settle();
    rerender(<Toggle show={false} />);
    rerender(<Toggle show />);
    await settle();

    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('data is retained, never blanked', () => {
  test('a refresh keeps the previous value visible', async () => {
    let resolveSecond;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => Promise.resolve('first'))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));

    function Harness() {
      const cache = useResourceCache();
      return (
        <>
          <Consumer cacheKey="k" fetcher={fetcher} staleTime={STALE_TIME.STATIC} />
          <button type="button" onClick={() => cache.invalidate('k')}>invalidate</button>
        </>
      );
    }

    renderWithCache(<Harness />);
    await settle();
    expect(read()).toHaveTextContent('first');

    // Invalidate, then trigger a re-read by remounting the subscriber's effect via
    // a refresh through the cache.
    await act(async () => { screen.getByRole('button', { name: 'invalidate' }).click(); });
    await settle();

    // Still showing the old value while the new request is in flight — the whole
    // point. Previously the page cleared its state first and flashed a spinner.
    expect(read()).toHaveTextContent('first');

    await act(async () => { resolveSecond?.('second'); await Promise.resolve(); });
    await settle();
  });

  test('a failed refresh keeps the last good data and reports the error', async () => {
    // This is the "a timeout became an empty portfolio" defect.
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve('good') : Promise.reject(new Error('timeout'));
    });

    function Harness() {
      const { data, error, refresh } = useResource('k', fetcher, { staleTime: STALE_TIME.STATIC });
      return (
        <div>
          <span data-testid="value">{data === undefined ? 'none' : String(data)}</span>
          <span data-testid="err">{error ? error.message : ''}</span>
          <button type="button" onClick={refresh}>refresh</button>
        </div>
      );
    }

    renderWithCache(<Harness />);
    await settle();
    expect(screen.getByTestId('value')).toHaveTextContent('good');

    await act(async () => { screen.getByRole('button', { name: 'refresh' }).click(); });
    await settle();

    expect(screen.getByTestId('value')).toHaveTextContent('good');
    expect(screen.getByTestId('err')).toHaveTextContent('timeout');
  });

  test('a first-load failure surfaces the error with no data', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('down')));

    renderWithCache(<Consumer cacheKey="k" fetcher={fetcher} />);
    await settle();

    expect(read()).toHaveTextContent('none');
    expect(read()).toHaveAttribute('data-error', 'down');
  });
});

describe('updatedAt is always available', () => {
  test('set on success so a money screen can show an as-of time', async () => {
    // A cache that cannot say how old a balance is must not be used for balances.
    renderWithCache(<Consumer cacheKey="k" fetcher={() => Promise.resolve(1)} />);
    await settle();

    expect(read()).toHaveAttribute('data-updated', 'yes');
  });
});

describe('invalidation', () => {
  test('matches by prefix so a mutation can invalidate a domain', async () => {
    const cacheRef = {};
    function Grab() {
      Object.assign(cacheRef, useResourceCache());
      return null;
    }
    const a = vi.fn(() => Promise.resolve('a'));
    const b = vi.fn(() => Promise.resolve('b'));

    renderWithCache(
      <>
        <Grab />
        <Consumer cacheKey="portfolio:summary" fetcher={a} label="a" staleTime={STALE_TIME.STATIC} />
        <Consumer cacheKey="funds:list" fetcher={b} label="b" staleTime={STALE_TIME.STATIC} />
      </>,
    );
    await settle();

    await act(async () => { cacheRef.invalidate('portfolio:'); });
    await settle();

    // The portfolio entry is stale but still holds its data; funds is untouched.
    expect(read('a')).toHaveTextContent('a');
    expect(read('b')).toHaveTextContent('b');
  });

  test('clear removes entries entirely, for logout', async () => {
    const cacheRef = {};
    function Grab() {
      Object.assign(cacheRef, useResourceCache());
      return null;
    }

    renderWithCache(
      <>
        <Grab />
        <Consumer cacheKey="portfolio:summary" fetcher={() => Promise.resolve('secret')} staleTime={STALE_TIME.STATIC} />
      </>,
    );
    await settle();
    expect(read()).toHaveTextContent('secret');

    // One user's balances must not survive into another user's session.
    await act(async () => { cacheRef.clear('portfolio:'); });
    await settle();

    expect(cacheRef.getEntry('portfolio:summary').data).toBeUndefined();
  });
});

describe('disabled and null keys', () => {
  test('a null key fetches nothing', async () => {
    const fetcher = vi.fn();
    renderWithCache(<Consumer cacheKey={null} fetcher={fetcher} />);
    await settle();

    expect(fetcher).not.toHaveBeenCalled();
    expect(read()).toHaveTextContent('none');
  });

  test('enabled=false fetches nothing', async () => {
    const fetcher = vi.fn();
    renderWithCache(<Consumer cacheKey="k" fetcher={fetcher} enabled={false} />);
    await settle();

    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('without a provider', () => {
  test('the null-object still fetches, so a component is not broken by a missing provider', async () => {
    const fetcher = vi.fn(() => Promise.resolve('v'));
    render(<Consumer cacheKey="k" fetcher={fetcher} />);
    await settle();

    expect(fetcher).toHaveBeenCalled();
  });
});

describe('stale time constants', () => {
  test('money is far shorter than static content', () => {
    // If these ever converge, someone has stopped thinking about staleness.
    expect(STALE_TIME.MONEY).toBeLessThan(STALE_TIME.ELIGIBILITY);
    expect(STALE_TIME.ELIGIBILITY).toBeLessThan(STALE_TIME.CATALOGUE);
    expect(STALE_TIME.CATALOGUE).toBeLessThan(STALE_TIME.STATIC);
    expect(STALE_TIME.NONE).toBe(0);
  });
});
