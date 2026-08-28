// Notification deep-link validation (Task 5).
//
// `payload.deepLink` is authored server-side and used to be handed straight to
// React Router. A stale value looked to the user like the app restarting (it fell
// through the wildcard to splash); a hostile one could steer the app anywhere.
// Validation happens at the service edge so every consumer receives an
// already-safe value.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiRequestMock = vi.fn();

vi.mock('./_util.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiRequest: (...args) => apiRequestMock(...args),
  };
});

const { listNotifications } = await import('./notificationsApi.js');

function wireRow(deepLink) {
  return {
    id: 'n1',
    kind: 'payment',
    title: 'Payment received',
    body: 'Your instalment was received.',
    read: false,
    createdAt: '2026-02-01T10:00:00Z',
    payload: { deepLink },
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
});

async function deepLinkFor(value) {
  apiRequestMock.mockResolvedValue({ items: [wireRow(value)] });
  const [notification] = await listNotifications();
  return notification.deepLink;
}

describe('accepted deep links', () => {
  test('a known internal path is kept', async () => {
    expect(await deepLinkFor('/app/transactions')).toBe('/app/transactions');
  });

  test('a parameterised path is kept', async () => {
    expect(await deepLinkFor('/app/payment/pay_123')).toBe('/app/payment/pay_123');
  });

  test('a stable destination id resolves to its path', async () => {
    expect(await deepLinkFor('portfolio')).toBe('/app/portfolio');
  });

  test('query and hash are stripped rather than passed to the router', async () => {
    expect(await deepLinkFor('/app/transactions?tab=sip#top')).toBe('/app/transactions');
  });
});

describe('rejected deep links become null, not navigation', () => {
  const rejected = [
    '/app/orders',                 // never existed; the historical dead route
    '/investor-charter',           // missing the /app prefix
    '/admin/users/approvals',      // cross-scope
    'javascript:alert(1)',
    'data:text/html,<script>',
    '//evil.example/app/dashboard',
    'https://evil.example/phish',  // not an internal route
    'not_a_destination_id',
    '',
  ];

  for (const value of rejected) {
    test(`refuses ${JSON.stringify(value)}`, async () => {
      expect(await deepLinkFor(value)).toBeNull();
    });
  }

  test('a missing payload is null, not undefined', async () => {
    apiRequestMock.mockResolvedValue({ items: [{ id: 'n2', createdAt: 'x' }] });
    const [notification] = await listNotifications();
    expect(notification.deepLink).toBeNull();
  });
});

describe('the rest of the mapping is unchanged', () => {
  test('wire createdAt is exposed as ts and read is coerced', async () => {
    apiRequestMock.mockResolvedValue({ items: [wireRow('/app/portfolio')] });
    const [notification] = await listNotifications();

    expect(notification.ts).toBe('2026-02-01T10:00:00Z');
    expect(notification.read).toBe(false);
    expect(notification.title).toBe('Payment received');
  });
});
