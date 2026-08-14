import { useLocation, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import I from '../components/I.jsx';
import '../styles/desktop/admin.css';
import '../styles/desktop/shell.css';

/**
 * Forbidden — an admin route the signed-in principal is not permitted to use.
 *
 * Distinct from Not Found on purpose. Those are different facts and collapsing
 * them wastes an operator's time: "this page does not exist" sends them looking
 * for a broken link, while "your role cannot open this page" tells them to ask for
 * access. Collapsing it into an empty list would be worse still, implying the data
 * is absent rather than withheld.
 *
 * Reachable by typing a URL, or by following a stale link or bookmark from when
 * the account had wider permissions. The sidebar hides these destinations, so this
 * is the direct-navigation case.
 *
 * This screen is presentation only. The backend enforces the same permission codes
 * on every request and is the actual authority; seeing this page means the API
 * would have answered 403 anyway.
 */
export default function Forbidden({ standalone = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const Heading = standalone ? 'h1' : 'h2';

  return (
    <div className="ash-page">
      <div className="ash-empty">
        <I icon={Lock} size={28} />
        <Heading className="ash-empty-title">Your role can&apos;t open this page</Heading>
        <p className="ash-empty-desc">
          This page needs permissions your admin account doesn&apos;t have. Ask an
          administrator to grant access if you need it.
        </p>
        <p className="ash-empty-desc">
          Requested page: <code>{location.pathname}</code>
        </p>
        <button
          type="button"
          className="ash-btn ash-btn-primary"
          onClick={() => navigate('/admin/overview', { replace: true })}
        >
          Go to Overview
        </button>
      </div>
    </div>
  );
}
