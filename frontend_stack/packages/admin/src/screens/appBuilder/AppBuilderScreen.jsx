import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  COMPONENT_LIBRARY,
  loadAppConfig,
  loadRemoteAppConfig,
  publishAppConfig,
  resetAppConfig,
} from '@beonedge/shared/appConfig.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import I from '../../components/I.jsx';
import { clone, csvNumbers } from '../../helpers/formatters.js';
import {
  COPY_SCREENS, MAX_QUICK_ACTIONS, QUICK_ACTION_DESTINATIONS, QUICK_ACTION_ICONS,
  SECTIONS, SECTION_IDS, copyLabel, isValidDestination, validateBuilderConfig,
} from './appBuilderModel.js';
import '../admin-screens-shared.css';

/*
 * One task per section, and an honest line about what leaves this browser.
 *
 * This was a 552-line single page holding every editor at once: nineteen component
 * toggles, thirty-seven copy strings, the shortcut list, the research rows, six
 * amount-preset fields and a full strategy-catalogue editor, in two columns that
 * become one very long column on a phone. Sections are `?section=` so a deep link
 * opens the task the operator meant.
 *
 * The important repair is not the layout, it is that a publish now round-trips —
 * see `fromCanonicalAppConfig` in shared/src/appConfig.js. Before it, every toggle
 * and every copy edit was written to the server and read back by nobody.
 */
