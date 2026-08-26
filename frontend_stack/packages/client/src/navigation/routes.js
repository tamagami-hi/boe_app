/**
 * Canonical client route manifest.
 *
 * Why this file exists: client paths were duplicated as raw strings across JSX,
 * notification payloads, disclosure documents and admin-published app config.
 * Each copy could drift independently, and two of them did — `/app/orders` was
 * navigated to by a button with no such route, and the disclosure defaults
 * pointed at `/investor-charter` without the `/app` prefix. Both presented to the
 * user as the app restarting itself.
 *
 * Two jobs:
 *   1. Describe every route once: its path, its stable destination id, its
 *      logical parent, and how the shell should dress it.
 *   2. Resolve an untrusted destination (a remote payload, a published config
 *      entry, a document link) into something typed and safe, or refuse it.
 *
 * Deliberately dependency-free — no react-router import — so services and the
 * admin publisher can validate against the same source of truth without pulling
 * in a router.
 */

/** How the shell dresses a route. */
export const APP_BAR_MODE = {
  /** No chrome at all: splash and login own the full screen. */
  NONE: 'none',
  /** Primary destination: identity/context header, bottom nav visible. */
  PRIMARY: 'primary',
  /** Pushed screen: back affordance and a title. */
  BACK: 'back',
};

/**
 * What Android Back should do from a route.
 * Applied by the back coordinator (a later task); declared here so the policy
 * lives with the route rather than inside each page.
 */
export const BACK_POLICY = {
  /** Non-Home primary tab returns to Home; Home exits per product policy. */
  PRIMARY_TAB: 'primaryTab',
  /** Pop to `parent` — used when the screen was launched directly. */
  PARENT: 'parent',
  /** Confirm before abandoning; completed flows are pruned from history. */
  TRANSACTIONAL: 'transactional',
  /** Public/pre-auth screens do not participate. */
  NONE: 'none',
};

/**
 * Every client route, exactly once.
 *
 * `destinationId` is the stable name remote payloads and published config should
 * use. Paths may be renamed; ids may not.
 *
 * `permissions` is present for shape-compatibility with the admin manifest and is
 * intentionally empty here: the client surface gates on session state and
 * server-derived eligibility, never on a permission list held by the browser.
 */
export const CLIENT_ROUTES = [
  /* -- public ------------------------------------------------------------- */
  {
    path: '/app/splash',
    destinationId: 'splash',
    parent: null,
    appBarMode: APP_BAR_MODE.NONE,
    primaryNavItem: null,
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.NONE,
    isPublic: true,
  },
  {
    path: '/app/login',
    destinationId: 'login',
    parent: null,
    appBarMode: APP_BAR_MODE.NONE,
    primaryNavItem: null,
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.NONE,
    isPublic: true,
  },

  /* -- primary destinations ---------------------------------------------- */
  {
    path: '/app/dashboard',
    destinationId: 'home',
    parent: null,
    appBarMode: APP_BAR_MODE.PRIMARY,
    primaryNavItem: 'home',
    showsBottomNav: true,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PRIMARY_TAB,
  },
  {
    path: '/app/explore',
    destinationId: 'explore',
    parent: null,
    appBarMode: APP_BAR_MODE.PRIMARY,
    primaryNavItem: 'explore',
    showsBottomNav: true,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PRIMARY_TAB,
  },
  {
    path: '/app/portfolio',
    destinationId: 'portfolio',
    parent: null,
    appBarMode: APP_BAR_MODE.PRIMARY,
    primaryNavItem: 'portfolio',
    showsBottomNav: true,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PRIMARY_TAB,
  },
  {
    path: '/app/transactions',
    destinationId: 'activity',
    parent: null,
    appBarMode: APP_BAR_MODE.PRIMARY,
    primaryNavItem: 'activity',
    showsBottomNav: true,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PRIMARY_TAB,
  },
  {
    path: '/app/profile',
    destinationId: 'profile',
    parent: null,
    appBarMode: APP_BAR_MODE.PRIMARY,
    primaryNavItem: 'profile',
    showsBottomNav: true,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PRIMARY_TAB,
  },

  /* -- secondary: under Home -------------------------------------------- */
  {
    path: '/app/notifications',
    destinationId: 'notifications',
    parent: '/app/dashboard',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'home',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },

  /* -- secondary: under Explore ----------------------------------------- */
  {
    path: '/app/funds/:fundId',
    destinationId: 'fund_detail',
    parent: '/app/explore',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'explore',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },

  // SIP plan detail. The path keeps its historical name for links already in
  // the wild, but the parameter is a SIP plan id and the screen is the
  // schedule/reminder plan view (spec §6.2 fallback — there is no mandate).
  {
    path: '/app/mandates/:mandateId',
    destinationId: 'mandate_detail',
    parent: '/app/portfolio',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'portfolio',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },

  /* -- secondary: under Profile ----------------------------------------- */
  {
    path: '/app/verify-email',
    destinationId: 'verify_email',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/profile/email-verification',
    destinationId: 'email_verification',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/profile/security',
    destinationId: 'security',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/statements',
    destinationId: 'statements',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/profile/support',
    destinationId: 'support',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
    // Reachable by a terminal (rejected/suspended/closed) account. Blocked.jsx
    // offers "Contact support", so this route must not be intercepted by the
    // shell's terminal-account branch. See ClientLayout.
    allowTerminalAccount: true,
  },
  {
    path: '/app/profile/legal',
    destinationId: 'legal',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/investor-charter',
    destinationId: 'investor_charter',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },
  {
    path: '/app/grievance',
    destinationId: 'grievance',
    parent: '/app/profile',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'profile',
    showsBottomNav: false,
    permissions: [],
    isTransactional: false,
    backPolicy: BACK_POLICY.PARENT,
  },

  /* -- transactional ----------------------------------------------------- */
  {
    path: '/app/invest/sip/:fundId',
    destinationId: 'invest_sip',
    parent: '/app/funds/:fundId',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'explore',
    showsBottomNav: false,
    permissions: [],
    isTransactional: true,
    backPolicy: BACK_POLICY.TRANSACTIONAL,
    requiresEligibility: true,
  },
  {
    path: '/app/invest/lumpsum/:fundId',
    destinationId: 'invest_lumpsum',
    parent: '/app/funds/:fundId',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'explore',
    showsBottomNav: false,
    permissions: [],
    isTransactional: true,
    backPolicy: BACK_POLICY.TRANSACTIONAL,
    requiresEligibility: true,
  },
  {
    path: '/app/payment/:paymentId',
    destinationId: 'payment_status',
    parent: '/app/transactions',
    appBarMode: APP_BAR_MODE.BACK,
    primaryNavItem: 'activity',
    showsBottomNav: false,
    permissions: [],
    isTransactional: true,
    backPolicy: BACK_POLICY.TRANSACTIONAL,
    requiresEligibility: true,
  },
];

