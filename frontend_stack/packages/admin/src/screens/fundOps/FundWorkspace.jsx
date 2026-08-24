import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import I from '../../components/I.jsx';
import { Page } from '../../layout/primitives/index.js';
import StateBadge from '../../components/StateBadge.jsx';
import { parseFundDetail } from '../../data/fundContracts.js';
import { useSetPageHeading } from '../../layout/PageHeading.jsx';
import { fmtDateTime, fmtPaise, humanizeState } from '../../helpers/formatters.js';
import FundStockListPanel from '../FundStockListPanel.jsx';
import FundProfileForm from './FundProfileForm.jsx';
import {
  LIFECYCLE_CONSEQUENCES, STATE_DESCRIPTIONS, lifecycleActionsFor, profileFromDetail,
} from './fundOpsModel.js';
import '../admin-screens-shared.css';
import '../admin-aum.css';

const SECTIONS = [
  { id: 'profile', label: 'Published terms' },
  { id: 'stocks', label: 'Stock list' },
  { id: 'history', label: 'History' },
];

const SECTION_IDS = SECTIONS.map((section) => section.id);

const LIFECYCLE_LABELS = {
  published: 'Publish to clients',
  paused: 'Pause new investment',
  archived: 'Archive fund',
};

export default function FundWorkspace({ onPublishVersion, onLifecycle, canWrite = true }) {
  const { fundId } = useParams();
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
      setDetail(parseFundDetail(payload));
    } catch (readError) {
      setError(readError?.message || 'Could not read this fund.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => { void load(); }, [load]);

  const fund = detail?.fund || null;
  const versions = detail?.versions || [];
  const isArchived = fund?.status === 'archived';

  useSetPageHeading(fund?.name || '', fund?.name || '');

  function selectSection(next) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('section', next);
    setParams(nextParams, { replace: true });
  }

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
    setNotice('A new version is published. Clients on this fund see these terms now.');
    await load();
  });

  const changeState = (status) => run(async () => {
    await onLifecycle?.(fundId, status);
    setConfirming('');
    setNotice(`This fund is now ${humanizeState(status).toLowerCase()}.`);
    await load();
  });

  if (loading && !detail) {
    return (
      <Page maxWidth="960px">
        <div className="adm-card be-pad-5 be-stack-2">
          <Skeleton width="40%" height="1.5rem" />
          <Skeleton width="100%" height="3rem" count={3} />
        </div>
      </Page>
    );
  }

  if (error && !detail) {
    return (
      <Page maxWidth="960px">
        <div className="adm-validation-banner adm-validation-banner--error adm-validation-banner--start" role="alert">
          <I icon={AlertTriangle} size={14} /> {error}
        </div>
        <div className="adm-toolbar adm-toolbar--gap-2">
          <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={load}>
            <I icon={RefreshCw} size={13} /> Try again
          </button>
        </div>
        <Link className="be-btn be-btn-secondary be-btn-sm adm-back-link" to="/admin/funds">
          <I icon={ArrowLeft} size={14} /> Back to funds
        </Link>
      </Page>
    );
  }

  return (
    <Page>
      <Link className="be-btn be-btn-ghost be-btn-sm adm-back-link" to="/admin/funds">
        <I icon={ArrowLeft} size={14} /> Back to funds
      </Link>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">{fund?.slug}</span>
            <h2 className="adm-card-title">{fund?.name || 'Fund'}</h2>
            <div className="adm-card-sub">{STATE_DESCRIPTIONS[fund?.status] || ''}</div>
          </div>
          <div className="adm-card-actions">
            <StateBadge state={fund?.status} />
          </div>
        </div>

        <dl className="adm-decision-facts be-pad-5">
          <div>
            <dt>Published AUM</dt>
            <dd className="be-money">
              {fund?.aum?.aumPaise == null ? 'Not published' : fmtPaise(fund.aum.aumPaise)}
            </dd>
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

        {canWrite && !isArchived && (
          <div className="adm-toolbar adm-toolbar--bordered adm-toolbar--gap-2">
            {lifecycleActionsFor(fund?.status).map((status) => (
              <button
                key={status}
                type="button"
                className={`be-btn be-btn-sm ${status === 'archived' ? 'be-btn-danger' : 'be-btn-secondary'}`}
                onClick={() => setConfirming(status)}
                disabled={busy}
              >
                {LIFECYCLE_LABELS[status]}
              </button>
            ))}
          </div>
        )}

        {isArchived && (
          <div className="adm-inline-note" role="note">
            This fund is archived. Archiving is final: its terms, stock list and AUM can no longer
            change.
          </div>
        )}

        {confirming && (
          <div className="adm-decision adm-decision--inline" role="group" aria-label="Confirm the change">
            <p className="adm-decision-note">{LIFECYCLE_CONSEQUENCES[confirming]}</p>
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
                className={`be-btn adm-decision-btn ${confirming === 'archived' ? 'be-btn-danger' : 'be-btn-primary'}`}
                onClick={() => changeState(confirming)}
                disabled={busy}
              >
                {busy ? 'Applying…' : LIFECYCLE_LABELS[confirming]}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="adm-sticky-tabs">
        <div className="adm-chip-row" role="group" aria-label="Fund sections">
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
        canWrite && !isArchived ? (
          <FundProfileForm
            key={fund?.currentVersion ?? 'v0'}
            initial={profileFromDetail(detail)}
            mode="version"
            submitLabel="Publish new version"
            busy={busy}
            onSubmit={(payload) => publish(payload)}
          />
        ) : (
          <div className="adm-card">
            <div className="adm-card-head">
              <div>
                <h3 className="adm-card-title">Published terms</h3>
                <div className="adm-card-sub">
                  {isArchived
                    ? 'This fund is archived, so its terms are read-only.'
                    : 'You have read access to this fund. Publishing a version needs funds.write.'}
                </div>
              </div>
            </div>
            <dl className="adm-decision-facts be-pad-5">
              <div><dt>Name</dt><dd>{fund?.name || '—'}</dd></div>
              <div><dt>Category</dt><dd>{fund?.category ? humanizeState(fund.category) : '—'}</dd></div>
              <div><dt>Minimum SIP</dt><dd className="be-money">{fmtPaise(fund?.minimumSipPaise, 0)}</dd></div>
              <div><dt>Minimum one-time</dt><dd className="be-money">{fmtPaise(fund?.minimumPurchasePaise, 0)}</dd></div>
            </dl>
            {fund?.objective && <p className="be-pad-5 adm-text-sm">{fund.objective}</p>}
          </div>
        )
      )}

      {section === 'stocks' && (
        <FundStockListPanel
          fundId={fundId}
          initialStocks={Array.isArray(detail?.stocks) ? detail.stocks : null}
          canWrite={canWrite && !isArchived}
        />
      )}

      {section === 'history' && (
        <div className="adm-card adm-table">
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
    </Page>
  );
}
