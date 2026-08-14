// Whether the app can reach BeOnEdge, as a plain module store.
//
// The React provider's two "called by the request layer" entry points were never
// called: the transport is a plain module and cannot read a React context. So
// connectivity came only from navigator.onLine, and UNREACHABLE was unreachable.
// This store is the missing middle: the transport reports into it, the provider
// mirrors it, and shared components can read it without importing the app shell.

export const CONNECTIVITY = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  /** Interface up, API silent: captive portal, DNS failure, backend down. */
  UNREACHABLE: 'unreachable',
};

const listeners = new Set();

let state = {
  status: CONNECTIVITY.ONLINE,
  /** When the status last changed, not when it was last confirmed. */
  changedAt: 0,
  lastSuccessAt: null,
};

export function getConnectivity() {
  return state;
}

export function isDegraded() {
  return state.status !== CONNECTIVITY.ONLINE;
}

function emit() {
  for (const listener of listeners) listener(state);
}

export function setConnectivity(status, at = Date.now()) {
  if (!Object.values(CONNECTIVITY).includes(status)) return state;
  if (state.status === status) return state;
  state = { ...state, status, changedAt: at };
  emit();
  return state;
}

// `ok` means bytes came back. An HTTP 4xx/5xx counts: the server answered, so this
// is a server problem, not a connectivity one.
export function reportTransportOutcome(ok, at = Date.now()) {
  if (ok) {
    const changed = state.status !== CONNECTIVITY.ONLINE;
    state = {
      status: CONNECTIVITY.ONLINE,
      changedAt: changed ? at : state.changedAt,
      lastSuccessAt: at,
    };
    emit();
    return state;
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return setConnectivity(offline ? CONNECTIVITY.OFFLINE : CONNECTIVITY.UNREACHABLE, at);
}

export function subscribeToConnectivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam. */
export function resetConnectivity() {
  listeners.clear();
  state = { status: CONNECTIVITY.ONLINE, changedAt: 0, lastSuccessAt: null };
}