export default function AppBuilderScreen() {
  const [config, setConfig] = useState(() => loadAppConfig());
  const [params, setParams] = useSearchParams();
  const section = SECTION_IDS.includes(params.get('section')) ? params.get('section') : 'components';
  const [screenId, setScreenId] = useState('dashboard');
  const [status, setStatus] = useState({ tone: '', message: '' });
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const publishLockRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadRemoteAppConfig({ admin: true })
      .then((remoteConfig) => {
        if (cancelled || !remoteConfig) return;
        setConfig(remoteConfig);
        setStatus({ tone: 'ok', message: 'Showing the published configuration.' });
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({
            tone: 'error',
            message: `Could not read the published configuration, so this is the draft held in this browser: ${error.message}`,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((updater) => {
    setStatus({ tone: '', message: '' });
    setProblems([]);
    setConfig((current) => {
      const next = clone(current);
      updater(next);
      return next;
    });
  }, []);

  function selectSection(next) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('section', next);
    setParams(nextParams, { replace: true });
  }

  // A ref lock, not `disabled={publishing}`: setState is async, and a double tap
  // would otherwise publish two versions, each retiring the last.
  async function publish() {
    if (publishLockRef.current) return;
    const found = validateBuilderConfig(config);
    setProblems(found);
    if (found.length > 0) {
      setStatus({ tone: 'error', message: 'Nothing was published. Fix the problems listed below.' });
      return;
    }
    publishLockRef.current = true;
    setPublishing(true);
    setStatus({ tone: '', message: 'Publishing…' });
    try {
      const next = await publishAppConfig(config);
      setConfig(next);
      setStatus({ tone: 'ok', message: 'Published. The app reads this on its next launch.' });
    } catch (error) {
      setStatus({ tone: 'error', message: `Publish failed, nothing changed: ${error.message}` });
    } finally {
      publishLockRef.current = false;
      setPublishing(false);
    }
  }

  /*
   * Discards local edits. Deliberately NOT a server-side revert: it clears the draft
   * held in this browser and returns the editor to the built-in defaults. Whatever
   * was last published stays published until Publish is pressed again.
   */
  function discard() {
    setConfig(resetAppConfig());
    setProblems([]);
    setStatus({ tone: 'ok', message: 'Local draft discarded. The published configuration is unchanged.' });
  }

  const screens = config.mobile.screens;
  const dashboard = screens.dashboard;

  function setComponentEnabled(targetScreen, componentId, enabled) {
    update((next) => {
      const target = next.mobile.screens[targetScreen];
      const existing = target.components.findIndex((item) => item.id === componentId);
      target.components = existing >= 0
        ? target.components.map((item, index) => (index === existing ? { ...item, enabled } : item))
        : [...target.components, { id: componentId, enabled }];
    });
  }

  function updateCopy(targetScreen, key, value) {
    update((next) => {
      next.mobile.screens[targetScreen].copy[key] = value;
    });
  }

  function updateAction(index, field, value) {
    update((next) => {
      next.mobile.screens.dashboard.quickActions = next.mobile.screens.dashboard.quickActions.map(
        (action, i) => (i === index ? { ...action, [field]: value } : action),
      );
    });
  }

  function addAction() {
    update((next) => {
      next.mobile.screens.dashboard.quickActions = [
        ...next.mobile.screens.dashboard.quickActions,
        {
          id: `action_${Date.now()}`,
          label: 'New shortcut',
          icon: 'Compass',
          route: QUICK_ACTION_DESTINATIONS[0]?.path || '/app/explore',
          enabled: true,
        },
      ];
    });
  }

  function removeAction(index) {
    update((next) => {
      next.mobile.screens.dashboard.quickActions =
        next.mobile.screens.dashboard.quickActions.filter((_, i) => i !== index);
    });
  }

  function updateAmounts(target, key, value) {
    update((next) => {
      next.mobile.screens.invest[target][key] = csvNumbers(value);
    });
  }

  function updateChartPeriods(value) {
    update((next) => {
      const charts = next.mobile.screens.fundDetail.charts || {};
      next.mobile.screens.fundDetail.charts = {
        ...charts,
        periods: value.split(',').map((item) => item.trim()).filter(Boolean),
      };
    });
  }

  return (
    <div className="adm-screen">
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Mobile app configuration</span>
            <h2 className="adm-card-title">App builder</h2>
            <div className="adm-card-sub">
              Component visibility, screen copy, shortcuts and amount presets are published to the
              app. The offline fixtures are not.
            </div>
          </div>
          <div className="adm-card-actions">
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={discard}
              disabled={publishing}
              title="Discard the draft in this browser. Does not change the published configuration."
            >
              <I icon={RotateCcw} size={14} /> Discard draft
            </button>
            <button
              type="button"
              className="be-btn be-btn-primary be-btn-sm"
              onClick={publish}
              disabled={publishing}
            >
              <I icon={Save} size={14} /> {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>

        {status.message && (
          <div
            className={status.tone === 'error' ? 'ash-load-note' : 'adm-inline-note'}
            role={status.tone === 'error' ? 'alert' : 'status'}
          >
            <span>{status.message}</span>
          </div>
        )}

        {problems.length > 0 && (
          <div className="adm-validation-banner adm-validation-banner--error adm-validation-banner--start adm-validation-banner--inline" role="alert">
            <I icon={AlertTriangle} size={14} />
            <div>
              <strong>These would ship a broken screen</strong>
              <ul className="adm-warning-list">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="adm-sticky-tabs">
        <div className="adm-chip-row" role="group" aria-label="Builder sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-chip ${section === item.id ? 'is-active' : ''}`}
              aria-pressed={section === item.id}
              onClick={() => selectSection(item.id)}
            >
              {item.label}
              {item.scope === 'local' && <span className="adm-sr-only"> (not published)</span>}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="adm-card be-pad-5 be-stack-2">
          <Skeleton width="100%" height="2.5rem" count={4} />
        </div>
      )}

      {!loading && section === 'components' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">What the app shows</h3>
              <div className="adm-card-sub">
                Turning a component off hides it for every client on their next launch.
              </div>
            </div>
            <div className="adm-filter">
              <span className="adm-sr-only">Screen</span>
              <select value={screenId} onChange={(event) => setScreenId(event.target.value)}>
                {COPY_SCREENS.map((screen) => (
                  <option key={screen.id} value={screen.id}>{screen.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="adm-component-list">
            {COMPONENT_LIBRARY[screenId].map((component) => {
              const enabled = screens[screenId].components
                .find((item) => item.id === component.id)?.enabled !== false;
              return (
                <div className="adm-component-row" key={component.id}>
                  <div>
                    <div className="adm-component-name">{component.label}</div>
                    <div className="adm-cell-meta">{component.description}</div>
                  </div>
                  {/* Was a Remove/Add button pair whose label described the action but
                      never the state, so the row read as a command, not a setting. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    className={`be-btn be-btn-sm ${enabled ? 'be-btn-secondary' : 'be-btn-ghost'}`}
                    onClick={() => setComponentEnabled(screenId, component.id, !enabled)}
                  >
                    {enabled ? 'Shown' : 'Hidden'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && section === 'copy' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Screen copy</h3>
              <div className="adm-card-sub">
                The words clients read. Empty copy is refused at publish, because a blank label ships
                a blank screen.
              </div>
            </div>
            <div className="adm-filter">
              <span className="adm-sr-only">Screen</span>
              <select value={screenId} onChange={(event) => setScreenId(event.target.value)}>
                {COPY_SCREENS.map((screen) => (
                  <option key={screen.id} value={screen.id}>{screen.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="adm-form-grid">
            {Object.entries(screens[screenId].copy || {}).map(([key, value]) => (
              <div className="adm-field adm-field-wide" key={key}>
                <label className="adm-field-label" htmlFor={`copy-${screenId}-${key}`}>
                  {copyLabel(key)}
                </label>
                <input
                  id={`copy-${screenId}-${key}`}
                  value={value}
                  maxLength={500}
                  onChange={(event) => updateCopy(screenId, key, event.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && section === 'shortcuts' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Home shortcuts</h3>
              <div className="adm-card-sub">
                The buttons under the portfolio card. Destinations come from the app&rsquo;s own route
                list, so a shortcut cannot point at a screen that does not exist.
              </div>
            </div>
          </div>
          <div className="adm-editor-list">
            {dashboard.quickActions.map((action, index) => (
              <div className="adm-editor-row" key={action.id}>
                <label className="adm-field">
                  <span className="adm-sr-only">Shortcut {index + 1} label</span>
                  <input
                    value={action.label}
                    onChange={(event) => updateAction(index, 'label', event.target.value)}
                  />
                </label>
                <label className="adm-field">
                  <span className="adm-sr-only">Shortcut {index + 1} destination</span>
                  <select
                    value={action.route}
                    onChange={(event) => updateAction(index, 'route', event.target.value)}
                  >
                    {/* A previously published value that is no longer valid stays
                        visible and marked, rather than being silently rewritten to
                        whatever happens to be first in the list. */}
                    {!isValidDestination(action.route) && (
                      <option value={action.route}>{action.route || '—'} (not a destination)</option>
                    )}
                    {QUICK_ACTION_DESTINATIONS.map((destination) => (
                      <option key={destination.path} value={destination.path}>{destination.label}</option>
                    ))}
                  </select>
                </label>
                <label className="adm-field">
                  <span className="adm-sr-only">Shortcut {index + 1} icon</span>
                  <select
                    value={action.icon}
                    onChange={(event) => updateAction(index, 'icon', event.target.value)}
                  >
                    {QUICK_ACTION_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={action.enabled !== false}
                  className={`be-btn be-btn-sm ${action.enabled !== false ? 'be-btn-secondary' : 'be-btn-ghost'}`}
                  onClick={() => updateAction(index, 'enabled', action.enabled === false)}
                >
                  {action.enabled !== false ? 'Shown' : 'Hidden'}
                </button>
                <button
                  type="button"
                  className="be-btn be-btn-ghost be-btn-sm"
                  onClick={() => removeAction(index)}
                >
                  <I icon={Trash2} size={14} />
                  <span className="adm-sr-only">Remove shortcut {index + 1}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="adm-toolbar adm-toolbar--bordered adm-toolbar--gap-2">
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={addAction}
              disabled={dashboard.quickActions.length >= MAX_QUICK_ACTIONS}
            >
              <I icon={Plus} size={14} /> Add shortcut
            </button>
            <span className="adm-cell-meta">
              {dashboard.quickActions.length} of {MAX_QUICK_ACTIONS}
            </span>
          </div>
        </div>
      )}

      {!loading && section === 'amounts' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Amounts and periods</h3>
              <div className="adm-card-sub">
                Comma-separated. These are the presets and chart periods the investment screens offer;
                they do not change any minimum, which comes from the pool itself.
              </div>
            </div>
          </div>
          <div className="adm-form-grid">
            <div className="adm-field">
              <label className="adm-field-label" htmlFor="sip-presets">SIP amount presets (₹)</label>
              <input
                id="sip-presets"
                value={(screens.invest.sip.amountPresets || []).join(', ')}
                onChange={(event) => updateAmounts('sip', 'amountPresets', event.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-field-label" htmlFor="sip-durations">SIP durations (months)</label>
              <input
                id="sip-durations"
                value={(screens.invest.sip.durationMonths || []).join(', ')}
                onChange={(event) => updateAmounts('sip', 'durationMonths', event.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-field-label" htmlFor="sip-debit-days">Debit days</label>
              <input
                id="sip-debit-days"
                value={(screens.invest.sip.debitDays || []).join(', ')}
                onChange={(event) => updateAmounts('sip', 'debitDays', event.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-field-label" htmlFor="onetime-presets">One-time presets (₹)</label>
              <input
                id="onetime-presets"
                value={(screens.invest.oneTime.amountPresets || []).join(', ')}
                onChange={(event) => updateAmounts('oneTime', 'amountPresets', event.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-field-label" htmlFor="chart-periods">Fund chart periods</label>
              <input
                id="chart-periods"
                value={(screens.fundDetail.charts?.periods || []).join(', ')}
                onChange={(event) => updateChartPeriods(event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {!loading && section === 'fixtures' && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Offline fixtures</h3>
              <div className="adm-card-sub">
                This browser only, and never published.
              </div>
            </div>
          </div>
          <div className="be-pad-5 be-stack-3">
            {/*
              The old screen presented this as "Strategy content" beside the publish
              button — a full editor for name, tagline, objective, risk, minimums,
              allocation rows and exposure rows. None of it is publishable: the
              canonical config schema is strict and rejects catalogue data, and the
              client reads funds from `/v1/client/funds`. Its only real use is the
              fixture path in `fundsApi`, which serves these rows when the app runs
              without a backend.
            */}
            <p className="adm-screen-note">
              These {config.mobile.products.length} strategy fixtures and{' '}
              {config.mobile.researchContext.length} research rows are what the app shows when it runs
              without a backend. A pool that clients can actually see is created and published under
              Fund operations, not here.
            </p>
            <ul className="adm-stream">
              {config.mobile.products.map((product) => (
                <li key={product.id} className="adm-list-item">
                  <div className="adm-list-item__header">
                    <span className="adm-list-item__title">{product.name}</span>
                    <span className="adm-cell-meta">{product.status}</span>
                  </div>
                  <div className="adm-list-item__body">{product.tagline}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
