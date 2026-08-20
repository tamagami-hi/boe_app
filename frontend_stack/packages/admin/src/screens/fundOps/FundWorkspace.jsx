import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import I from '../../components/I.jsx';
import StateBadge from '../../components/StateBadge.jsx';
import { fmtDateTime, fmtPaise, humanizeState } from '../../helpers/formatters.js';
import FundStockListPanel from '../FundStockListPanel.jsx';
import FundProfileForm from './FundProfileForm.jsx';
import {
  LIFECYCLE_ACTIONS, LIFECYCLE_CONSEQUENCES, STATE_DESCRIPTIONS, profileFromDetail,
} from './fundOpsModel.js';
import '../admin-screens-shared.css';

/*
 * One pool, one URL, one task at a time.
 *
 * The editor this replaces was a page-within-a-page: `editorOpen` state swapped the
 * whole screen, so the pool being edited had no address, Back left the console
 * rather than the editor, and a refresh dropped the operator back on the list. Its
 * five overlays (delete twice, lifecycle twice, preview once) were hand-rolled with
 * `onMouseDown` dismissal and no focus trap, body lock or Back registration.
 *
 * Sections are `?section=`, so a deep link opens the task the operator meant. The
 * two irreversible actions confirm INLINE, where the pool's name and state are
 * already on screen.
 */
const SECTIONS = [
  { id: 'profile', label: 'Published terms' },
  { id: 'stocks', label: 'Stock list' },
  { id: 'history', label: 'History' },
];

const SECTION_IDS = SECTIONS.map((section) => section.id);

