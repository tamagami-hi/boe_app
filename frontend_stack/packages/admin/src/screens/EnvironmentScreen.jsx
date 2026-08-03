import { useState, useEffect } from 'react';
import { Settings, Shield, AlertTriangle, CheckCircle2, Database, Server } from 'lucide-react';
import '../styles/desktop/admin.css';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import { apiRequest } from '@beonedge/client/services/_util.js';
import './admin-screens-shared.css';

function EnvironmentScreen() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  // Canonical `/v1/admin/app-config` payload: presentation, feature flags,
  // minimum supported versions, download links, and maintenance state.
  const flags = config?.config?.featureFlags || {};
  const minVersions = config?.config?.minimumSupportedVersion || {};
  const maintenance = config?.config?.maintenance || {};
  const checks = config ? [
    { label: 'App config version', value: config.version || '—', ok: !!config.version },
    { label: 'Published at', value: config.publishedAt ? String(config.publishedAt).slice(0, 19).replace('T', ' ') : '—', ok: !!config.publishedAt },
    { label: 'Feature flags', value: `${Object.keys(flags).length} flag(s)`, ok: Object.keys(flags).length > 0 },
    {
      label: 'Minimum app version',
      value: Object.entries(minVersions).map(([platform, version]) => `${platform} ${version}`).join(', ') || '—',
      ok: Object.keys(minVersions).length > 0,
    },
    { label: 'Maintenance mode', value: maintenance.enabled ? 'Enabled' : 'Off', ok: !maintenance.enabled },
  ] : [];

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Status" value={loading ? 'Loading...' : error ? 'Error' : 'OK'} />
        <StatTile label="Config version" value={config?.version || '—'} />
      </div>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">System</span>
            <h2 className="adm-card-title">Environment</h2>
          </div>
        </div>

        {loading && <div className="adm-skeleton">Loading environment config...</div>}
        {error && <div className="be-error adm-m-t-4 adm-m-b-2">{error}</div>}

        {!loading && !error && config && (
          <div className="adm-card-body">
            <h4 className="adm-section-title">Health checks</h4>
            <div className="adm-health-checks">
              {checks.map((c) => (
                <div key={c.label} className="adm-health-check">
                  <I icon={c.ok ? CheckCircle2 : AlertTriangle} size={16} className={c.ok ? 'adm-health-check-icon--ok' : 'adm-health-check-icon--warn'} />
                  <span className="adm-health-check-label">{c.label}</span>
                  <span className="adm-health-check-value">{c.value}</span>
                </div>
              ))}
            </div>

            <h4 className="adm-section-title adm-section-title--spaced">Raw config</h4>
            <pre className="adm-code-block adm-code-block--scroll">
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default EnvironmentScreen;
