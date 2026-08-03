import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useSession } from '../store/SessionContext.jsx';
import { fetchKycStatus } from '../services/kycApi.js';

const KYC_LABEL = {
  approved: 'Verified',
  not_started: 'Not started',
  in_progress: 'Code sent',
  submitted: 'In review',
  in_review: 'In review',
  rejected: 'Not verified',
};

export default function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useSession();
  // The session principal does not carry KYC state, so read it from the source
  // rather than showing a stale badge.
  const [kyc, setKyc] = useState(null);

  useEffect(() => {
    fetchKycStatus()
      .then(setKyc)
      .catch(() => setKyc(null));
  }, []);

  async function onSignOut() { await logout(); navigate('/app/login'); }

  return (
    <div className="apk-screen">
      <h1 className="apk-h">Profile</h1>

      <div className="be-card apk-profile-id">
        <div className="apk-avatar">{user?.avatarInitials}</div>
        <div>
          <div className="apk-profile-name">{user?.name}</div>
          <div className="apk-profile-meta">{user?.email}</div>
          <div className="apk-profile-meta">{user?.phoneMasked}</div>
        </div>
      </div>

      <div className="be-eyebrow">Account</div>
      <div className="be-card be-card--flush">
        <Row label="Email" meta={user?.email || 'Not added'} />
        <Row label="Phone" meta={user?.phoneMasked || 'Not added'} />
      </div>

      <div className="be-eyebrow">Account Details</div>
      <div className="be-card be-card--flush">
        <Row
          label="KYC & Compliance"
          onClick={() => navigate('/app/profile/kyc')}
          meta={kyc === null ? undefined : KYC_LABEL[kyc.status] || kyc.status}
          badgeStatus={kyc?.status === 'approved' && kyc?.expired !== true ? 'active' : 'paused'}
        />
      </div>

      <div className="be-eyebrow">Settings</div>
      <div className="be-card be-card--flush">
        <Row label="Notifications" onClick={() => navigate('/app/notifications')} />
        <Row label="Security & PIN" onClick={() => navigate('/app/profile/security')} />
        <Row label="Statements" onClick={() => navigate('/app/statements')} />
        <Row label="Support" onClick={() => navigate('/app/profile/support')} />
        <Row label="Legal & disclosures" onClick={() => navigate('/app/profile/legal')} />
      </div>

      <button className="be-btn be-btn-danger be-btn-block" onClick={onSignOut}>Sign out</button>

      <div className="be-disclosure apk-profile-disclosure">
        BeOnEdge account access
      </div>
    </div>
  );
}

function Row({ label, meta, onClick, badgeStatus }) {
  return (
    <div className="apk-list-row" onClick={onClick}>
      <div>
        <div className="apk-list-l">{label}</div>
        {meta && <div className="apk-list-meta">{meta}</div>}
      </div>
      <div className="apk-list-r">
        {badgeStatus && (
          <span className={'be-badge ' + (badgeStatus === 'active' ? 'be-badge-active' : 'be-badge-paused')}>
            <span className="be-badge-dot" />{badgeStatus}
          </span>
        )}
        {onClick && <ChevronRight size={18} strokeWidth={1.5} />}
      </div>
    </div>
  );
}
