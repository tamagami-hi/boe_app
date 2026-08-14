import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ListRow } from '@beonedge/shared';
import { useSession } from '../store/SessionContext.jsx';
import { fetchKycStatus } from '../services/kycApi.js';
import { buildPath } from '../navigation/routes.js';

const KYC_LABEL = {
  approved: 'Verified',
  not_started: 'Not started',
  in_progress: 'Code sent',
  submitted: 'In review',
  in_review: 'In review',
  rejected: 'Not verified',
};

const SETTINGS = [
  { label: 'Notifications', to: buildPath('notifications') },
  { label: 'Security & PIN', to: buildPath('security') },
  { label: 'Statements', to: buildPath('statements') },
  { label: 'Support', to: buildPath('support') },
  { label: 'Legal & disclosures', to: buildPath('legal') },
];

const Chevron = <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />;

export default function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useSession();
  const [kyc, setKyc] = useState(null);
  const [kycUnavailable, setKycUnavailable] = useState(false);

  useEffect(() => {
    fetchKycStatus()
      .then((next) => { setKyc(next); setKycUnavailable(false); })
      .catch(() => { setKyc(null); setKycUnavailable(true); });
  }, []);

  async function onSignOut() {
    await logout();
    navigate(buildPath('login'), { replace: true });
  }

  const kycApproved = kyc?.status === 'approved' && kyc?.expired !== true;

  return (
    <div className="apk-screen">
      <h1 className="apk-h">Profile</h1>

      <div className="be-card apk-profile-id">
        <div className="apk-avatar" aria-hidden="true">{user?.avatarInitials}</div>

        <div>
          <div className="apk-profile-name">{user?.name}</div>

          <div className="apk-profile-meta">{user?.email}</div>

          <div className="apk-profile-meta">{user?.phoneMasked}</div>

        </div>

      </div>

      <div className="be-eyebrow">Account</div>

      <div className="be-card be-card--flush">
        <ListRow title="Email" meta={user?.email || 'Not added'} />

        <ListRow title="Phone" meta={user?.phoneMasked || 'Not added'} />

      </div>

      <div className="be-eyebrow">Account Details</div>

      <div className="be-card be-card--flush">
        <ListRow
          as={Link}
          to={buildPath('kyc')}
          title="KYC & Compliance"
          meta={kycUnavailable ? 'Status unavailable — tap to check' : kyc === null ? undefined : KYC_LABEL[kyc.status] || kyc.status}
          trailing={
            <>
              {kyc !== null && (
                <span className={'be-badge ' + (kycApproved ? 'be-badge-active' : 'be-badge-paused')}>
                  <span className="be-badge-dot" />{kycApproved ? 'active' : 'paused'}
                </span>
              )}
              {Chevron}
            </>
          }
        />

      </div>

      <div className="be-eyebrow">Settings</div>

      <div className="be-card be-card--flush">
        {SETTINGS.map((item) => (
          <ListRow key={item.to} as={Link} to={item.to} title={item.label} trailing={Chevron} />
        ))}
      </div>

      <button type="button" className="be-btn be-btn-danger be-btn-block" onClick={onSignOut}>
        Sign out
      </button>

      <div className="be-disclosure apk-profile-disclosure">
        BeOnEdge account access
      </div>

    </div>
  );
}
