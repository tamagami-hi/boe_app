import { useRef } from 'react';

/**
 * Idempotency keys for financial mutations, keyed by request body.
 *
 * The backend's idempotency contract: the same key with the same body replays the
 * original result; the same key with a different body is a 409 conflict. So the
 * rule here is the mirror image:
 *
 *   - retrying the SAME request reuses the key, making a user retry after a
 *     timeout safe (a duplicated financial commit costs real money);
 *   - any change to the body mints a fresh key, so an edit can never collide
 *     with the earlier attempt.
 *
 * `scope` distinguishes concurrent forms (e.g. one review panel per order).
 */
export function useIdempotencyKeys() {
  const entriesRef = useRef(new Map());

  return (scope, body) => {
    const serialized = JSON.stringify(body ?? null);
    const existing = entriesRef.current.get(scope);
    if (existing && existing.body === serialized) return existing.key;
    const key = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    entriesRef.current.set(scope, { body: serialized, key });
    return key;
  };
}
