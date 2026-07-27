// Application submission to the canonical backend, via the same-origin BFF
// (src/app/api/onboarding/applications/route.ts), which maps to
// POST /v1/applications (spec 04 §3.1: name/email/phone + accepted terms &
// privacy consents). The new onboarding model is application -> email verify ->
// admin approval -> activation invite; there is no self-service password signup.
// Errors are NOT swallowed - the UI surfaces err.message.

const ENDPOINT = '/api/onboarding/applications';

export interface ApplicationInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly acceptedConsents: boolean;
}

export interface ApplicationResult {
  readonly accepted: boolean;
}

export async function submitApplication(input: ApplicationInput): Promise<ApplicationResult> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      acceptedConsents: input.acceptedConsents === true,
    }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string; message?: string } | null)?.error ||
      (payload as { message?: string } | null)?.message ||
      'We could not submit your request. Please try again.';
    throw new Error(message);
  }

  return { accepted: (payload as { accepted?: boolean } | null)?.accepted === true };
}
