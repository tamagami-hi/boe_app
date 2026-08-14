import { findNavMeta } from './nav.js';

const ADMIN_HOME = '/admin/overview';

/**
 * Back policy for the admin console.
 *
 * Simpler than the client's because the admin IA is one level deep: every
 * destination is a domain screen reached from the sidebar, so there is no push
 * hierarchy to walk. The exceptions are the routed detail screens, which do have a
 * parent list.
 *
 * @param {{pathname: string}} context
 */
export function resolveAdminBackPolicy({ pathname }) {
  const meta = findNavMeta(pathname);
  const item = meta.item;

  // A routed detail (`/admin/users/directory/:userId`) matched its parent nav item
  // by prefix, so the pathname being longer than the item path is exactly the
  // signal that we are on a child screen. Back returns to the list.
  const isChildOfNavItem = Boolean(item) && pathname !== item.path && pathname.startsWith(`${item.path}/`);

  return {
    // Admin has no client-style transactional flows; its mutations are confirmed
    // in drawers, which the overlay stack already handles before this runs.
    isTransactional: false,
    parentPath: isChildOfNavItem ? item.path : null,
    // Every top-level admin destination behaves like a primary tab: Back goes to
    // Overview rather than replaying the order the operator visited screens in.
    isPrimary: Boolean(item),
    isHome: pathname === ADMIN_HOME,
    // Splash and login live above the admin router, in BrowserRoot, so they never
    // resolve to a nav item.
    isPublic: pathname === '/admin/splash' || pathname === '/admin/login',
    homePath: ADMIN_HOME,
  };
}
