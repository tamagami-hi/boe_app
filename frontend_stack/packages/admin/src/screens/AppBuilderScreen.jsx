import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  UserCheck, ShieldCheck, LineChart, Layers, TrendingUp, PieChart,
  CreditCard, Repeat, BookOpen, Inbox, LifeBuoy, History, Settings,
  Search, Bell, Plus, MoreHorizontal, LayoutGrid, Trash2, Save, RotateCcw, LogOut,
  X, CheckCircle2, XCircle, Clock, Timer, TrendingDown, Filter, User, Mail, Phone, Shield, FileText,
  BarChart3, Activity, Eye, EyeOff, AlertTriangle, Pencil, Gauge, Percent, Briefcase, Archive, ChevronRight, ClipboardList, ArrowLeft,
  Copy,
} from 'lucide-react';
import {
  RiskBadge, LifecycleBadge, StatusBadge,
} from '@beonedge/shared/components/Badges.jsx';
import { SectorMiniBar } from '@beonedge/shared/components/SectorMiniBar.jsx';

import logo from '@beonedge/shared/assets/logo.svg';
import {
  COMPONENT_LIBRARY,
  loadRemoteAppConfig,
  loadAppConfig,
  publishAppConfig,
  resetAppConfig,
} from '@beonedge/shared/appConfig.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { apiRequest, listFromPayload, useHttpApi } from '@beonedge/client/services/_util.js';
import { listPendingApprovals } from '@beonedge/client/services/authApi.js';
import '../styles/desktop/admin.css';
import I from '../components/I.jsx';
import { clone } from '../helpers/formatters.js';
import { csvNumbers } from '../helpers/formatters.js';


import { SCREEN_LABELS } from '../helpers/titles.js';
import './admin-screens-shared.css';

