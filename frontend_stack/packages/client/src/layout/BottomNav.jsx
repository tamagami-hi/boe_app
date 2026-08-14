import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Compass, PieChart, Receipt, User } from 'lucide-react';
import { buildPath } from '../navigation/routes.js';

/**
 * Primary navigation.
 *
 * Two things were wrong here.
 *
 * 1. `role="tab"` on route links. ARIA tabs promise a specific keyboard contract —
 *    a `tablist` parent, arrow-key movement between tabs, `aria-selected`, and
 *    associated `tabpanel`s. None of that exists here, and none of it should:
 *    these are links that change the URL, not tabs that swap a panel. Announcing
 *    them as tabs told a screen-reader user to expect behaviour the app does not
 *    have. They are now plain links, with `aria-current="page"` marking the active
 *    one — which is also what the CSS already keyed off.
 *
 * 2. Every tap pushed a history entry. Switching Home → Explore → Portfolio →
 *    Home left four entries, so Android Back replayed a chronological trail of tabs
 *    instead of leaving the app. `replace` keeps top-level switching flat, and the
 *    back coordinator sends a non-Home tab to Home, which together give the
 *    behaviour Android users expect.
 *
 * Paths come from the route manifest so this list cannot drift from the routes that
 * actually exist.
 */
const tabs = [
  { to: buildPath('home'), label: 'Home', icon: Home },
  { to: buildPath('explore'), label: 'Explore', icon: Compass },
  { to: buildPath('portfolio'), label: 'Portfolio', icon: PieChart },
  { to: buildPath('activity'), label: 'Transactions', icon: Receipt },
  { to: buildPath('profile'), label: 'Profile', icon: User },
];

export default function BottomNav() {
  return (
    <nav className="apk-tabbar" aria-label="Primary">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          // Flat top-level switching: see the note above.
          replace
          className={({ isActive }) => 'apk-tab' + (isActive ? ' is-active' : '')}
          // `end` so a descendant route does not light up its ancestor tab. The
          // shell hides the bar on secondary screens anyway, but the active state
          // must be right for the moment before it does.
          end
        >
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
          {/* The visible label is the accessible name — no aria-label duplicating
              it, which produced a doubled announcement. */}
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
