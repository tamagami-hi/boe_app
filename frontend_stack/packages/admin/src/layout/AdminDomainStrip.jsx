import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { canAccessItem, findNavDomain } from '../navigation/nav.js';

// The active domain's sibling destinations, on phone only.
//
// This is what makes the bottom bar's one-tap-to-domain work: the tab lands on the
// domain's first screen and this strip shows the two or three others beside it. No
// domain has more than four items, so it fits without the horizontal scrolling the
// old all-in-one bar needed.
//
// Renders nothing when the domain has a single destination — a strip of one is
// noise.
export default function AdminDomainStrip({ user }) {
  const location = useLocation();
  const domain = findNavDomain(location.pathname);

  const items = useMemo(
    () => (domain?.items || []).filter((item) => canAccessItem(user, item)),
    [domain, user],
  );

  if (items.length < 2) return null;

  return (
    <nav className="ash-dstrip" aria-label={`${domain.label} sections`}>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end
          className={({ isActive }) => `ash-dstrip-item ${isActive ? 'is-active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