/**
 * Compatibility aliases kept deliberately, not by accident.
 * Each one exists because a URL is already in the wild.
 */
export const CLIENT_ROUTE_ALIASES = {
  '/app/start': '/app/dashboard',
};

/** The path Not Found and "go home" recovery use. */
export const HOME_PATH = '/app/dashboard';

const ROUTES_BY_ID = new Map(CLIENT_ROUTES.map((route) => [route.destinationId, route]));

/* -------------------------------------------------------------------------- */
/* path matching                                                              */
/* -------------------------------------------------------------------------- */

function segmentsOf(path) {
  return String(path).split('/').filter(Boolean);
}

/**
 * Match a concrete pathname against one route template.
 * A `:param` segment matches exactly one non-empty segment, which is why a
 * missing id (`/app/funds/`) does not match and correctly falls through to Not
 * Found rather than rendering a detail screen with an undefined id.
 *
 * @returns {object|null} extracted params, or null when the template does not match
 */
function matchTemplate(template, pathname) {
  const templateParts = segmentsOf(template);
  const pathParts = segmentsOf(pathname);
  if (templateParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < templateParts.length; i += 1) {
    const templatePart = templateParts[i];
    const pathPart = pathParts[i];
    if (templatePart.startsWith(':')) {
      if (!pathPart) return null;
      params[templatePart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (templatePart !== pathPart) return null;
  }
  return params;
}

/**
 * Find the route that owns a pathname.
 * Static templates are preferred over parameterised ones so that, for example,
 * `/app/mandates/:mandateId` never shadows a future static sibling.
 *
 * @returns {{route: object, params: object}|null}
 */
export function matchClientRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname) return null;
  const bare = pathname.split('?')[0].split('#')[0];

  const isStatic = (route) => !route.path.includes(':');
  const ordered = [...CLIENT_ROUTES.filter(isStatic), ...CLIENT_ROUTES.filter((r) => !isStatic(r))];

  for (const route of ordered) {
    const params = matchTemplate(route.path, bare);
    if (params) return { route, params };
  }
  return null;
}

/** True when a pathname corresponds to a real route (alias-aware). */
export function isKnownClientPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const bare = pathname.split('?')[0].split('#')[0];
  if (CLIENT_ROUTE_ALIASES[bare]) return true;
  return matchClientRoute(bare) !== null;
}

/** Route metadata for a pathname, or null when unknown. */
export function findRouteMeta(pathname) {
  return matchClientRoute(pathname)?.route ?? null;
}

/**
 * Should the shell show the bottom navigation on this path?
 *
 * Replaces prefix matching, which was wrong in both directions: it kept the bar
 * on `/app/profile/email-verification|security|support|legal` (secondary screens) while hiding
 * it on Statements and Notifications, which sit at the same level of the same
 * hierarchy.
 */
export function showsBottomNav(pathname) {
  return findRouteMeta(pathname)?.showsBottomNav === true;
}

/** Logical parent for a pathname, substituting the concrete params back in. */
export function parentPathOf(pathname) {
  const match = matchClientRoute(pathname);
  if (!match?.route?.parent) return null;
  return fillTemplate(match.route.parent, match.params);
}

