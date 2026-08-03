import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLandingConfig } from './landingConfig';

describe('fetchLandingConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns config on success envelope', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { config: { hero: { title: 'Updated' } }, version: 6 },
      }),
    } as Response);
    const config = await fetchLandingConfig();
    expect(config?.hero?.title).toBe('Updated');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:47502/v1/public/landing-config',
      { cache: 'no-store' },
    );
  });

  it('returns null when backend returns 500', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const config = await fetchLandingConfig();
    expect(config).toBeNull();
  });

  it('returns null when envelope.ok is false', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'not found' }),
    } as Response);
    const config = await fetchLandingConfig();
    expect(config).toBeNull();
  });

  it('returns null when config is null (unpublished)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { config: null, published: false } }),
    } as Response);
    const config = await fetchLandingConfig();
    expect(config).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    const config = await fetchLandingConfig();
    expect(config).toBeNull();
  });
});
