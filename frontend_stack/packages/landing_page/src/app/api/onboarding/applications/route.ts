import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

// Server-side BFF for public onboarding. Translates the landing form into the
// canonical backend contract `POST /v1/applications` (spec 04 §3.1): it resolves
// the current terms + privacy consent versions from the backend, attaches an
// Idempotency-Key, and normalizes the phone to E.164. The browser never calls
// the backend directly, so there is no CORS dependency and the backend host
// stays private. The backend returns a generic 202 for both new and
// duplicate-active submissions (no enumeration), which this route preserves.
export const runtime = 'nodejs';

const BACKEND = (process.env.BEO_API_BASE || 'http://127.0.0.1:47502').replace(/\/$/, '');

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// Best-effort E.164 normalization. A leading '+' is kept as-is; a bare 10-digit
// number defaults to India (+91, matching this deployment); otherwise the digits
// are prefixed with '+'. The backend re-validates and rejects anything invalid.
const toE164 = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/[^\d]/gu, '')}`;
  const digits = trimmed.replace(/[^\d]/gu, '');
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
};

interface ConsentDocumentItem {
  readonly kind: string;
  readonly version: string;
}

const jsonError = (message: string, status: number): NextResponse =>
  NextResponse.json({ accepted: false, error: message }, { status });

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const fullName = asText(input.fullName) || asText(input.name);
  const email = asText(input.email).toLowerCase();
  const phone = asText(input.phone);
  const acceptedConsents = input.acceptedConsents === true;

  if (!fullName || !email || !phone) {
    return jsonError('Name, email, and phone are required.', 400);
  }
  if (!acceptedConsents) {
    return jsonError('You must accept the Terms of Service and Privacy Policy.', 400);
  }

  // Resolve the current consent versions the submission must reference.
  let consents: ReadonlyArray<{ kind: string; version: string; accepted: true }>;
  try {
    const docsResponse = await fetch(`${BACKEND}/v1/public/consent-documents`, { cache: 'no-store' });
    if (!docsResponse.ok) throw new Error('consent documents unavailable');
    const docsBody = (await docsResponse.json()) as { data?: { items?: readonly ConsentDocumentItem[] } };
    const items = docsBody.data?.items ?? [];
    const terms = items.find((item) => item.kind === 'terms');
    const privacy = items.find((item) => item.kind === 'privacy');
    if (terms === undefined || privacy === undefined) throw new Error('consent documents incomplete');
    consents = [
      { kind: 'terms', version: terms.version, accepted: true },
      { kind: 'privacy', version: privacy.version, accepted: true },
    ];
  } catch {
    return jsonError('Signup is temporarily unavailable. Please try again shortly.', 502);
  }

  const upstream = await fetch(`${BACKEND}/v1/applications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify({ fullName, email, phone: toE164(phone), consents }),
    cache: 'no-store',
  });

  if (upstream.status === 202) {
    return NextResponse.json({ accepted: true }, { status: 202 });
  }

  let message = 'We could not submit your application. Please check your details and try again.';
  try {
    const errorBody = (await upstream.json()) as { error?: { message?: string } } | null;
    if (typeof errorBody?.error?.message === 'string' && errorBody.error.message.length > 0) {
      message = errorBody.error.message;
    }
  } catch {
    /* keep the generic message */
  }
  return jsonError(message, upstream.status >= 400 && upstream.status < 500 ? 400 : 502);
}
