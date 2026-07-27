import { afterEach, describe, expect, test, vi } from 'vitest';

import { submitApplication } from './onboarding';

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('submitApplication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('posts the application to the onboarding BFF and returns accepted', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ accepted: true }, 202)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitApplication({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '9876543210',
      acceptedConsents: true,
    });

    expect(result.accepted).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/onboarding/applications');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '9876543210',
      acceptedConsents: true,
    });
  });

  test('throws with the server error message on failure', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: 'You must accept the Terms of Service and Privacy Policy.' }, 400)),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitApplication({ fullName: 'A', email: 'a@example.com', phone: '9876543210', acceptedConsents: false }),
    ).rejects.toThrow(/accept the Terms/u);
  });
});