function fillTemplate(template, params = {}) {
  return segmentsOf(template)
    .map((part) => {
      if (!part.startsWith(':')) return part;
      const value = params[part.slice(1)];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Missing route param "${part.slice(1)}" for "${template}"`);
      }
      return encodeURIComponent(String(value));
    })
    .reduce((acc, part) => `${acc}/${part}`, '');
}

/**
 * Build a path from a stable destination id.
 * Params are URL-encoded here so call sites stop interpolating raw ids into
 * template strings.
 */
export function buildPath(destinationId, params = {}) {
  const route = ROUTES_BY_ID.get(destinationId);
  if (!route) throw new Error(`Unknown client destination id "${destinationId}"`);
  return fillTemplate(route.path, params);
}

/* -------------------------------------------------------------------------- */
/* destination resolution (the trust boundary)                                */
/* -------------------------------------------------------------------------- */

/** Result kinds, mirroring the plan's destination classification table. */
export const DESTINATION_KIND = {
  INTERNAL: 'internal',
  EXTERNAL: 'external',
  EMAIL: 'email',
  PHONE: 'phone',
  UNSAFE: 'unsafe',
};

// Schemes that must never reach a router, an anchor, or a system browser.
const DANGEROUS_SCHEME = /^(javascript|data|blob|vbscript|file):/i;

// Hosts that are the WebView's own content origin. A share or "open externally"
// target pointing here is meaningless outside the device and is treated as
// unsafe rather than silently opened.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function unsafe(value, reason) {
  return { kind: DESTINATION_KIND.UNSAFE, value, reason };
}

/**
 * Resolve an untrusted destination into a typed, safe result.
 *
 * Accepts, in order of preference:
 *   - a stable destination id      → 'internal'
 *   - an internal `/app/...` path matching the manifest → 'internal'
 *   - `https://host/...`           → 'external'
 *   - `mailto:` / `tel:`           → 'email' / 'phone'
 * Everything else is 'unsafe', including an internal-looking path that matches
 * no route. Callers must branch on `kind`; nothing here navigates.
 *
 * @param {unknown} value raw value from a notification payload, published config
 *   or content document
 * @param {object} [params] params for a destination id that needs them
 */
export function resolveDestination(value, params = {}) {
  if (typeof value !== 'string') return unsafe(value, 'not-a-string');

  const raw = value.trim();
  if (!raw) return unsafe(value, 'empty');

  if (DANGEROUS_SCHEME.test(raw)) return unsafe(raw, 'dangerous-scheme');

  // `//evil.example` is a protocol-relative URL: a browser treats it as another
  // origin while React Router would treat it as a path. Refuse the ambiguity.
  if (raw.startsWith('//')) return unsafe(raw, 'protocol-relative');

  // A bare destination id (no slash, no scheme).
  if (!raw.includes('/') && !raw.includes(':')) {
    const route = ROUTES_BY_ID.get(raw);
    if (!route) return unsafe(raw, 'unknown-destination-id');
    try {
      return { kind: DESTINATION_KIND.INTERNAL, path: buildPath(raw, params), route };
    } catch (err) {
      return unsafe(raw, 'missing-params');
    }
  }

  if (/^mailto:/i.test(raw)) {
    const email = raw.slice('mailto:'.length).split('?')[0];
    return email.includes('@')
      ? { kind: DESTINATION_KIND.EMAIL, email, url: raw }
      : unsafe(raw, 'invalid-email');
  }

  if (/^tel:/i.test(raw)) {
    const number = raw.slice('tel:'.length);
    return /^[+0-9()\s-]{3,}$/.test(number)
      ? { kind: DESTINATION_KIND.PHONE, number, url: raw }
      : unsafe(raw, 'invalid-phone');
  }

  if (/^https?:/i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return unsafe(raw, 'unparseable-url');
    }
    // http:// is refused outright: every distributed BOE endpoint is HTTPS, and
    // permitting cleartext here would undo the WebView policy work.
    if (url.protocol !== 'https:') return unsafe(raw, 'insecure-scheme');
    if (LOCAL_HOSTS.has(url.hostname)) return unsafe(raw, 'webview-local-origin');
    return { kind: DESTINATION_KIND.EXTERNAL, url: url.toString(), host: url.hostname };
  }

  // Anything else is treated as an internal path attempt.
  const alias = CLIENT_ROUTE_ALIASES[raw.split('?')[0].split('#')[0]];
  const candidate = alias || raw;
  const match = matchClientRoute(candidate);
  if (!match) return unsafe(raw, 'unknown-internal-path');

  // Re-derive the path from the manifest rather than trusting the input string,
  // so query/hash and odd encodings cannot ride along into the router.
  return {
    kind: DESTINATION_KIND.INTERNAL,
    path: fillTemplate(match.route.path, match.params),
    route: match.route,
  };
}

/** Convenience: the internal path, or null for anything not safely internal. */
export function resolveInternalPath(value, params = {}) {
  const result = resolveDestination(value, params);
  return result.kind === DESTINATION_KIND.INTERNAL ? result.path : null;
}
