import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { fmtDateTime, fmtInt } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * The published app config, as the client will read it.
 *
 * These rows used to be called "health checks" and were derived from whether a
 * field was merely present, so an entirely healthy install showed warning
 * triangles: "0 flag(s)" raised one, and having no minimum version raised another
 * while a real missing minimum version is not something a triangle communicates.
 * They are facts about the published config now, and only two things are flagged:
 * maintenance mode being on, and no minimum supported version being set (which
 * disables the update gate).
 */
function EnvironmentScreen() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiRequest('/v1/admin/app-config', { scope: 'admin' })
      .then((data) => {
        if (!cancelled) setConfig(data?.data ?? data ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load config.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [attempt]);

  // Canonical `/v1/admin/app-config` payload: presentation, feature flags,
  // minimum supported versions, download links, and maintenance state.
  const flags = config?.config?.featureFlags || {};
  const minVersions = config?.config?.minimumSupportedVersion || {};
  const maintenance = config?.config?.maintenance || {};
  const versionText = Object.entries(minVersions)
    .map(([platform, version]) => `${platform} ${version}`)
    .join(', ');

  const facts = config ? [
    { label: 'Config version', value: config.version || 'Not published' },
    { label: 'Published', value: config.publishedAt ? fmtDateTime(config.publishedAt) : 'Not published' },
    { label: 'Feature flags', value: `${fmtInt(Object.keys(flags).length)} set` },
    {
      label: 'Minimum app version',
      value: versionText || 'Not set',
      warn: !versionText,
      note: 'With no minimum set, the app never asks anyone to update.',
    },
    {
      label: 'Maintenance mode',
      value: maintenance.enabled ? 'ON' : 'Off',
      warn: Boolean(maintenance.enabled),
      note: 'Clients are being shown the maintenance screen.',
    },
  ] : [];

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Config version" value={config?.version || '—'} />
        <StatTile label="Feature flags" value={fmtInt(Object.keys(flags).length)} />
      </div>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">System</span>
            <h2 className="adm-card-title">Environment</h2>
          </div>
          <div className="adm-card-actions">
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={reload} disabled={loading}>
              <I icon={RefreshCw} size={14} />
              {loading ? 'Reading…' : 'Re-read'}
            </button>
          </div>
        </div>

        <p className="adm-screen-note">
          This is the published configuration the client app reads. It is changed by publishing from
          the App Builder, not from here.
        </p>

        {loading && !config && (
          <div className="be-pad-5 be-stack-2">
            <Skeleton width="100%" height="2.5rem" count={5} />
          </div>
        )}

        {error && (
          <div className="ash-load-note" role="alert">
            <span>{error}</span>
            <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
              <I icon={RefreshCw} size={13} />
              {loading ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        )}

        {!loading && !error && config && (
          <div className="be-pad-5">
            <div className="adm-health-checks">
              {facts.map((fact) => (
                <div key={fact.label} className="adm-health-check">
                  <I
                    icon={fact.warn ? AlertTriangle : CheckCircle2}
                    size={16}
                    className={fact.warn ? 'adm-health-check-icon--warn' : 'adm-health-check-icon--ok'}
                  />
                  <span className="adm-health-check-label">{fact.label}</span>
                  <span className="adm-health-check-value">{fact.value}</span>
                  {fact.warn && fact.note && <span className="adm-cell-sub">{fact.note}</span>}
                </div>
              ))}
            </div>

            {/* The full payload is the source of truth and worth having, but it was
                400px of JSON above everything else. */}
            <details className="adm-m-t-4">
              <summary className="adm-section-title">Raw config payload</summary>
              <pre className="adm-code-block adm-code-block--scroll">
                {JSON.stringify(config, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

export default EnvironmentScreen;
