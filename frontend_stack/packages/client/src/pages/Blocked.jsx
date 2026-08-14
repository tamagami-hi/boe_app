import React from 'react';
import { XCircle, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';

const COPY = {
  rejected: { Icon: XCircle, color: 'var(--be-red)', headline: 'This account needs support.', body: 'Contact support so we can help with this account.' },
  suspended: { Icon: Lock, color: 'var(--be-slate)', headline: 'Your account is currently suspended.', body: 'Investing is paused on this account. Contact support so we can help you restore access.' },
  closed: { Icon: Lock, color: 'var(--be-slate)', headline: 'This account is closed.', body: 'Reach out to support if this is unexpected.' },
};

export default function Blocked() {
  const navigate = useNavigate();
  const { user, logout } = useSession();
  const cfg = COPY[user?.status] || COPY.rejected;
  const Icon = cfg.Icon;
  const statusClass = user?.status || 'rejected';

  return (
    <div className="apk-blocked">
      <div className="be-card apk-blocked-card">
        <div className={`apk-blocked-icon is-${statusClass}`}>
          <Icon size={28} strokeWidth={1.5} />

        </div>

        <h2 className="apk-h-sm apk-blocked-title">{cfg.headline}</h2>

        <p className="apk-blocked-body">{cfg.body}</p>

        <div className="apk-blocked-actions">
          {user?.status === 'rejected' && (
            <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={() => navigate('/app/profile/support')}>Contact support</button>
          )}
          {(user?.status === 'suspended' || user?.status === 'closed') && (
            <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={() => navigate('/app/profile/support')}>Contact support</button>
          )}
          <button type="button" className="be-btn be-btn-ghost be-btn-block" onClick={async () => { await logout(); navigate('/app/login'); }}>Sign out</button>

        </div>

      </div>

    </div>
  );
}
