import { useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { AdaptiveDialog } from '@beonedge/shared';
import { domainEntryPath, findNavDomain, mobileNavModel } from '../navigation/nav.js';
import I from '../components/I.jsx';

// The phone bottom bar: three domain entries plus More.
//
// It replaces a single horizontally scrolling strip that held all 13 destinations
// at 40px targets — an operator had to scroll a bar whose end was off-screen to
// find a screen, and the signed-in user chip was one of the things they scrolled
// past. Here the primary domains are always visible at a full 48px, and the rest
// live in a labelled hub.
//
// Tapping a domain goes straight to its first destination rather than opening a
// menu: this is a high-frequency console, so the common case must stay one tap.
// AdminDomainStrip then exposes that domain's siblings.

export default function AdminMobileNav({ user, counts = {} }) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { primary, more } = useMemo(() => mobileNavModel(user), [user]);
  const activeDomain = findNavDomain(location.pathname);
  const moreHoldsActive = more.some((domain) => domain.id === activeDomain?.id);

  const badgeFor = (domain) => domain.items.reduce(
    (total, item) => total + (item.badge ? Number(counts[item.badge]) || 0 : 0),
    0,
  );

  return (
    <>
      <nav className="ash-mnav" aria-label="Admin sections">
        {primary.map((domain) => {
          const count = badgeFor(domain);
          return (
            /* A plain Link, not a NavLink: "active" here is DOMAIN-level, so a
               tab must stay current on any destination inside it. NavLink also
               writes its own aria-current AFTER the spread props, which silently
               overwrote the domain-level one with undefined. */
            <Link
              key={domain.id}
              to={domainEntryPath(domain)}
              className={`ash-mnav-item ${activeDomain?.id === domain.id ? 'is-active' : ''}`}
              aria-current={activeDomain?.id === domain.id ? 'page' : undefined}
            >
              <span className="ash-mnav-icon" aria-hidden="true">
                <I icon={domain.mobile.icon} size={18} />
              </span>
              <span className="ash-mnav-label">{domain.mobile.shortLabel}</span>
              {count > 0 && <span className="ash-mnav-count">{count}</span>}
            </Link>
          );
        })}

        {more.length > 0 && (
          <button
            type="button"
            className={`ash-mnav-item ${moreHoldsActive ? 'is-active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className="ash-mnav-icon" aria-hidden="true">
              <I icon={MoreHorizontal} size={18} />
            </span>
            <span className="ash-mnav-label">More</span>
          </button>
        )}
      </nav>

      {/* The domain hub. AdaptiveDialog gives the portal, focus trap, body lock and
          Android Back registration, so this sheet closes on Back instead of
          navigating the console underneath it. */}
      <AdaptiveDialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="All sections"
      >
        <div className="ash-hub">
          {more.map((domain) => (
            <section key={domain.id} className="ash-hub-group">
              <h3 className="ash-hub-group-label">{domain.label}</h3>
              {domain.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `ash-hub-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  {item.icon && <I icon={item.icon} size={16} />}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </section>
          ))}
        </div>
      </AdaptiveDialog>
    </>
  );
}
