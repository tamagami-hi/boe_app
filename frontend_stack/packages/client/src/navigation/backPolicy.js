import { BACK_POLICY, HOME_PATH, findRouteMeta, parentPathOf } from './routes.js';

/**
 * Translates the client route manifest into the shape the native back coordinator
 * expects.
 *
 * Kept separate from `routes.js` so the manifest stays a plain data module with no
 * knowledge of the platform layer, and separate from the coordinator so the
 * coordinator stays target-neutral. This adapter is the only place that knows both.
 *
 * @param {{pathname: string}} context
 * @returns {{
 *   isTransactional: boolean, parentPath: string|null, isPrimary: boolean,
 *   isHome: boolean, isPublic: boolean, homePath: string
 * }}
 */
export function resolveClientBackPolicy({ pathname }) {
  const meta = findRouteMeta(pathname);

  // An unknown path (Not Found) has no parent and is not primary, so the
  // coordinator falls through to history-then-Home. That is the right answer: a
  // dead end should not pretend to belong somewhere in the hierarchy.
  if (!meta) {
    return {
      isTransactional: false,
      parentPath: null,
      isPrimary: false,
      isHome: false,
      isPublic: false,
      homePath: HOME_PATH,
    };
  }

  return {
    isTransactional: meta.isTransactional === true,
    // The concrete parent with params substituted, so `/app/invest/sip/f1` goes
    // back to `/app/funds/f1` rather than to a template.
    parentPath: parentPathOf(pathname),
    isPrimary: meta.backPolicy === BACK_POLICY.PRIMARY_TAB,
    isHome: meta.path === HOME_PATH,
    // Splash and login: nothing sits above them, so Back exits rather than
    // bouncing the user around the pre-auth screens.
    isPublic: meta.isPublic === true,
    homePath: HOME_PATH,
  };
}
