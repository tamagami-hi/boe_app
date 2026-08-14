/**
 * Typed bootstrap/session state, shared by the client and admin providers.
 *
 * Both providers previously exposed a bare `isLoading` boolean, and every guard
 * turned that into `if (isLoading) return null` — a blank screen. Three different
 * situations were collapsed into one flag:
 *
 *   - the vault has not been read yet, so we genuinely do not know
 *   - we asked the server and there is no session
 *   - we asked and there is one
 *
 * With a status a guard can render a stable shell for the first case and go
 * straight to login for the second, instead of blanking for both.
 */

export const SESSION_STATUS = {
  /** First read of the vault plus the server probe. Nothing is known yet. */
  RESTORING: 'restoring',
  /** Settled: a valid principal for this scope. */
  AUTHENTICATED: 'authenticated',
  /** Settled: no session. Not an error — this is the normal pre-login state. */
  ANONYMOUS: 'anonymous',
};

export const initialSessionState = {
  status: SESSION_STATUS.RESTORING,
  user: null,
  /**
   * Set only when restore failed for a reason that is NOT "no session" — a
   * timeout, an offline device, a 5xx. Distinguishing this from ANONYMOUS is what
   * lets the UI say "we couldn't reach BeOnEdge" instead of silently showing a
   * login form as though the user had been signed out.
   */
  error: null,
  /** 'expired' once a previously valid session was invalidated. */
  endedReason: null,
};

export function authenticatedState(user) {
  return { status: SESSION_STATUS.AUTHENTICATED, user, error: null, endedReason: null };
}

export function anonymousState(error = null) {
  return { status: SESSION_STATUS.ANONYMOUS, user: null, error, endedReason: null };
}

// The session was valid and stopped being valid: the refresh token was rejected, so
// the transport cleared the vault. The sign-in screen says so rather than appearing
// for no reason.
export function expiredState() {
  return { status: SESSION_STATUS.ANONYMOUS, user: null, error: null, endedReason: 'expired' };
}

/**
 * True for a transport/server failure, false for "there is no session".
 *
 * `authApi.currentUser` rejects for both, so without this every backend outage looks
 * like a logout. It checked for codes 'TIMEOUT', 'NETWORK' and 'OFFLINE', and the
 * transport raises 'REQUEST_TIMEOUT' and 'NETWORK_UNAVAILABLE' — so it never fired
 * for either error it exists for, and a timed-out cold start showed a login form.
 */
export function isRestoreFailure(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'REQUEST_TIMEOUT' || code === 'NETWORK_UNAVAILABLE') return true;
  const status = Number(error.status || 0);
  return status >= 500;
}