function AppBuilderScreen() {
  const [config, setConfig] = useState(() => loadAppConfig());
  const [screenId, setScreenId] = useState('dashboard');
  const [selectedProductId, setSelectedProductId] = useState(config.mobile.products[0]?.id || '');
  const [saved, setSaved] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const tabRefs = useRef([]);

  const selectedProduct = config.mobile.products.find((product) => product.id === selectedProductId) || config.mobile.products[0];
  const screen = config.mobile.screens[screenId];

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    loadRemoteAppConfig({ admin: true }).then((remoteConfig) => {
      if (cancelled || !remoteConfig) return;
      setConfig(remoteConfig);
      setSelectedProductId(remoteConfig.mobile.products[0]?.id || '');
      setSaved('Loaded backend-published app configuration.');
    }).catch((error) => {
      if (!cancelled) setSaved(`Using local draft config. Backend read failed: ${error.message}`);
    }).finally(() => {
      if (!cancelled) setLoadingConfig(false);
    });

    return () => { cancelled = true; };
  }, []);

  function updateConfig(updater) {
    setSaved('');
    setConfig((current) => {
      const next = clone(current);
      updater(next);
      return next;
    });
  }

  async function publish() {
    setSaved('Publishing configuration...');
    try {
      const next = await publishAppConfig(config);
      setConfig(next);
      setSelectedProductId(next.mobile.products.find((product) => product.id === selectedProductId)?.id || next.mobile.products[0]?.id || '');
      setSaved('Published to active data store.');
    } catch (error) {
      setSaved(`Publish failed: ${error.message}`);
    }
  }

  /*
   * Discards local edits. This is deliberately NOT a server-side revert: it
   * clears the draft held in this browser and returns the editor to the built-in
   * defaults. Whatever was last published stays published until Publish is
   * pressed again, so the label and the note both say "draft" rather than
   * implying the live config was rolled back.
   */
  function reset() {
    const next = resetAppConfig();
    setConfig(next);
    setSelectedProductId(next.mobile.products[0]?.id || '');
    setSaved('Local draft discarded. The published configuration is unchanged.');
  }

  function setComponentEnabled(targetScreen, componentId, enabled) {
    updateConfig((next) => {
      const screen = next.mobile.screens[targetScreen];
      const components = screen.components;
      const existingIndex = components.findIndex((item) => item.id === componentId);
      const nextComponents = existingIndex >= 0
        ? components.map((item, index) => (index === existingIndex ? { ...item, enabled } : item))
        : [...components, { id: componentId, enabled }];
      next.mobile.screens[targetScreen] = { ...screen, components: nextComponents };
    });
  }

  function updateScreenCopy(key, value) {
    updateConfig((next) => {
      const screen = next.mobile.screens[screenId];
      next.mobile.screens[screenId] = { ...screen, copy: { ...screen.copy, [key]: value } };
    });
  }

  function updateDashboardAction(index, field, value) {
    updateConfig((next) => {
      const dashboard = next.mobile.screens.dashboard;
      next.mobile.screens.dashboard = {
        ...dashboard,
        quickActions: dashboard.quickActions.map((action, i) =>
          i === index ? { ...action, [field]: value } : action
        ),
      };
    });
  }

  function addDashboardAction() {
    updateConfig((next) => {
      const dashboard = next.mobile.screens.dashboard;
      next.mobile.screens.dashboard = {
        ...dashboard,
        quickActions: [
          ...dashboard.quickActions,
          {
            id: `action_${Date.now()}`,
            label: 'New action',
            icon: 'Compass',
            route: '/app/explore',
            enabled: true,
          },
        ],
      };
    });
  }

  function removeDashboardAction(index) {
    updateConfig((next) => {
      const dashboard = next.mobile.screens.dashboard;
      next.mobile.screens.dashboard = {
        ...dashboard,
        quickActions: dashboard.quickActions.filter((_, i) => i !== index),
      };
    });
  }

  function updateProduct(field, value) {
    updateConfig((next) => {
      next.mobile.products = next.mobile.products.map((product) =>
        product.id === selectedProduct.id ? { ...product, [field]: value } : product
      );
    });
  }

  function updateProductNumber(field, value) {
    updateProduct(field, value === '' ? null : Number(value));
  }

  function updateProductList(listName, index, field, value) {
    const nextValue = field === 'pct' ? (value === '' ? null : Number(value)) : value;
    updateConfig((next) => {
      next.mobile.products = next.mobile.products.map((product) =>
        product.id === selectedProduct.id
          ? { ...product, [listName]: product[listName].map((row, i) => (i === index ? { ...row, [field]: nextValue } : row)) }
          : product
      );
    });
  }

  function addProductListItem(listName, item) {
    updateConfig((next) => {
      next.mobile.products = next.mobile.products.map((product) =>
        product.id === selectedProduct.id
          ? { ...product, [listName]: [...product[listName], item] }
          : product
      );
    });
  }

  function removeProductListItem(listName, index) {
    updateConfig((next) => {
      next.mobile.products = next.mobile.products.map((product) =>
        product.id === selectedProduct.id
          ? { ...product, [listName]: product[listName].filter((_, i) => i !== index) }
          : product
      );
    });
  }

  function addProduct() {
    const id = `product_${Date.now()}`;
    const newProduct = {
      id,
      name: 'New BeOnEdge Strategy',
      tagline: 'Configure this strategy before publishing.',
      objective: 'Configure objective from the admin panel.',
      categoryEyebrow: 'BeOnEdge strategy',
      status: 'coming_soon',
      riskLabel: 'moderate',
      minSip: null,
      minLumpsum: null,
      minDurationMonths: null,
      lockInText: 'Configured before launch',
      allocation: [],
      topHoldings: [],
      disclosureVersion: 'draft',
      methodology: 'Pending publication.',
      fees: [],
      horizon: '3 yr+',
    };
    updateConfig((next) => {
      next.mobile.products = [...next.mobile.products, newProduct];
    });
    setSelectedProductId(id);
  }

  function removeProduct() {
    const remaining = config.mobile.products.filter((product) => product.id !== selectedProduct.id);
    const fallback = remaining[0] || {
      id: `product_${Date.now()}`,
      name: 'New BeOnEdge Strategy',
      tagline: 'Configure this strategy before publishing.',
      objective: 'Configure objective from the admin panel.',
      categoryEyebrow: 'BeOnEdge strategy',
      status: 'coming_soon',
      riskLabel: 'moderate',
      minSip: null,
      minLumpsum: null,
      minDurationMonths: null,
      lockInText: 'Configured before launch',
      allocation: [],
      topHoldings: [],
      disclosureVersion: 'draft',
      methodology: 'Pending publication.',
      fees: [],
      horizon: '3 yr+',
    };

    updateConfig((next) => {
      next.mobile.products = remaining.length > 0 ? remaining : [fallback];
    });
    // Fallback is already a fresh object; selectedProductId must follow the new reference.
    setSelectedProductId(fallback.id);
  }

  function updateResearch(index, field, value) {
    updateConfig((next) => {
      next.mobile.researchContext = next.mobile.researchContext.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      );
    });
  }

  function addResearchRow() {
    updateConfig((next) => {
      next.mobile.researchContext = [
        ...next.mobile.researchContext,
        { label: 'New allocation row', value: '0%', note: 'Admin configured.' },
      ];
    });
  }

  function removeResearchRow(index) {
    updateConfig((next) => {
      next.mobile.researchContext = next.mobile.researchContext.filter((_, i) => i !== index);
    });
  }

  function updateArraySetting(section, key, value) {
    updateConfig((next) => {
      const target = next.mobile.screens.invest[section];
      next.mobile.screens.invest[section] = { ...target, [key]: csvNumbers(value) };
    });
  }

  return (
    <div className="adm-screen">
      <div className="adm-builder-head">
        <div>
          <span className="be-eyebrow">Mobile app configuration</span>
          <h2 className="adm-card-title">Control app components, charts, and Explore content</h2>
        </div>
        <div className="adm-card-actions">
          {(loadingConfig || saved) && <span className="adm-save-note">{loadingConfig ? 'Loading backend config...' : saved}</span>}
          <button
            className="be-btn be-btn-secondary be-btn-sm"
            onClick={reset}
            title="Discard the draft in this browser. Does not change the published configuration."
          >
            <I icon={RotateCcw} size={14}/>Discard draft
          </button>
          <button className="be-btn be-btn-primary be-btn-sm" onClick={publish}><I icon={Save} size={14}/>Publish config</button>
        </div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <span className="be-eyebrow">Add or remove</span>
              <h2 className="adm-card-title">App components</h2>
            </div>
            <div className="adm-builder-tabs" role="tablist" aria-label="App screens">
              {Object.entries(SCREEN_LABELS).map(([id, label], index, entries) => {
                const isActive = screenId === id;
                function handleTabKey(event) {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    const delta = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (index + delta + entries.length) % entries.length;
                    const nextId = entries[nextIndex][0];
                    setScreenId(nextId);
                    tabRefs.current[nextIndex]?.focus();
                  }
                }
                return (
                  <button
                    key={id}
                    ref={(el) => { tabRefs.current[index] = el; }}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={isActive ? 'is-active' : ''}
                    onClick={() => setScreenId(id)}
                    onKeyDown={handleTabKey}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="adm-component-list">
            {COMPONENT_LIBRARY[screenId].map((component) => {
              const enabled = screen.components.find((item) => item.id === component.id)?.enabled !== false;
              return (
                <div className="adm-component-row" key={component.id}>
                  <div>
                    <div className="adm-component-name">{component.label}</div>
                    <div className="adm-cell-meta">{component.description}</div>
                  </div>
                  <button
                    className={'be-btn be-btn-sm ' + (enabled ? 'be-btn-secondary' : 'be-btn-primary')}
                    onClick={() => setComponentEnabled(screenId, component.id, !enabled)}
                  >
                    {enabled ? <><I icon={Trash2} size={14}/>Remove</> : <><I icon={Plus} size={14}/>Add</>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="adm-card-divider" />
          <span className="be-eyebrow">Screen copy</span>
          <div className="adm-form-grid">
            {Object.entries(screen.copy || {}).map(([key, value]) => (
              <label className="adm-field" key={key}>
                <span>{key}</span>
                <input value={value} onChange={(event) => updateScreenCopy(key, event.target.value)} />
              </label>
            ))}
          </div>
        </div>

        <div className="adm-card">
          <span className="be-eyebrow">Dashboard shortcuts</span>
          <h2 className="adm-card-title">Quick actions</h2>
          <div className="adm-editor-list">
            {config.mobile.screens.dashboard.quickActions.map((action, index) => (
              <div className="adm-editor-row" key={action.id}>
                <input value={action.label} onChange={(event) => updateDashboardAction(index, 'label', event.target.value)} />
                <input value={action.route} onChange={(event) => updateDashboardAction(index, 'route', event.target.value)} />
                <select value={action.icon} onChange={(event) => updateDashboardAction(index, 'icon', event.target.value)}>
                  {['Plus', 'Repeat', 'Receipt', 'Compass'].map((icon) => <option key={icon}>{icon}</option>)}
                </select>
                <label className="adm-check"><input type="checkbox" checked={action.enabled !== false} onChange={(event) => updateDashboardAction(index, 'enabled', event.target.checked)} />On</label>
                <button className="adm-icon-btn" onClick={() => removeDashboardAction(index)} aria-label="Remove quick action"><I icon={Trash2}/></button>
              </div>
            ))}
          </div>
          <button className="be-btn be-btn-secondary be-btn-sm" onClick={addDashboardAction}><I icon={Plus} size={14}/>Add action</button>

          <div className="adm-card-divider" />
          <span className="be-eyebrow">Research rows</span>
          <div className="adm-editor-list">
            {config.mobile.researchContext.map((row, index) => (
              <div className="adm-editor-row adm-editor-row-3" key={`${row.label}-${index}`}>
                <input value={row.label} onChange={(event) => updateResearch(index, 'label', event.target.value)} />
                <input value={row.value} onChange={(event) => updateResearch(index, 'value', event.target.value)} />
                <input value={row.note} onChange={(event) => updateResearch(index, 'note', event.target.value)} />
                <button className="adm-icon-btn" onClick={() => removeResearchRow(index)} aria-label="Remove research row"><I icon={Trash2}/></button>
              </div>
            ))}
          </div>
          <button className="be-btn be-btn-secondary be-btn-sm" onClick={addResearchRow}><I icon={Plus} size={14}/>Add row</button>
        </div>
      </div>

      {selectedProduct && (
        <div className="adm-card">
          <div className="adm-card-head">
            <div>
              <span className="be-eyebrow">Explore and charts</span>
              <h2 className="adm-card-title">Strategy content</h2>
            </div>
            <div className="adm-card-actions">
              <select className="adm-select" value={selectedProduct.id} onChange={(event) => setSelectedProductId(event.target.value)}>
                {config.mobile.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
              </select>
              <button className="be-btn be-btn-secondary be-btn-sm" onClick={addProduct}><I icon={Plus} size={14}/>New strategy</button>
              <button className="be-btn be-btn-danger be-btn-sm" onClick={removeProduct}><I icon={Trash2} size={14}/>Remove</button>
            </div>
          </div>

          <div className="adm-form-grid adm-form-grid-3">
            <label className="adm-field"><span>Name</span><input value={selectedProduct.name} onChange={(event) => updateProduct('name', event.target.value)} /></label>
            <label className="adm-field"><span>Status</span><select value={selectedProduct.status} onChange={(event) => updateProduct('status', event.target.value)}><option value="open">open</option><option value="coming_soon">coming_soon</option><option value="paused">paused</option><option value="closed">closed</option></select></label>
            <label className="adm-field"><span>Risk</span><select value={selectedProduct.riskLabel} onChange={(event) => updateProduct('riskLabel', event.target.value)}><option value="low">low</option><option value="low_moderate">low_moderate</option><option value="moderate">moderate</option><option value="moderate_high">moderate_high</option><option value="high">high</option></select></label>
            <label className="adm-field adm-field-wide"><span>Tagline</span><input value={selectedProduct.tagline} onChange={(event) => updateProduct('tagline', event.target.value)} /></label>
            <label className="adm-field adm-field-wide"><span>Objective</span><textarea value={selectedProduct.objective} onChange={(event) => updateProduct('objective', event.target.value)} /></label>
            <label className="adm-field"><span>Min SIP</span><input type="number" value={selectedProduct.minSip ?? ''} onChange={(event) => updateProductNumber('minSip', event.target.value)} /></label>
            <label className="adm-field"><span>Min one-time</span><input type="number" value={selectedProduct.minLumpsum ?? ''} onChange={(event) => updateProductNumber('minLumpsum', event.target.value)} /></label>
            <label className="adm-field"><span>Horizon</span><input value={selectedProduct.horizon} onChange={(event) => updateProduct('horizon', event.target.value)} /></label>
            <label className="adm-field"><span>Lock-in</span><input value={selectedProduct.lockInText} onChange={(event) => updateProduct('lockInText', event.target.value)} /></label>
            <label className="adm-field"><span>Disclosure version</span><input value={selectedProduct.disclosureVersion} onChange={(event) => updateProduct('disclosureVersion', event.target.value)} /></label>
          </div>

          <div className="adm-grid-2 adm-m-t-4">
            <div>
              <span className="be-eyebrow">Investment controls</span>
              <div className="adm-form-grid">
                <label className="adm-field"><span>Fund detail chart periods</span><input value={(config.mobile.screens.fundDetail.charts.periods || []).join(', ')} onChange={(event) => updateConfig((next) => {
                  const fundDetail = next.mobile.screens.fundDetail;
                  next.mobile.screens.fundDetail = {
                    ...fundDetail,
                    charts: { ...fundDetail.charts, periods: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) },
                  };
                })} /></label>
                <label className="adm-field"><span>Default period</span><input value={config.mobile.screens.fundDetail.charts.defaultPeriod || ''} onChange={(event) => updateConfig((next) => {
                  const fundDetail = next.mobile.screens.fundDetail;
                  next.mobile.screens.fundDetail = {
                    ...fundDetail,
                    charts: { ...fundDetail.charts, defaultPeriod: event.target.value },
                  };
                })} /></label>
                <label className="adm-field"><span>SIP presets</span><input value={(config.mobile.screens.invest.sip.amountPresets || []).join(', ')} onChange={(event) => updateArraySetting('sip', 'amountPresets', event.target.value)} /></label>
                <label className="adm-field"><span>SIP durations</span><input value={(config.mobile.screens.invest.sip.durationMonths || []).join(', ')} onChange={(event) => updateArraySetting('sip', 'durationMonths', event.target.value)} /></label>
                <label className="adm-field"><span>Debit days</span><input value={(config.mobile.screens.invest.sip.debitDays || []).join(', ')} onChange={(event) => updateArraySetting('sip', 'debitDays', event.target.value)} /></label>
                <label className="adm-field"><span>One-time presets</span><input value={(config.mobile.screens.invest.oneTime.amountPresets || []).join(', ')} onChange={(event) => updateArraySetting('oneTime', 'amountPresets', event.target.value)} /></label>
              </div>
            </div>
          </div>

          <div className="adm-grid-2 adm-m-t-4">
            <div>
              <div className="adm-card-head adm-card-head-tight">
                <span className="be-eyebrow">Allocation chart</span>
                <button className="be-btn be-btn-secondary be-btn-sm" onClick={() => addProductListItem('allocation', { name: 'New allocation', pct: 0, color: 'var(--be-slate)' })}><I icon={Plus} size={14}/>Add</button>
              </div>
              <div className="adm-editor-list">
                {selectedProduct.allocation.map((row, index) => (
                  <div className="adm-editor-row adm-editor-row-3" key={`${row.name}-${index}`}>
                    <input value={row.name} onChange={(event) => updateProductList('allocation', index, 'name', event.target.value)} />
                    <input type="number" value={row.pct} onChange={(event) => updateProductList('allocation', index, 'pct', event.target.value)} />
                    <input value={row.color} onChange={(event) => updateProductList('allocation', index, 'color', event.target.value)} />
                    <button className="adm-icon-btn" onClick={() => removeProductListItem('allocation', index)}><I icon={Trash2}/></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="adm-card-head adm-card-head-tight">
                <span className="be-eyebrow">Portfolio exposure</span>
                <button className="be-btn be-btn-secondary be-btn-sm" onClick={() => addProductListItem('topHoldings', { symbol: 'ITEM', name: 'New exposure', pct: 0 })}><I icon={Plus} size={14}/>Add</button>
              </div>
              <div className="adm-editor-list">
                {selectedProduct.topHoldings.map((row, index) => (
                  <div className="adm-editor-row adm-editor-row-3" key={`${row.name}-${index}`}>
                    <input value={row.symbol} onChange={(event) => updateProductList('topHoldings', index, 'symbol', event.target.value)} />
                    <input value={row.name} onChange={(event) => updateProductList('topHoldings', index, 'name', event.target.value)} />
                    <input type="number" value={row.pct} onChange={(event) => updateProductList('topHoldings', index, 'pct', event.target.value)} />
                    <button className="adm-icon-btn" onClick={() => removeProductListItem('topHoldings', index)}><I icon={Trash2}/></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppBuilderScreen;
