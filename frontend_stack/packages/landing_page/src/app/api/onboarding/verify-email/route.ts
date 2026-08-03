import { NextRequest, NextResponse } from 'next/server';

// Server-side BFF for onboarding email verification. Translates the verification
// link into the canonical `POST /v1/applications/verify-email` (spec 04 §3.1):
// the single-use token moves the application from `pending_verification` to
// `submitted`, which is what puts it in the admin approval queue.
//
// The browser never calls the backend directly, so the backend host stays
// private and there is no CORS dependency. Canonical failures are distinct and
// preserved: 409 (already used), 410 (expired), 400 (malformed).
export const runtime = 'nodejs';

const BACKEND = (process.env.BEO_API_BASE || 'http://127.0.0.1:47502').replace(/\/$/, '');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const jsonError = (message: string, status: number, code?: string): NextResponse =>
  NextResponse.json({ verified: false, error: message, ...(code ? { code } : {}) }, { status });

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const token = typeof (body as { token?: unknown })?.token === 'string' ? (body as { token: string }).token : '';

  if (!TOKEN_PATTERN.test(token)) {
    return jsonError('This verification link is incomplete. Use the link from your email.', 400);
  }

  const upstream = await fetch(`${BACKEND}/v1/applications/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });

  if (upstream.ok) {
    return NextResponse.json({ verified: true }, { status: 200 });
  }

  let message = 'We could not verify your email. Request a new link and try again.';
  let code: string | undefined;
  try {
    const errorBody = (await upstream.json()) as { error?: { message?: string; code?: string } } | null;
    if (typeof errorBody?.error?.message === 'string' && errorBody.error.message.length > 0) {
      message = errorBody.error.message;
    }
    if (typeof errorBody?.error?.code === 'string') code = errorBody.error.code;
  } catch {
    /* keep the generic message */
  }
  return jsonError(message, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, code);
}
