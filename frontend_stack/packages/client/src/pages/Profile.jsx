import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ListRow } from '@beonedge/shared';
import { useSession } from '../store/SessionContext.jsx';
import { fetchEmailVerificationStatus } from '../services/emailVerificationApi.js';
import { buildPath } from '../navigation/routes.js';

const EMAIL_VERIFICATION_LABEL = {
  verified: 'Verified',
  not_started: 'Not started',
  pending: 'Code sent',
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
  const [emailVerification, setEmailVerification] = useState(null);
  const [emailVerificationUnavailable, setEmailVerificationUnavailable] = useState(false);

  useEffect(() => {
    fetchEmailVerificationStatus()
      .then((next) => { setEmailVerification(next); setEmailVerificationUnavailable(false); })
      .catch(() => { setEmailVerification(null); setEmailVerificationUnavailable(true); });
  }, []);

  async function onSignOut() {
    await logout();
    navigate(buildPath('login'), { replace: true });
  }

  const emailVerificationApproved = emailVerification?.status === 'verified' && emailVerification?.expired !== true;

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
          to={buildPath('email_verification')}
          title="Email Verification"
          meta={emailVerificationUnavailable ? 'Status unavailable — tap to check' : emailVerification === null ? undefined : EMAIL_VERIFICATION_LABEL[emailVerification.status] || emailVerification.status}
          trailing={
            <>
              {emailVerification !== null && (
                <span className={'be-badge ' + (emailVerificationApproved ? 'be-badge-active' : 'be-badge-paused')}>
                  <span className="be-badge-dot" />{emailVerificationApproved ? 'active' : 'paused'}
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