export default function FundWorkspace({ onPublishVersion, onLifecycle, onDelete }) {
  const { fundId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = SECTION_IDS.includes(params.get('section')) ? params.get('section') : 'profile';

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState('');
  const actionLockRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, { scope: 'admin' });
      setDetail(payload?.data ?? payload ?? null);
    } catch (readError) {
      setError(readError?.message || 'Could not read this pool.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => { void load(); }, [load]);

  const fund = detail?.fund || null;
  const versions = detail?.versions || [];

  function selectSection(next) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('section', next);
    // No history entry per tab: Back should leave the pool, not walk its sections.
    setParams(nextParams, { replace: true });
  }

  // A ref lock, not `disabled={busy}`: setState is async, and both of these actions
  // are irreversible from here.
  async function run(action) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError?.message || 'The change was not applied.');
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }

  const publish = (payload) => run(async () => {
    await onPublishVersion?.(fundId, payload);
    setNotice('A new version is published. Clients see these terms now.');
    await load();
  });

  const changeState = (status) => run(async () => {
    await onLifecycle?.(fundId, status);
    setConfirming('');
    setNotice(`This pool is now ${status}.`);
    await load();
  });

  const remove = () => run(async () => {
    await onDelete?.(fundId);
    navigate('/admin/funds', { replace: true });
  });

  if (loading && !detail) {
    return (
      <div className="adm-screen adm-screen--narrow">
        <div className="adm-card be-pad-5 be-stack-2">
          <Skeleton width="40%" height="1.5rem" />
          <Skeleton width="100%" height="3rem" count={3} />
        </div>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="adm-screen adm-screen--narrow">
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" onClick={load}>
            <I icon={RefreshCw} size={13} /> Try again
          </button>
        </div>
        <Link className="be-btn be-btn-secondary be-btn-sm" to="/admin/funds">
          <I icon={ArrowLeft} size={14} /> Back to pools
        </Link>
      </div>
    );
  }

  return (
    <div className="adm-screen">
      <Link className="be-btn be-btn-ghost be-btn-sm" to="/admin/funds">
        <I icon={ArrowLeft} size={14} /> Back to pools
      </Link>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">{fund?.slug}</span>
            <h2 className="adm-card-title">{fund?.name || 'Fund pool'}</h2>
            <div className="adm-card-sub">{STATE_DESCRIPTIONS[fund?.status] || ''}</div>
          </div>
          <div className="adm-card-actions">
            <StateBadge state={fund?.status} />
          </div>
        </div>

        <dl className="adm-decision-facts be-pad-5">
          <div>
            <dt>Published AUM</dt>
            <dd className="be-money">{fmtPaise(fund?.aum?.aumPaise)}</dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>{fund?.aum?.asOfDate || 'Not published'}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{fund?.currentVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd>{fund?.riskLevel ? humanizeState(fund.riskLevel) : '—'}</dd>
          </div>
        </dl>

        {notice && <div className="adm-inline-note" role="status">{notice}</div>}
        {error && detail && (
          <div className="adm-validation-banner adm-validation-banner--error adm-validation-banner--inline" role="alert">
            <I icon={AlertTriangle} size={14} /> {error}
          </div>
        )}

        {/* Lifecycle. Only the three states `PATCH /v1/admin/funds/:id` accepts are
            offered; the old strip offered six, two of which the route rejects. */}
        <div className="adm-toolbar adm-toolbar--bordered adm-toolbar--gap-2">
          {LIFECYCLE_ACTIONS.filter((status) => status !== fund?.status).map((status) => (
            <button
              key={status}
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={() => setConfirming(status)}
              disabled={busy}
            >
              {status === 'published' ? 'Publish to clients' : `Move to ${status}`}
            </button>
          ))}
          <button
            type="button"
            className="be-btn be-btn-danger be-btn-sm"
            onClick={() => setConfirming('delete')}
            disabled={busy}
          >
            Archive and remove
          </button>
        </div>

        {confirming && (
          <div className="adm-decision adm-decision--inline" role="group" aria-label="Confirm the change">
            <p className="adm-decision-note">
              {confirming === 'delete'
                ? 'This removes the pool from the console. Investor positions and history are kept, but the pool cannot be published again.'
                : LIFECYCLE_CONSEQUENCES[confirming]}
            </p>
            <div className="adm-decision-actions">
              <button
                type="button"
                className="be-btn be-btn-secondary adm-decision-btn"
                onClick={() => setConfirming('')}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`be-btn adm-decision-btn ${confirming === 'delete' ? 'be-btn-danger' : 'be-btn-primary'}`}
                onClick={() => (confirming === 'delete' ? remove() : changeState(confirming))}
                disabled={busy}
              >
                {busy ? 'Applying…' : confirming === 'delete' ? 'Remove this pool' : `Confirm ${confirming}`}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="adm-sticky-tabs">
        <div className="adm-chip-row" role="group" aria-label="Pool sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-chip ${section === item.id ? 'is-active' : ''}`}
              aria-pressed={section === item.id}
              onClick={() => selectSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {section === 'profile' && (
        <FundProfileForm
          key={fund?.currentVersion ?? 'v0'}
          initial={profileFromDetail(detail)}
          submitLabel="Publish new version"
          busy={busy}
          onSubmit={(payload) => publish(payload)}
        />
      )}

      {section === 'stocks' && <FundStockListPanel fundId={fundId} />}

      {section === 'history' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Published versions</h3>
              <div className="adm-card-sub">Each version is immutable. The newest is what clients see.</div>
            </div>
          </div>
          <div className="be-pad-5">
            {versions.length === 0 ? (
              <p className="adm-cell-meta">No version has been published yet.</p>
            ) : (
              <ul className="adm-stream">
                {versions.map((version) => (
                  <li key={version.id || version.version} className="adm-list-item">
                    <div className="adm-list-item__header">
                      <span className="adm-list-item__title">Version {version.version}</span>
                      <span className="adm-cell-meta">{fmtDateTime(version.createdAt)}</span>
                    </div>
                    <div className="adm-list-item__body">
                      {version.name}
                      {version.riskLevel ? ` · ${humanizeState(version.riskLevel)} risk` : ''}
                      {version.minimumSipPaise ? ` · SIP from ${fmtPaise(version.minimumSipPaise, 0)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
