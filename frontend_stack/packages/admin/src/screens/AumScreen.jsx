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
import './admin-screens-shared.css';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import { fmtInt, clone, initials } from '../helpers/formatters.js';
import FundAumPanel from './FundAumPanel.jsx';
import FundInvestorsPanel from './FundInvestorsPanel.jsx';
import FundStockListPanel from './FundStockListPanel.jsx';
import AumRedemptionsTab from './AumRedemptionsTab.jsx';
import AumDisplayFields from './AumDisplayFields.jsx';

function AumScreen({ funds = [], auditLogs = [], onCreate, onUpdate, onDelete, onUserDetail }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [stageFilter, setStageFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState(null);
  const [selectedFundId, setSelectedFundId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState(null);
  const [previewFund, setPreviewFund] = useState(null);
  const [allocationFund, setAllocationFund] = useState(null);
  const [capitalTransactions, setCapitalTransactions] = useState([]);
  const [redemptionRequests, setRedemptionRequests] = useState([]);
  const [aumLoading, setAumLoading] = useState(false);

  const emptyForm = {
    name: '',
    tagline: '',
    lifecycleStage: 'draft',
    status: 'coming_soon',
    totalPoolSize: '',
    initialInvestment: '',
    currentValue: '',
    launchDate: '',
    minSip: '',
    minLumpsum: '',
    riskLabel: '',
    sectors: [],
    investments: [],
    // Session 4 display fields (Groww-style profile)
    category: '',
    subCategory: '',
    riskText: '',
    holdingsAsOf: '',
    nav: { value: '', asOf: '' },
    rating: { value: '', scale: 5 },
    performanceSummary: { selectedPeriod: '3Y', annualizedReturnPct: '', oneDayReturnPct: '', niftyReturnPct: '', asOf: '' },
    performanceSeries: [],
    performancePeriods: [],
    assetAllocation: [],
    advancedRatios: { pe: '', pb: '', beta: '', alpha: '', sharpe: '', sortino: '' },
    chartConfig: {
      showSectorDistribution: true,
      showInvestmentBreakdown: false,
      showCompanyNames: false,
      showBenchmarkComparison: true,
      showAssetAllocation: true,
      showAdvancedRatios: true,
    },
  };

  const [form, setForm] = useState(emptyForm);

  const selectedFund = funds.find(f => f.id === selectedFundId) || null;

  const LIFECYCLE_STAGES = ['draft', 'published', 'active', 'paused', 'closed', 'archived'];

  const STAGE_DESCRIPTIONS = {
    draft: 'Admin only, not visible to users',
    published: 'Visible to users as "Coming Soon"',
    active: 'Visible and investable',
    paused: 'Visible but not investable',
    closed: 'Visible for historical reference only',
    archived: 'Hidden from all users',
  };

  function deriveStatusFromLifecycle(stage) {
    if (stage === 'active') return 'active';
    if (['published', 'paused', 'closed'].includes(stage)) return 'coming_soon';
    return 'coming_soon';
  }

  function openCreate() {
    setSelectedFundId(null);
    setEditorMode('create');
    setForm(clone(emptyForm));
    setFormError('');
    setEditorOpen(true);
  }

  function openEdit(fund) {
    setSelectedFundId(fund.id);
    setEditorMode('edit');
    setForm({
      name: fund.name || '',
      tagline: fund.tagline || '',
      lifecycleStage: fund.lifecycleStage || 'draft',
      status: fund.status || 'coming_soon',
      totalPoolSize: fund.totalPoolSize ?? '',
      initialInvestment: fund.initialInvestment ?? '',
      currentValue: fund.currentValue ?? '',
      launchDate: fund.launchDate ?? '',
      minSip: fund.minSip ?? '',
      minLumpsum: fund.minLumpsum ?? '',
      riskLabel: fund.riskLabel || '',
      sectors: clone(fund.sectors || []),
      investments: clone(fund.investments || []),
      category: fund.category || '',
      subCategory: fund.subCategory || '',
      riskText: fund.riskText || '',
      holdingsAsOf: fund.holdingsAsOf || '',
      nav: { value: fund.nav?.value ?? '', asOf: fund.nav?.asOf || '' },
      rating: { value: fund.rating?.value ?? '', scale: fund.rating?.scale ?? 5 },
      performanceSummary: {
        selectedPeriod: fund.performanceSummary?.selectedPeriod || '3Y',
        annualizedReturnPct: fund.performanceSummary?.annualizedReturnPct ?? '',
        oneDayReturnPct: fund.performanceSummary?.oneDayReturnPct ?? '',
        niftyReturnPct: fund.performanceSummary?.niftyReturnPct ?? '',
        asOf: fund.performanceSummary?.asOf || '',
      },
      performanceSeries: clone(fund.performanceSeries || []),
      performancePeriods: clone(fund.performancePeriods || []),
      assetAllocation: clone(fund.assetAllocation || []),
      advancedRatios: {
        pe: fund.advancedRatios?.pe ?? '', pb: fund.advancedRatios?.pb ?? '',
        beta: fund.advancedRatios?.beta ?? '', alpha: fund.advancedRatios?.alpha ?? '',
        sharpe: fund.advancedRatios?.sharpe ?? '', sortino: fund.advancedRatios?.sortino ?? '',
      },
      chartConfig: {
        showSectorDistribution: fund.chartConfig?.showSectorDistribution !== false,
        showInvestmentBreakdown: fund.chartConfig?.showInvestmentBreakdown === true,
        showCompanyNames: fund.chartConfig?.showCompanyNames === true,
        showBenchmarkComparison: fund.chartConfig?.showBenchmarkComparison !== false,
        showAssetAllocation: fund.chartConfig?.showAssetAllocation !== false,
        showAdvancedRatios: fund.chartConfig?.showAdvancedRatios !== false,
      },
    });
    setFormError('');
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorMode(null);
    setSelectedFundId(null);
    setFormError('');
    setLifecycleConfirm(null);
  }

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateField(key) {
    return (e) => setForm(s => ({ ...s, [key]: e.target.value }));
  }

  function updateNumberField(key) {
    return (e) => setForm(s => ({ ...s, [key]: e.target.value === '' ? '' : Number(e.target.value) }));
  }

  function addSector() {
    setForm(s => ({
      ...s,
      sectors: [...s.sectors, { id: `sec_${Date.now()}`, name: '', percentage: 0, color: 'var(--be-gold)' }]
    }));
  }

  function updateSector(index, field, value) {
    setForm(s => {
      const sectors = [...s.sectors];
      sectors[index] = { ...sectors[index], [field]: field === 'percentage' ? (value === '' ? 0 : Number(value)) : value };
      return { ...s, sectors };
    });
  }

  function removeSector(index) {
    setForm(s => ({ ...s, sectors: s.sectors.filter((_, i) => i !== index) }));
  }

  function addInvestment() {
    setForm(s => ({
      ...s,
      investments: [...s.investments, { id: `inv_${Date.now()}`, companyName: '', amount: 0, sectorId: '' }]
    }));
  }

  function updateInvestment(index, field, value) {
    setForm(s => {
      const investments = [...s.investments];
      investments[index] = { ...investments[index], [field]: field === 'amount' ? (value === '' ? 0 : Number(value)) : value };
      return { ...s, investments };
    });
  }

  function removeInvestment(index) {
    setForm(s => ({ ...s, investments: s.investments.filter((_, i) => i !== index) }));
  }

  function updateChartConfig(key) {
    return (e) => setForm(s => ({
      ...s,
      chartConfig: { ...s.chartConfig, [key]: e.target.checked }
    }));
  }

  function getChartWarnings() {
    const warnings = [];
    if (form.chartConfig.showBenchmarkComparison && (!form.performanceSeries || form.performanceSeries.length < 2)) {
      warnings.push('Benchmark comparison chart is enabled but has fewer than 2 data points.');
    }
    if (form.chartConfig.showAssetAllocation && (!form.assetAllocation || form.assetAllocation.length === 0)) {
      warnings.push('Asset split donut is enabled but has no data.');
    }
    if (form.chartConfig.showSectorDistribution && form.sectors.length === 0) {
      warnings.push('Sector distribution chart is enabled but has no sectors.');
    }
    if (form.chartConfig.showAdvancedRatios && (!form.advancedRatios || Object.values(form.advancedRatios).every(v => v === '' || v === null || v === undefined))) {
      warnings.push('Advanced ratios are enabled but all fields are blank.');
    }
    return warnings;
  }

  function handleLifecycleClick(stage) {
    if (stage === form.lifecycleStage) return;
    const destructive = (form.lifecycleStage === 'active' && stage === 'archived') ||
                        (form.lifecycleStage === 'active' && stage === 'draft');
    const chartWarnings = stage === 'active' ? getChartWarnings() : [];
    if (destructive || chartWarnings.length > 0) {
      setLifecycleConfirm(stage);
      return;
    }
    applyLifecycleChange(stage);
  }

  function applyLifecycleChange(stage) {
    setForm(s => ({
      ...s,
      lifecycleStage: stage,
      status: deriveStatusFromLifecycle(stage),
    }));
    setLifecycleConfirm(null);
  }

  const sectorTotal = form.sectors.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0);
  const poolSizeNum = form.totalPoolSize === '' ? 0 : Number(form.totalPoolSize);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Fund name is required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        tagline: form.tagline.trim() || undefined,
        lifecycleStage: form.lifecycleStage,
        status: form.status,
        totalPoolSize: form.totalPoolSize === '' ? undefined : Number(form.totalPoolSize),
        minSip: form.minSip === '' ? undefined : Number(form.minSip),
        minLumpsum: form.minLumpsum === '' ? undefined : Number(form.minLumpsum),
        riskLabel: form.riskLabel.trim() || undefined,
        sectors: form.sectors.map(s => ({ ...s, percentage: Number(s.percentage) || 0 })),
        investments: form.investments.map(i => ({ ...i, amount: Number(i.amount) || 0 })),
        // Session 4 display fields — backend sanitizes blanks to null/[].
        category: form.category,
        subCategory: form.subCategory,
        riskText: form.riskText,
        holdingsAsOf: form.holdingsAsOf,
        nav: form.nav,
        rating: form.rating,
        performanceSummary: form.performanceSummary,
        performanceSeries: form.performanceSeries,
        performancePeriods: form.performancePeriods,
        assetAllocation: form.assetAllocation,
        advancedRatios: form.advancedRatios,
        chartConfig: { ...form.chartConfig },
        showSectorChart: form.chartConfig.showSectorDistribution,
        showInvestmentChart: form.chartConfig.showInvestmentBreakdown,
      };
      if (editorMode === 'create') {
        await onCreate?.(payload);
      } else {
        await onUpdate?.(selectedFundId, payload);
      }
      closeEditor();
    } catch (err) {
      setFormError(err?.message || `Failed to ${editorMode === 'create' ? 'create' : 'update'} fund pool.`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm?.id) return;
    setSubmitting(true);
    try {
      await onDelete?.(deleteConfirm.id);
      if (selectedFundId === deleteConfirm.id) closeEditor();
    } catch (err) {
      setFormError(err?.message || 'Failed to delete fund pool.');
    } finally {
      setSubmitting(false);
      setDeleteConfirm(null);
    }
  }

  /* Replaced by shared components: RiskBadge, LifecycleBadge, StatusBadge
     from ../../shared/components/Badges.jsx */

  const totalFunds = funds.length;
  const totalAum = funds.reduce((sum, f) => sum + (Number(f.totalPoolSize) || 0), 0);
  const activeFunds = funds.filter(f => f.lifecycleStage === 'active').length;
  const draftFunds = funds.filter(f => f.lifecycleStage === 'draft').length;

  const fundAuditLogs = (auditLogs || [])
    .filter(log => String(log.entityType || '').toLowerCase() === 'fund')
    .sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0))
    .slice(0, 5);

  const filteredFunds = stageFilter === 'all'
    ? funds
    : funds.filter(f => (f.lifecycleStage || 'draft') === stageFilter);

  const selectedFundAuditLogs = selectedFund
    ? (auditLogs || []).filter(log =>
        String(log.entityType || '').toLowerCase() === 'fund' &&
        String(log.entityId || '') === String(selectedFund.id)
      ).sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0)).slice(0, 10)
    : [];
  return (
    <>
      {editorOpen ? (
        <div className="adm-fund-editor-page">
          <div className="adm-fund-editor-header">
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={closeEditor}
              disabled={submitting}
            >
              <I icon={ArrowLeft} size={16} /> Back to AUM
            </button>
            <h2 className="adm-fund-editor-header-title">
              {editorMode === 'create' ? 'Create Fund Pool' : `Edit: ${selectedFund?.name || 'Fund Pool'}`}
            </h2>
            <div className="adm-fund-editor-header-actions">
              {editorMode === 'edit' && (
                <button
                  type="button"
                  className="be-btn be-btn-danger"
                  onClick={() => setDeleteConfirm({ id: selectedFundId, name: selectedFund?.name })}
                  disabled={submitting}
                >
                  <I icon={Trash2} size={14} /> Delete
                </button>
              )}
              <button type="button" className="be-btn be-btn-secondary" onClick={closeEditor} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" form="fund-editor-form" className="be-btn be-btn-primary" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Fund Pool'}
              </button>
            </div>
          </div>

          <nav className="adm-fund-editor-subnav" aria-label="Fund editor sections">
            {[
              { id: 'basic', label: 'Basic', icon: FileText },
              { id: 'lifecycle', label: 'Lifecycle', icon: Activity },
              { id: 'sectors', label: 'Sectors', icon: PieChart },
              { id: 'display', label: 'Display', icon: Star },
              { id: 'preview', label: 'Preview', icon: Eye },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="adm-fund-editor-subnav-link"
                onClick={() => scrollToSection(item.id)}
              >
                <I icon={item.icon} size={14} /> {item.label}
              </button>
            ))}
          </nav>

          <form id="fund-editor-form" onSubmit={handleSubmit} className="adm-fund-editor-layout">
            <div className="adm-fund-editor-main">
              {formError && (
                <div className="adm-validation-banner adm-validation-banner--error adm-m-b-0">
                  <I icon={AlertTriangle} size={14} /> {formError}
                </div>
              )}

              {/* Section 1: Basic Information */}
              <section id="basic" className="adm-fund-editor-section">
                <div className="adm-fund-editor-section-title"><I icon={FileText} size={16} /> Basic Information</div>
                <div className="adm-form-grid">
                  <label className="adm-field">
                    <span>Fund Name *</span>
                    <input type="text" required value={form.name} onChange={updateField('name')} />
                  </label>
                  <label className="adm-field">
                    <span>User Status</span>
                    <select value={form.status} onChange={updateField('status')} disabled>
                      <option value="active">Active</option>
                      <option value="coming_soon">Coming Soon</option>
                    </select>
                    <small className="adm-help-text">Auto-derived from lifecycle stage</small>
                  </label>
                  <label className="adm-field adm-field-wide">
                    <span>Tagline</span>
                    <input type="text" value={form.tagline} onChange={updateField('tagline')} />
                  </label>
                  <label className="adm-field">
                    <span>Total Pool Size (INR)</span>
                    <input type="number" min="0" value={form.totalPoolSize} onChange={updateNumberField('totalPoolSize')} />
                  </label>
                  <label className="adm-field">
                    <span>Initial Investment (INR)</span>
                    <input type="number" min="0" value={form.initialInvestment} onChange={updateNumberField('initialInvestment')} />
                    <small className="adm-help-text">Starting capital when fund launched</small>
                  </label>
                  <label className="adm-field">
                    <span>Current Value (INR)</span>
                    <input type="number" min="0" value={form.currentValue} onChange={updateNumberField('currentValue')} />
                    <small className="adm-help-text">Current total fund value</small>
                  </label>
                  <label className="adm-field">
                    <span>Launch Date</span>
                    <input type="date" value={form.launchDate} onChange={updateField('launchDate')} />
                    <small className="adm-help-text">When the fund started operations</small>
                  </label>
                  <label className="adm-field">
                    <span>Min SIP</span>
                    <input type="number" min="0" value={form.minSip} onChange={updateNumberField('minSip')} />
                  </label>
                  <label className="adm-field">
                    <span>Min Lumpsum</span>
                    <input type="number" min="0" value={form.minLumpsum} onChange={updateNumberField('minLumpsum')} />
                  </label>
                  <label className="adm-field">
                    <span>Risk Profile</span>
                    <select value={form.riskLabel} onChange={updateField('riskLabel')}>
                      <option value="">Select risk profile</option>
                      <option value="high">Growth (High)</option>
                      <option value="moderate_high">Growth (Moderate-High)</option>
                      <option value="moderate">Balanced (Moderate)</option>
                      <option value="low_moderate">Balanced (Low-Moderate)</option>
                      <option value="low">Conservative (Low)</option>
                    </select>
                    {form.riskLabel && (
                      <small className="adm-help-text adm-help-text--block">
                        Client sees: <strong>{(() => { const map = { high: 'Growth', moderate_high: 'Growth', moderate: 'Balanced', low_moderate: 'Balanced', low: 'Conservative' }; return map[form.riskLabel] || 'Balanced'; })()}</strong>
                      </small>
                    )}
                  </label>
                </div>
                {/* Auto-computed Performance Metrics */}
                {(() => {
                  const initial = Number(form.initialInvestment) || 0;
                  const current = Number(form.currentValue) || 0;
                  const launch = form.launchDate ? new Date(form.launchDate) : null;
                  const now = new Date();
                  const hasAge = launch && !Number.isNaN(launch.getTime()) && launch <= now;
                  const ageDays = hasAge ? Math.floor((now - launch) / (1000 * 60 * 60 * 24)) : 0;
                  const ageYears = ageDays / 365.25;
                  const totalReturn = initial > 0 ? ((current - initial) / initial) * 100 : 0;
                  const annualized = initial > 0 && current > 0 && ageYears > 0
                    ? (Math.pow(current / initial, 1 / ageYears) - 1) * 100
                    : 0;
                  if (initial === 0 && current === 0 && !hasAge) return null;
                  return (
                    <div className="adm-metrics-preview">
                      <span className="be-eyebrow">Auto-computed Metrics</span>
                      <div className="adm-metrics-grid">
                        <div>
                          <div className="adm-metric-label">Total Return</div>
                          <div className={`adm-metric-value ${totalReturn >= 0 ? 'adm-metric-value--gain' : 'adm-metric-value--loss'}`}>
                            {totalReturn > 0 ? '+' : ''}{totalReturn.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="adm-metric-label">Fund Age</div>
                          <div className="adm-metric-value">
                            {hasAge ? `${Math.floor(ageYears)}y ${Math.floor((ageDays % 365) / 30)}mo` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="adm-metric-label">Annualized Return</div>
                          <div className={`adm-metric-value ${annualized >= 0 ? 'adm-metric-value--gain' : 'adm-metric-value--loss'}`}>
                            {annualized > 0 ? '+' : ''}{annualized.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </section>

              {/* Section 2: Lifecycle Workflow */}
              <section id="lifecycle" className="adm-fund-editor-section">
                <div className="adm-fund-editor-section-title"><I icon={Activity} size={16} /> Lifecycle Workflow</div>
                <div className="adm-lifecycle-bar">
                  {LIFECYCLE_STAGES.map((stage, idx) => (
                    <div key={stage} className="adm-lifecycle-item">
                      <button
                        type="button"
                        className={`adm-lifecycle-stage ${form.lifecycleStage === stage ? 'adm-lifecycle-stage--active' : ''}`}
                        onClick={() => handleLifecycleClick(stage)}
                      >
                        {stage.charAt(0).toUpperCase() + stage.slice(1)}
                      </button>
                      {idx < LIFECYCLE_STAGES.length - 1 && (
                        <I icon={ChevronRight} size={14} className="adm-lifecycle-arrow" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="adm-lifecycle-desc">
                  <strong>{form.lifecycleStage.charAt(0).toUpperCase() + form.lifecycleStage.slice(1)}:</strong> {STAGE_DESCRIPTIONS[form.lifecycleStage]}
                </div>
              </section>

              {/* Section 3: Sectors & Investments */}
              <section id="sectors" className="adm-fund-editor-section">
                <div className="adm-fund-editor-section-title adm-fund-editor-section-title--between">
                  <span><I icon={PieChart} size={16} /> Sectors & Investments</span>
                  {selectedFund?.analytics && (
                    <span className="adm-cell-meta">
                      ₹{(selectedFund.analytics.totalInvested ?? 0).toLocaleString()} deployed of ₹{(selectedFund.totalPoolSize ?? poolSizeNum).toLocaleString()} pool
                    </span>
                  )}
                </div>

                {selectedFund?.analytics?.sectorValid === false && (
                  <div className="adm-validation-banner adm-validation-banner--error">
                    <I icon={AlertTriangle} size={14} /> Sector allocations do not sum to 100%
                  </div>
                )}
                <div className="adm-editor-list">
                  {form.sectors.map((sector, index) => (
                    <div className="adm-sector-row" key={sector.id}>
                      <input value={sector.name} onChange={(e) => updateSector(index, 'name', e.target.value)} placeholder="Sector name" />
                      <input type="number" min="0" max="100" value={sector.percentage} onChange={(e) => updateSector(index, 'percentage', e.target.value)} placeholder="%" />
                      <input value={sector.color} onChange={(e) => updateSector(index, 'color', e.target.value)} placeholder="#hex" />
                      <button type="button" className="adm-icon-btn" onClick={() => removeSector(index)} aria-label="Remove sector"><I icon={Trash2} size={14} /></button>
                    </div>
                  ))}
                </div>
                {/* Live sector distribution preview */}
                {form.sectors.length > 0 && (
                  <div className={`adm-distribution-preview ${sectorTotal === 100 ? 'adm-distribution-preview--valid' : 'adm-distribution-preview--invalid'}`}>
                    <div className="adm-distribution-preview__head">
                      <span className="be-eyebrow adm-text-2xs">Distribution preview</span>
                      <span className={`be-eyebrow adm-text-2xs ${sectorTotal === 100 ? '' : 'adm-tone-red'}`}>
                        {sectorTotal === 100 ? '100%' : `${sectorTotal}% — must equal 100%`}
                      </span>
                    </div>
                    <SectorMiniBar sectors={form.sectors} height={8} />
                    <div className="adm-distribution-preview__legend">
                      {form.sectors.map((s, i) => (
                        <span key={s.id || i} className="adm-distribution-preview__legend-item">
                          <span className="adm-distribution-preview__swatch adm-swatch" style={{ '--adm-swatch-color': s.color }} />
                          {s.name || 'Unnamed'} {s.percentage}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="adm-action-row adm-action-row--between">
                  <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={addSector}><I icon={Plus} size={14} /> Add Sector</button>
                  <span className={`be-eyebrow ${sectorTotal === 100 ? 'adm-tone-green' : 'adm-tone-red'}`}>Total: {sectorTotal}%</span>
                </div>

                <div className="adm-fund-editor-section-divider" />

                <div className="adm-fund-editor-section-subtitle"><I icon={Briefcase} size={14} /> Investment Distribution</div>
                <div className="adm-editor-list">
                  {form.investments.map((inv, index) => {
                    const pct = poolSizeNum > 0 ? ((Number(inv.amount) || 0) / poolSizeNum * 100).toFixed(2) : '0.00';
                    return (
                      <div className="adm-investment-row" key={inv.id}>
                        <input value={inv.companyName} onChange={(e) => updateInvestment(index, 'companyName', e.target.value)} placeholder="Company name" />
                        <input type="number" min="0" value={inv.amount} onChange={(e) => updateInvestment(index, 'amount', e.target.value)} placeholder="Amount (INR)" />
                        <select value={inv.sectorId} onChange={(e) => updateInvestment(index, 'sectorId', e.target.value)}>
                          <option value="">Select sector</option>
                          {form.sectors.map(s => (
                            <option key={s.id} value={s.id}>{s.name || 'Unnamed'}</option>
                          ))}
                        </select>
                        <span className="adm-cell-meta adm-text-right adm-min-w-60">{pct}%</span>
                        <button type="button" className="adm-icon-btn" onClick={() => removeInvestment(index)} aria-label="Remove investment"><I icon={Trash2} size={14} /></button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={addInvestment}><I icon={Plus} size={14} /> Add Investment</button>
                <p className="adm-help-text adm-m-t-2">Actual amounts are admin-only and never exposed to clients.</p>
              </section>

              {/* Section 4: Display Profile */}
              <div id="display" className="adm-fund-editor-section-group">
                <AumDisplayFields form={form} setForm={setForm} />
              </div>
            </div>

            <div className="adm-fund-editor-side">
              {/* Section 5: Visibility & Preview */}
              <section id="preview" className="adm-fund-editor-section">
                <div className="adm-fund-editor-section-title"><I icon={Eye} size={16} /> Visibility & Preview</div>
                <div className="adm-visibility-group">
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showSectorDistribution} onChange={updateChartConfig('showSectorDistribution')} />
                    <span>Show sector distribution chart</span>
                  </label>
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showInvestmentBreakdown} onChange={updateChartConfig('showInvestmentBreakdown')} />
                    <span>Show investment breakdown list</span>
                  </label>
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showCompanyNames} onChange={updateChartConfig('showCompanyNames')} />
                    <span>Show company names in breakdown</span>
                  </label>
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showBenchmarkComparison !== false} onChange={updateChartConfig('showBenchmarkComparison')} />
                    <span>Show performance vs Nifty chart</span>
                  </label>
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showAssetAllocation !== false} onChange={updateChartConfig('showAssetAllocation')} />
                    <span>Show asset split donut</span>
                  </label>
                  <label className="adm-chart-toggle">
                    <input type="checkbox" checked={form.chartConfig.showAdvancedRatios !== false} onChange={updateChartConfig('showAdvancedRatios')} />
                    <span>Show advanced ratios</span>
                  </label>
                </div>
                <p className="adm-cell-meta adm-m-t-2">Users will only see what you enable above.</p>

                <div className="adm-fund-editor-section-divider" />

                <div className="adm-fund-editor-section-subtitle"><I icon={Eye} size={14} /> Client Preview</div>
                <div className="adm-help-text adm-m-b-2">
                  This is how clients will see your fund card:
                </div>
                {(() => {
                  const isActive = form.status === 'active';
                  const perf = form.performanceSummary || {};
                  const series = Array.isArray(form.performanceSeries) ? form.performanceSeries : [];
                  const hasChart = series.length >= 2;
                  const headline = (() => { const n = Number(perf.annualizedReturnPct); return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : null; })();
                  const oneDay = (() => { const n = Number(perf.oneDayReturnPct); return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : null; })();
                  const niftyPct = (() => { const n = Number(perf.niftyReturnPct); return Number.isFinite(n) ? `${n.toFixed(2)}%` : null; })();
                  const metaBits = [form.riskText, form.category, form.subCategory].filter(Boolean);
                  const nav = form.nav || {};
                  const rating = form.rating || {};
                  const poolSize = form.totalPoolSize === '' ? 0 : Number(form.totalPoolSize);
                  const minSip = form.minSip === '' ? 0 : Number(form.minSip);
                  const fmtMoneyPreview = (v) => { const n = Number(v) || 0; if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`; if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`; return `₹${n.toLocaleString()}`; };
                  return (
                    <div className={`adm-fund-preview ${isActive ? 'adm-fund-preview--active' : ''}`}>
                      {/* Top row */}
                      <div className="adm-fund-preview__head">
                        <span className={`adm-fund-preview__icon ${isActive ? 'adm-fund-preview__icon--active' : 'adm-fund-preview__icon--soon'}`}>{initials(form.name || 'FU')}</span>
                        <div className="adm-fund-preview__title-block">
                          <h4 className="adm-fund-preview__title">{form.name || 'Untitled Fund'}</h4>
                          {metaBits.length > 0 && <div className="adm-fund-preview__meta">{metaBits.join(' · ')}</div>}
                        </div>
                        <span className={`adm-fund-preview__status ${isActive ? 'adm-fund-preview__status--active' : 'adm-fund-preview__status--soon'}`}>{isActive ? 'Active' : 'Coming Soon'}</span>
                      </div>

                      {/* Performance */}
                      {headline ? (
                        <div className="adm-fund-preview__performance">
                          <span className={`adm-fund-preview__headline ${Number(perf.annualizedReturnPct) >= 0 ? 'adm-fund-preview__headline--gain' : 'adm-fund-preview__headline--loss'}`}>{headline}</span>
                          {perf.selectedPeriod && <span className="adm-fund-preview__period">{perf.selectedPeriod} annualised</span>}
                          {oneDay && <span className={`adm-fund-preview__oneday ${Number(perf.oneDayReturnPct) >= 0 ? 'adm-fund-preview__oneday--gain' : 'adm-fund-preview__oneday--loss'}`}>{oneDay} <span className="adm-text-muted">1D</span></span>}
                        </div>
                      ) : (
                        form.tagline && <p className="adm-fund-preview__tagline">{form.tagline}</p>
                      )}

                      {/* Mini chart placeholder */}
                      {hasChart && (
                        <div className="adm-fund-preview__chart">
                          <span className="adm-fund-preview__chart-label">📈 Mini comparison chart ({series.length} points)</span>
                          {niftyPct && <span className="adm-fund-preview__nifty">Nifty <span className="adm-text-semibold">{niftyPct}</span></span>}
                        </div>
                      )}

                      {/* Metric grid */}
                      <div className="adm-fund-preview__metrics">
                        {nav.value != null && Number.isFinite(Number(nav.value)) && (
                          <div className="adm-fund-preview__metric">
                            <span className="adm-fund-preview__metric-label">NAV{nav.asOf ? ` · ${nav.asOf}` : ''}</span>
                            <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(nav.value)}</span>
                          </div>
                        )}
                        {rating.value != null && Number.isFinite(Number(rating.value)) && (
                          <div className="adm-fund-preview__metric">
                            <span className="adm-fund-preview__metric-label">Rating</span>
                            <span className="adm-fund-preview__metric-value">{rating.value}<span className="adm-star">★</span></span>
                          </div>
                        )}
                        <div className="adm-fund-preview__metric">
                          <span className="adm-fund-preview__metric-label">Min SIP</span>
                          <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(minSip)}</span>
                        </div>
                        <div className="adm-fund-preview__metric">
                          <span className="adm-fund-preview__metric-label">Fund size</span>
                          <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(poolSize)}</span>
                        </div>
                      </div>

                      {/* Sector fallback */}
                      {!headline && !hasChart && form.sectors.length > 0 && (
                        <SectorMiniBar sectors={form.sectors.filter(s => s.percentage > 0)} height={6} className="adm-sector-mini-bar--tight" />
                      )}

                      {/* Footer */}
                      <div className="adm-fund-preview__footer">
                        {isActive ? (
                          <span className="adm-fund-preview__cta adm-fund-preview__cta--active">View details →</span>
                        ) : (
                          <span className="adm-fund-preview__cta adm-fund-preview__cta--muted">Notify me when open</span>
                        )}
                      </div>
                      <div className="adm-fund-preview__disclaimer">Past performance is not indicative of future returns.</div>
                    </div>
                  );
                })()}
              </section>

              {/* Section 6: Audit Trail */}
              {editorMode === 'edit' && selectedFund && (
                <div className="adm-fund-editor-section">
                  <div className="adm-fund-editor-section-title"><I icon={ClipboardList} size={16} /> Audit Trail</div>
                  {selectedFundAuditLogs.length === 0 ? (
                    <div className="adm-empty-state">No audit entries for this fund.</div>
                  ) : (
                    <div className="adm-audit-log">
                      <table>
                        <thead>
                          <tr>
                            <th>Action</th>
                            <th>Timestamp</th>
                            <th>Changes Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedFundAuditLogs.map((log, idx) => (
                            <tr key={idx}>
                              <td><span className="adm-code">{log.action || '—'}</span></td>
                              <td className="adm-cell-meta">{log.timestamp || log.createdAt || '—'}</td>
                              <td className="adm-cell-meta">{log.changesSummary || log.details || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Summary Card */}
              <div className="adm-fund-editor-section">
                <div className="adm-fund-editor-section-title"><I icon={FileText} size={16} /> Summary</div>
                <div className="adm-review-grid">
                  <div className="adm-review-field">
                    <span>Fund Name</span>
                    <strong>{form.name || '—'}</strong>
                  </div>
                  <div className="adm-review-field">
                    <span>Lifecycle</span>
                    <strong>{form.lifecycleStage.charAt(0).toUpperCase() + form.lifecycleStage.slice(1)}</strong>
                  </div>
                  <div className="adm-review-field">
                    <span>Sectors</span>
                    <strong>{form.sectors.length}</strong>
                  </div>
                  <div className="adm-review-field">
                    <span>Investments</span>
                    <strong>{form.investments.length}</strong>
                  </div>
                  <div className="adm-review-field">
                    <span>Pool Size</span>
                    <strong>{form.totalPoolSize ? `₹${Number(form.totalPoolSize).toLocaleString()}` : '—'}</strong>
                  </div>
                  <div className="adm-review-field">
                    <span>Sector Total</span>
                    <strong className={sectorTotal === 100 ? 'adm-tone-green' : 'adm-tone-red'}>{sectorTotal}%</strong>
                  </div>
                </div>
              </div>
            </div>
          </form>

          {/* Delete confirmation modal */}
          {deleteConfirm && (
            <div className="adm-review-overlay" role="presentation" onMouseDown={() => !submitting && setDeleteConfirm(null)}>
              <section className="adm-review-panel" role="dialog" aria-modal="true" aria-labelledby="aum-delete-title" onMouseDown={(e) => e.stopPropagation()}>
                <div className="adm-review-head">
                  <div>
                    <span className="be-eyebrow">Confirm deletion</span>
                    <h2 id="aum-delete-title">Delete &ldquo;{deleteConfirm.name}&rdquo;?</h2>
                  </div>
                  <button className="adm-icon-btn" onClick={() => setDeleteConfirm(null)} aria-label="Close" disabled={submitting}><I icon={X}/></button>
                </div>
                <p className="adm-text-muted">This action cannot be undone. The fund pool will be permanently removed.</p>
                <div className="adm-review-actions">
                  <button className="be-btn be-btn-secondary" onClick={() => setDeleteConfirm(null)} disabled={submitting}>Cancel</button>
                  <button className="be-btn be-btn-danger" onClick={handleDelete} disabled={submitting}>
                    {submitting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* Lifecycle confirmation modal */}
          {lifecycleConfirm && (
            <div className="adm-review-overlay" role="presentation" onMouseDown={() => setLifecycleConfirm(null)}>
              <section className="adm-review-panel" role="dialog" aria-modal="true" aria-labelledby="aum-lifecycle-title" onMouseDown={(e) => e.stopPropagation()}>
                <div className="adm-review-head">
                  <div>
                    <span className="be-eyebrow">Confirm stage change</span>
                    <h2 id="aum-lifecycle-title">Change lifecycle stage?</h2>
                  </div>
                  <button className="adm-icon-btn" onClick={() => setLifecycleConfirm(null)} aria-label="Close"><I icon={X}/></button>
                </div>
                <div className="adm-text-muted">
                  <p className="adm-m-b-2">
                    You are about to move this fund from <strong>{form.lifecycleStage}</strong> to <strong>{lifecycleConfirm}</strong>.
                    This may affect visibility for users.
                  </p>
                  {lifecycleConfirm === 'active' && (() => {
                    const warnings = getChartWarnings();
                    return warnings.length > 0 ? (
                      <div className="adm-validation-banner adm-validation-banner--warning adm-validation-banner--start adm-m-b-2">
                        <I icon={AlertTriangle} size={14} />
                        <div>
                          <strong>Chart data incomplete</strong>
                          <ul className="adm-warning-list">
                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="adm-review-actions">
                  <button className="be-btn be-btn-secondary" onClick={() => setLifecycleConfirm(null)}>Cancel</button>
                  <button className="be-btn be-btn-primary" onClick={() => applyLifecycleChange(lifecycleConfirm)}>
                    Confirm Change
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      ) : (
        <div className="adm-screen">      {/* Tabs */}
      <div className="adm-fund-tabs">
        <button className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>
          <I icon={BarChart3} size={14}/> Overview
        </button>
        <button className={activeTab === 'funds' ? 'is-active' : ''} onClick={() => setActiveTab('funds')}>
          <I icon={Layers} size={14}/> Funds
        </button>
        <button className={activeTab === 'portfolio' ? 'is-active' : ''} onClick={() => setActiveTab('portfolio')}>
          <I icon={PieChart} size={14}/> Fund size &amp; portfolio
        </button>
        <button className={activeTab === 'redemptions' ? 'is-active' : ''} onClick={() => setActiveTab('redemptions')}>
          <I icon={RotateCcw} size={14}/> Redemptions
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="adm-fund-dashboard">
          <div className="adm-fund-stats">
            <StatTile label="Total Funds" value={fmtInt(totalFunds)} icon={Layers} tone="slate"/>
            <StatTile label="Total AUM" value={`₹${(totalAum / 1e7).toFixed(2)}Cr`} icon={Briefcase} tone="green"/>
            <StatTile label="Active Funds" value={fmtInt(activeFunds)} icon={TrendingUp} tone="green"/>
            <StatTile label="Funds in Draft" value={fmtInt(draftFunds)} icon={Clock} tone="amber"/>
          </div>

          <div className="adm-card">
            <div className="adm-card-head">
              <div>
                <span className="be-eyebrow">Recent Activity</span>
                <h2 className="adm-card-title">Fund audit trail</h2>
              </div>
              <button className="be-btn be-btn-primary be-btn-sm" onClick={openCreate}><I icon={Plus} size={14}/> Create New Fund Pool</button>
            </div>
            {fundAuditLogs.length === 0 ? (
              <div className="adm-empty-state">No recent fund activity recorded.</div>
            ) : (
              <div className="adm-audit-log">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Timestamp</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fundAuditLogs.map((log, idx) => (
                      <tr key={idx}>
                        <td><span className="adm-code">{log.action || '—'}</span></td>
                        <td>{log.entityName || log.entityId || '—'}</td>
                        <td className="adm-cell-meta">{log.timestamp || log.createdAt || '—'}</td>
                        <td className="adm-cell-meta">{log.changesSummary || log.details || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Funds */}
      {activeTab === 'funds' && (
        <div className="adm-fund-pools">
          <div className="adm-card adm-table">
            <div className="adm-card-head">
              <div>
                <span className="be-eyebrow">Funds</span>
                <h2 className="adm-card-title">All funds</h2>
              </div>
              <div className="adm-card-actions">
                <button className="be-btn be-btn-primary be-btn-sm" onClick={openCreate}><I icon={Plus} size={14}/> Create New Fund Pool</button>
              </div>
            </div>

            <div className="adm-toolbar">
              <div className="adm-filter">
                <I icon={Filter} size={14}/>
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                  <option value="all">All stages</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="closed">Closed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <span className="adm-fund-count">{filteredFunds.length} fund{filteredFunds.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="adm-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Lifecycle Stage</th>
                    <th>Status</th>
                    <th>Pool Size</th>
                    <th>Sectors</th>
                    <th>Investments</th>
                    <th className="adm-col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFunds.length === 0 && (
                    <EmptyTableRow colSpan={7}>No fund pools match the selected filter.</EmptyTableRow>
                  )}
                  {filteredFunds.map(f => (
                    <tr key={f.id || f.name}>
                      <td>
                        <div className="adm-fund-name-cell">
                          <span className="adm-fund-name">{f.name}</span>
                          {f.sectors?.length > 0 && (
                            <SectorMiniBar sectors={f.sectors} height={5} className="adm-sector-mini-bar--table" />
                          )}
                        </div>
                      </td>
                      <td><LifecycleBadge stage={f.lifecycleStage} size="sm" /></td>
                      <td><StatusBadge status={f.status} size="sm" /></td>
                      <td className="be-money">{f.totalPoolSize ?? f.aum ?? 0}</td>
                      <td className="be-num">{f.analytics?.sectorCount ?? f.sectors?.length ?? 0}</td>
                      <td className="be-num">{f.analytics?.investmentCount ?? f.investments?.length ?? 0}</td>
                      <td className="adm-cell-actions">
                        <button className="be-btn be-btn-secondary be-btn-sm" onClick={() => openEdit(f)}><I icon={Pencil} size={14}/> Edit</button>
                        <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => setPreviewFund(f)}><I icon={Eye} size={14}/> Preview</button>
                        <button className="adm-icon-btn" onClick={() => navigator.clipboard?.writeText(f.id)} title="Copy ID"><I icon={Copy} size={14}/></button>
                        <button className="be-btn be-btn-danger be-btn-sm" onClick={() => setDeleteConfirm({ id: f.id, name: f.name })}><I icon={Trash2} size={14}/> Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="adm-review-overlay" role="presentation" onMouseDown={() => !submitting && setDeleteConfirm(null)}>
          <section className="adm-review-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="adm-review-head">
              <div>
                <span className="be-eyebrow">Confirm deletion</span>
                <h2>Delete &ldquo;{deleteConfirm.name}&rdquo;?</h2>
              </div>
              <button className="adm-icon-btn" onClick={() => setDeleteConfirm(null)} aria-label="Close" disabled={submitting}><I icon={X}/></button>
            </div>
            <p className="adm-text-muted">This action cannot be undone. The fund pool will be permanently removed.</p>
            <div className="adm-review-actions">
              <button className="be-btn be-btn-secondary" onClick={() => setDeleteConfirm(null)} disabled={submitting}>Cancel</button>
              <button className="be-btn be-btn-danger" onClick={handleDelete} disabled={submitting}>
                {submitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Lifecycle confirmation modal */}
      {lifecycleConfirm && (
        <div className="adm-review-overlay" role="presentation" onMouseDown={() => setLifecycleConfirm(null)}>
          <section className="adm-review-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="adm-review-head">
              <div>
                <span className="be-eyebrow">Confirm stage change</span>
                <h2>Change lifecycle stage?</h2>
              </div>
              <button className="adm-icon-btn" onClick={() => setLifecycleConfirm(null)} aria-label="Close"><I icon={X}/></button>
            </div>
            <div className="adm-text-muted">
              <p className="adm-m-b-2">
                You are about to move this fund from <strong>{form.lifecycleStage}</strong> to <strong>{lifecycleConfirm}</strong>.
                This may affect visibility for users.
              </p>
              {lifecycleConfirm === 'active' && (() => {
                const warnings = getChartWarnings();
                return warnings.length > 0 ? (
                  <div className="adm-validation-banner adm-validation-banner--warning adm-validation-banner--start adm-m-b-2">
                    <I icon={AlertTriangle} size={14} />
                    <div>
                      <strong>Chart data incomplete</strong>
                      <ul className="adm-warning-list">
                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
            <div className="adm-review-actions">
              <button className="be-btn be-btn-secondary" onClick={() => setLifecycleConfirm(null)}>Cancel</button>
              <button className="be-btn be-btn-primary" onClick={() => applyLifecycleChange(lifecycleConfirm)}>
                Confirm Change
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Client preview modal */}
      {previewFund && (
        <div className="adm-review-overlay" role="presentation" onMouseDown={() => setPreviewFund(null)}>
          <section className="adm-review-panel adm-review-panel--narrow" role="dialog" aria-modal="true" aria-labelledby="aum-preview-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="adm-review-head">
              <div>
                <span className="be-eyebrow">Client preview</span>
                <h2 id="aum-preview-title">{previewFund.name}</h2>
              </div>
              <button className="adm-icon-btn" onClick={() => setPreviewFund(null)} aria-label="Close"><I icon={X}/></button>
            </div>
            <div className="adm-detail-panel-stack">
              {(() => {
                const isActive = previewFund.status === 'active';
                const perf = previewFund.performanceSummary || {};
                const series = Array.isArray(previewFund.performanceSeries) ? previewFund.performanceSeries : [];
                const hasChart = series.length >= 2;
                const headline = (() => { const n = Number(perf.annualizedReturnPct); return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : null; })();
                const oneDay = (() => { const n = Number(perf.oneDayReturnPct); return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : null; })();
                const niftyPct = (() => { const n = Number(perf.niftyReturnPct); return Number.isFinite(n) ? `${n.toFixed(2)}%` : null; })();
                const metaBits = [previewFund.riskText, previewFund.category, previewFund.subCategory].filter(Boolean);
                const nav = previewFund.nav || {};
                const rating = previewFund.rating || {};
                const poolSize = previewFund.totalPoolSize ?? 0;
                const minSip = previewFund.minSip ?? 0;
                const fmtMoneyPreview = (v) => { const n = Number(v) || 0; if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`; if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`; return `₹${n.toLocaleString()}`; };
                return (
                  <div className={`adm-fund-preview ${isActive ? 'adm-fund-preview--active' : ''}`}>
                    {/* Top row */}
                    <div className="adm-fund-preview__head">
                      <span className={`adm-fund-preview__icon ${isActive ? 'adm-fund-preview__icon--active' : 'adm-fund-preview__icon--soon'}`}>{initials(previewFund.name || 'FU')}</span>
                      <div className="adm-fund-preview__title-block">
                        <h4 className="adm-fund-preview__title">{previewFund.name || 'Untitled Fund'}</h4>
                        {metaBits.length > 0 && <div className="adm-fund-preview__meta">{metaBits.join(' · ')}</div>}
                      </div>
                      <span className={`adm-fund-preview__status ${isActive ? 'adm-fund-preview__status--active' : 'adm-fund-preview__status--soon'}`}>{isActive ? 'Active' : 'Coming Soon'}</span>
                    </div>

                    {/* Performance */}
                    {headline ? (
                      <div className="adm-fund-preview__performance">
                        <span className={`adm-fund-preview__headline ${Number(perf.annualizedReturnPct) >= 0 ? 'adm-fund-preview__headline--gain' : 'adm-fund-preview__headline--loss'}`}>{headline}</span>
                        {perf.selectedPeriod && <span className="adm-fund-preview__period">{perf.selectedPeriod} annualised</span>}
                        {oneDay && <span className={`adm-fund-preview__oneday ${Number(perf.oneDayReturnPct) >= 0 ? 'adm-fund-preview__oneday--gain' : 'adm-fund-preview__oneday--loss'}`}>{oneDay} <span className="adm-text-muted">1D</span></span>}
                      </div>
                    ) : (
                      previewFund.tagline && <p className="adm-fund-preview__tagline">{previewFund.tagline}</p>
                    )}

                    {/* Mini chart placeholder */}
                    {hasChart && (
                      <div className="adm-fund-preview__chart">
                        <span className="adm-fund-preview__chart-label">📈 Mini comparison chart ({series.length} points)</span>
                        {niftyPct && <span className="adm-fund-preview__nifty">Nifty <span className="adm-text-semibold">{niftyPct}</span></span>}
                      </div>
                    )}

                    {/* Metric grid */}
                    <div className="adm-fund-preview__metrics">
                      {nav.value != null && Number.isFinite(Number(nav.value)) && (
                        <div className="adm-fund-preview__metric">
                          <span className="adm-fund-preview__metric-label">NAV{nav.asOf ? ` · ${nav.asOf}` : ''}</span>
                          <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(nav.value)}</span>
                        </div>
                      )}
                      {rating.value != null && Number.isFinite(Number(rating.value)) && (
                        <div className="adm-fund-preview__metric">
                          <span className="adm-fund-preview__metric-label">Rating</span>
                          <span className="adm-fund-preview__metric-value">{rating.value}<span className="adm-star">★</span></span>
                        </div>
                      )}
                      <div className="adm-fund-preview__metric">
                        <span className="adm-fund-preview__metric-label">Min SIP</span>
                        <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(minSip)}</span>
                      </div>
                      <div className="adm-fund-preview__metric">
                        <span className="adm-fund-preview__metric-label">Fund size</span>
                        <span className="adm-fund-preview__metric-value">{fmtMoneyPreview(poolSize)}</span>
                      </div>
                    </div>

                    {/* Sector fallback */}
                    {!headline && !hasChart && (previewFund.sectors || []).length > 0 && (
                      <SectorMiniBar sectors={previewFund.sectors.filter(s => s.percentage > 0)} height={6} className="adm-sector-mini-bar--tight" />
                    )}

                    {/* Footer */}
                    <div className="adm-fund-preview__footer">
                      {isActive ? (
                        <span className="adm-fund-preview__cta adm-fund-preview__cta--active">View details →</span>
                      ) : (
                        <span className="adm-fund-preview__cta adm-fund-preview__cta--muted">Notify me when open</span>
                      )}
                    </div>
                    <div className="adm-fund-preview__disclaimer">Past performance is not indicative of future returns.</div>
                  </div>
                );
              })()}
              <div className="adm-review-actions">
                <button className="be-btn be-btn-secondary" onClick={() => setPreviewFund(null)}>Close</button>
                <button className="be-btn be-btn-primary" onClick={() => { setPreviewFund(null); openEdit(previewFund); }}>Edit this fund</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Fund size (monthly AUM) + the disclosed stock list. Both are
          administrator-entered: this model has no market data feed and no NAV. */}
      {activeTab === 'portfolio' && (
        <div className="be-stack-4">
          <div className="adm-card-toolbar">
            <label className="adm-field">
              <span>Pool</span>
              <select value={selectedFundId || ''} onChange={(event) => setSelectedFundId(event.target.value)}>
                <option value="">Select a pool…</option>
                {funds.map((fund) => (
                  <option key={fund.id} value={fund.id}>
                    {fund.name || fund.slug}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedFundId ? (
            <>
              <FundAumPanel fundId={selectedFundId} />
              {/* Who is in the pool, and how a period's growth reaches them. */}
              <FundInvestorsPanel fundId={selectedFundId} />
              <FundStockListPanel fundId={selectedFundId} />
            </>
          ) : (
            <div className="adm-load-note">
              Choose a pool to publish its fund size, credit growth to its investors, and manage its stock
              list.
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Redemptions (Withdrawal Requests) */}
      {activeTab === 'redemptions' && (
        <AumRedemptionsTab onUserDetail={onUserDetail} />
      )}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* AUM — Allocations Tab                                                      */
/* -------------------------------------------------------------------------- */

export default AumScreen;
