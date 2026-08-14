import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOverlayStack } from '@beonedge/shared/overlay/OverlayStackContext.jsx';

/**
 * The single owner of the Android hardware/gesture Back button.
 *
 * Before this, nothing listened for `backButton` at all, so Capacitor's default
 * applied: Back walked the WebView's history. That is browser behaviour, and it is
 * wrong in an app in specific, user-visible ways:
 *
 *   - Bottom sheets, drawers and confirmations are page state, so Back navigated
 *     the screen *underneath* an open overlay instead of closing it.
 *   - Every bottom-nav tap pushed a history entry, so Back replayed a chronological
 *     trail of tabs rather than returning to Home.
 *   - Completed payment and mandate flows pushed Home on top of themselves, so Back
 *     re-entered a finished transaction.
 *   - A screen opened directly from a notification had no history to pop, so Back
 *     exited the app.
 *
 * The priority order below is the fix, and the order is the whole design:
 *
 *   1. An open overlay closes. Always first — it is the thing in front of the user.
 *   2. A transactional route asks its owner what to do (confirm before abandoning).
 *   3. A secondary route goes to its declared parent, whether or not history has an
 *      entry for it.
 *   4. A non-Home primary tab returns to Home.
 *   5. At Home, the app exits — the Android convention.
 *
 * Route policy is injected rather than imported so this stays target-neutral: the
 * client passes its route manifest, the admin console passes its own rules, and
 * neither package leaks into the other.
 */

export const BACK_RESULT = {
  /** Handled here; do not let anything else act. */
  HANDLED: 'handled',
  /** Nothing to do at this level; try the next rule. */
  PASS: 'pass',
  /** Leave the app. */
  EXIT: 'exit',
};

/**
 * @param {object} props
 * @param {(context: {pathname: string}) => object} props.resolvePolicy
 *   Returns `{ isTransactional, parentPath, isPrimary, isHome, isPublic }` for a
 *   pathname. Supplied per build target.
 * @param {(context: {pathname: string}) => boolean} [props.onTransactionalBack]
 *   Chance for a transaction owner to intercept — return true if it handled Back
 *   (e.g. by showing "discard this?"). Defaults to allowing the normal parent pop.
 */
export default function NativeBackCoordinator({ resolvePolicy, onTransactionalBack }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { dismissTop } = useOverlayStack();

  // Everything the handler reads lives in refs. The Capacitor listener is
  // registered ONCE — re-registering it on every navigation risks either a window
  // with no listener at all or two listeners both acting on one press, and both
  // failure modes are hard to spot and awful to use.
  const stateRef = useRef({});
  stateRef.current = { navigate, location, dismissTop, resolvePolicy, onTransactionalBack };

  useEffect(() => {
    let active = true;
    let handle = null;

    function handleBack({ canGoBack } = {}) {
      const { navigate: go, location: loc, dismissTop: dismiss, resolvePolicy: resolve, onTransactionalBack: onTx } = stateRef.current;

      // 1. Overlays first, unconditionally.
      if (dismiss()) return;

      const pathname = loc?.pathname || '/';
      const policy = resolve?.({ pathname }) || {};

      // 2. A transaction may need to confirm before it is abandoned. Financial
      // flows must not be discarded by a stray gesture.
      if (policy.isTransactional && onTx?.({ pathname })) return;

      // 3. A secondary screen goes to its declared parent. Using the parent rather
      // than history is what makes a notification-opened screen behave: there is
      // nothing to pop, but there is always a logical place to go.
      if (policy.parentPath) {
        go(policy.parentPath, { replace: true });
        return;
      }

      // 4. A non-Home primary tab returns Home rather than replaying tab history.
      if (policy.isPrimary && !policy.isHome && policy.homePath) {
        go(policy.homePath, { replace: true });
        return;
      }

      // 5. At Home (or on a public screen with nowhere above it), leave the app —
      // the Android convention. `canGoBack` is consulted so a genuine in-app
      // history entry still wins over exiting.
      if (policy.isHome || policy.isPublic) {
        if (canGoBack) {
          go(-1);
          return;
        }
        App.exitApp().catch(() => {});
        return;
      }

      // Unknown route (Not Found, for instance): prefer history, then Home.
      if (canGoBack) {
        go(-1);
        return;
      }
      if (policy.homePath) go(policy.homePath, { replace: true });
    }

    Promise.resolve(App.addListener('backButton', handleBack))
      .then((nextHandle) => {
        // The component may have unmounted while the bridge was resolving.
        if (!active) {
          nextHandle?.remove?.();
          return;
        }
        handle = nextHandle;
      })
      .catch(() => {
        // No native bridge (browser build): the browser's own Back is correct there.
      });

    return () => {
      active = false;
      handle?.remove?.();
    };
    // Deliberately empty: registration must happen exactly once. All mutable
    // inputs are read through stateRef inside the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
