import { useLocation, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import I from '../components/I.jsx';
// Mounted from two places: Admin.jsx's in-shell wildcard (where these sheets are
// already loaded by Admin.jsx) and BrowserRoot's top-level wildcard, which
// renders outside the Admin bundle entry and therefore outside those imports.
// Import them here so an unknown path is styled either way.
import '../styles/desktop/admin.css';
import '../styles/desktop/shell.css';

/**
 * NotFound — the recoverable state for a path that matches no admin route.
 *
 * Replaces a silent `<Navigate to="/admin/overview">`. That redirect was worse
 * than a dead end: an operator following a stale link landed on Overview and had
 * no way to tell whether the destination had moved, been retired, or never
 * existed. Retired routes in this console are explicit `Navigate` redirects, so
 * anything reaching here is genuinely unknown and should say so.
 *
 * @param {object} props
 * @param {boolean} [props.standalone] Rendered outside AdminShell (no TopBar),
 *   so this screen owns the page heading. Inside the shell the TopBar already
 *   provides the `h1`.
 */
export default function NotFound({ standalone = false }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Safe to show and the only thing that makes an operator's report actionable.
  // Query/hash are dropped: they are the part most likely to carry identifiers.
  const attemptedPath = location.pathname;
  const Heading = standalone ? 'h1' : 'h2';

  return (
    <div className="ash-page">
      <div className="ash-empty">
        <I icon={Compass} size={28} />
        <Heading className="ash-empty-title">This admin page doesn&apos;t exist</Heading>
        <p className="ash-empty-desc">
          The link may be out of date, or the page may have been retired. Nothing was changed.
        </p>
        <p className="ash-empty-desc">
          Attempted address: <code>{attemptedPath}</code>
        </p>
        <button
          type="button"
          className="ash-btn ash-btn-primary"
          onClick={() => navigate('/admin/overview', { replace: true })}
        >
          Go to Overview
        </button>
        <button
          type="button"
          className="ash-btn ash-btn-secondary"
          onClick={() => navigate(-1)}
        >
          Go back
        </button>
      </div>
    </div>
  );
}
