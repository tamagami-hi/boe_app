import type { LandingConfig } from './landingDefaults';

const API_BASE = process.env.BEO_API_BASE || 'http://127.0.0.1:47502';

export async function fetchLandingConfig(): Promise<LandingConfig | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/public/landing-config`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const envelope = await res.json();
    if (!envelope?.ok || !envelope.data?.config) return null;
    return (envelope.data.config as LandingConfig) || null;
  } catch {
    return null;
  }
}
