import React, { useState } from 'react';
import logo from '@beonedge/shared/assets/logo.svg';

function AdminSidebar({ active, onChange }) {
  const groups = [
    { title: 'Operations', items: [
      { id: 'approvals', label: 'User approvals', icon: 'user-check', count: 12 },
      { id: 'kyc',       label: 'KYC review',     icon: 'shield-check', count: 4 },
      { id: 'risk',      label: 'Risk profiles',  icon: 'line-chart' },
    ]},
    { title: 'Products', items: [
      { id: 'funds',     label: 'Fund CMS',       icon: 'layers' },
      { id: 'nav',       label: 'NAV & performance', icon: 'trending-up' },
      { id: 'holdings',  label: 'Holdings',       icon: 'pie-chart' },
    ]},
    { title: 'Money', items: [
      { id: 'payments',  label: 'Payments',       icon: 'credit-card' },
      { id: 'mandates',  label: 'Mandates',       icon: 'repeat' },
      { id: 'ledger',    label: 'Ledger',         icon: 'book-open' },
      { id: 'requests',  label: 'SIP control',    icon: 'inbox', count: 3 },
    ]},
    { title: 'System', items: [
      { id: 'support',   label: 'Support tickets', icon: 'life-buoy' },
      { id: 'audit',     label: 'Audit log',       icon: 'history' },
      { id: 'env',       label: 'Environment',     icon: 'settings' },
    ]},
  ];
  return (
    <aside className="adm-side">
      <div className="adm-brand">
        <img src={logo} height="22" alt="BeOnEdge"/>
        <span className="adm-brand-tag">ADMIN</span>
      </div>
      <nav>
        {groups.map(g => (
          <div className="adm-side-group" key={g.title}>
            <div className="adm-side-title">{g.title}</div>
            {g.items.map(it => (
              <button
                key={it.id}
                className={`adm-side-item ${active === it.id ? 'is-active' : ''}`}
                onClick={() => onChange(it.id)}
              >
                <i data-lucide={it.icon}></i>
                <span>{it.label}</span>
                {it.count != null && <span className="adm-side-count">{it.count}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="adm-side-foot">
        <div className="adm-env">
          <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Production</span>
        </div>
        <div className="adm-side-user">
          <div className="adm-avatar">KS</div>
          <div>
            <div className="adm-side-user-name">Karan Shah</div>
            <div className="adm-side-user-role">Operations</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AdminTopBar({ title, breadcrumbs }) {
  return (
    <header className="adm-top">
      <div>
        <div className="adm-bread">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="adm-bread-sep">/</span>}
              <span className={i === breadcrumbs.length - 1 ? 'is-active' : ''}>{b}</span>
            </React.Fragment>
          ))}
        </div>
        <h1 className="adm-top-title">{title}</h1>
      </div>
      <div className="adm-top-actions">
        <button className="adm-icon-btn"><i data-lucide="search"></i></button>
        <button className="adm-icon-btn"><i data-lucide="bell"></i><span className="adm-icon-dot"/></button>
        <div className="adm-divider"/>
        <span className="be-disclosure">28 Apr 2026 · 18:42 IST</span>
      </div>
    </header>
  );
}

function StatTile({ label, value, delta, deltaTone, hint }) {
  return (
    <div className="adm-stat">
      <div className="be-eyebrow">{label}</div>
      <div className="adm-stat-value be-money">{value}</div>
      {delta && <div className={`adm-stat-delta be-num ${deltaTone || ''}`}>{delta}</div>}
      {hint && <div className="adm-stat-hint">{hint}</div>}
    </div>
  );
}

function ApprovalsScreen() {
  const rows = [
    { name: 'Aanya Sharma', email: 'aanya@example.in', applied: '28 Apr · 14:22', risk: 'Moderate', kyc: 'pending', flag: null },
    { name: 'Rohan Mehta', email: 'rohan.mehta@gmail.com', applied: '28 Apr · 12:10', risk: 'Aggressive', kyc: 'approved', flag: null },
    { name: 'Priya Iyer', email: 'priya.i@outlook.com', applied: '27 Apr · 19:48', risk: 'Conservative', kyc: 'pending', flag: 'Aadhaar mismatch' },
    { name: 'Vikram Rao', email: 'vikram@protonmail.com', applied: '27 Apr · 11:02', risk: 'Moderate', kyc: 'approved', flag: null },
    { name: 'Sneha Kulkarni', email: 'snehak@yahoo.in', applied: '26 Apr · 16:31', risk: 'Aggressive', kyc: 'approved', flag: null },
    { name: 'Arjun Pillai', email: 'arjun.pillai@gmail.com', applied: '26 Apr · 09:14', risk: 'Moderate', kyc: 'pending', flag: null },
  ];
  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Pending approvals" value="12" hint="6 over 24 hr SLA"/>
        <StatTile label="Approved this week" value="38" delta="+12%" deltaTone="be-gain"/>
        <StatTile label="Rejected this week" value="3" delta="−1" deltaTone="be-loss"/>
        <StatTile label="Avg. review time" value="4h 12m" hint="Target: 6h"/>
      </div>
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Pending Queue</span>
            <h3 className="adm-card-title">Awaiting approval</h3>
          </div>
          <div className="adm-card-actions">
            <button className="be-btn be-btn-secondary be-btn-sm">Filter</button>
            <button className="be-btn be-btn-secondary be-btn-sm">Export CSV</button>
          </div>
        </div>
        <table>
          <thead><tr>
            <th><input type="checkbox"/></th>
            <th>User</th><th>Applied</th><th>Risk</th><th>KYC</th><th>Notes</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.email}>
                <td><input type="checkbox"/></td>
                <td>
                  <div className="adm-user">
                    <div className="adm-avatar adm-avatar-sm">{r.name.split(' ').map(s => s[0]).join('')}</div>
                    <div>
                      <div>{r.name}</div>
                      <div className="adm-cell-meta">{r.email}</div>
                    </div>
                  </div>
                </td>
                <td className="be-num">{r.applied}</td>
                <td>{r.risk}</td>
                <td>
                  {r.kyc === 'approved'
                    ? <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Approved</span>
                    : <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Pending</span>}
                </td>
                <td>{r.flag ? <span className="adm-flag">{r.flag}</span> : <span className="adm-cell-meta">—</span>}</td>
                <td className="adm-cell-actions">
                  <button className="be-btn be-btn-secondary be-btn-sm">Review</button>
                  <button className="be-btn be-btn-primary be-btn-sm">Approve</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentsScreen() {
  const rows = [
    { id: 'PAY-2026-04-2891', user: 'Aanya Sharma', amount: '₹5,000', mode: 'UPI AutoPay', provider: 'Razorpay', status: 'success', time: '28 Apr · 09:01' },
    { id: 'PAY-2026-04-2890', user: 'Rohan Mehta', amount: '₹50,000', mode: 'UPI', provider: 'Razorpay', status: 'pending', time: '28 Apr · 08:42' },
    { id: 'PAY-2026-04-2888', user: 'Priya Iyer', amount: '₹2,000', mode: 'UPI AutoPay', provider: 'Razorpay', status: 'failed', time: '28 Apr · 02:15' },
    { id: 'PAY-2026-04-2884', user: 'Vikram Rao', amount: '₹10,000', mode: 'Netbanking', provider: 'Razorpay', status: 'success', time: '27 Apr · 22:08' },
    { id: 'PAY-2026-04-2880', user: 'Sneha Kulkarni', amount: '₹5,000', mode: 'UPI AutoPay', provider: 'Razorpay', status: 'reconciled', time: '27 Apr · 09:01' },
  ];
  const sb = s => ({
    success: <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Success</span>,
    pending: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Pending</span>,
    failed:  <span className="be-badge be-badge-failed"><span className="be-badge-dot"/>Failed</span>,
    reconciled: <span className="be-badge be-badge-neutral"><span className="be-badge-dot"/>Reconciled</span>,
  }[s]);
  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Today · processed" value="₹14,82,000" delta="+8%" deltaTone="be-gain"/>
        <StatTile label="Pending" value="6" hint="₹62,000 across 6 orders"/>
        <StatTile label="Failed (24h)" value="3" delta="−2" deltaTone="be-gain"/>
        <StatTile label="Reconciled" value="98.4%"/>
      </div>
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Ledger · Last 24 hours</span>
            <h3 className="adm-card-title">Payment activity</h3>
          </div>
          <div className="adm-card-actions">
            <button className="be-btn be-btn-secondary be-btn-sm">Reconcile</button>
            <button className="be-btn be-btn-secondary be-btn-sm">Export</button>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Reference</th><th>User</th><th>Amount</th><th>Mode</th><th>Provider</th><th>Status</th><th>Time</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><code className="adm-code">{r.id}</code></td>
                <td>{r.user}</td>
                <td className="be-money">{r.amount}</td>
                <td>{r.mode}</td>
                <td>{r.provider}</td>
                <td>{sb(r.status)}</td>
                <td className="be-num adm-cell-meta">{r.time}</td>
                <td className="adm-cell-actions">
                  <button className="be-btn be-btn-ghost be-btn-sm"><i data-lucide="more-horizontal" style={{width:14,height:14}}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MandatesScreen() {
  const rows = [
    { id: 'MND-771', user: 'Aanya Sharma', amount: '₹5,000', day: 5, status: 'active', last: '5 Apr · success', next: '5 May 2026' },
    { id: 'MND-770', user: 'Rohan Mehta', amount: '₹10,000', day: 1, status: 'pending_user_auth', last: '—', next: 'Awaiting auth' },
    { id: 'MND-768', user: 'Priya Iyer', amount: '₹2,000', day: 15, status: 'paused', last: '15 Mar · paused', next: 'On resume' },
    { id: 'MND-765', user: 'Vikram Rao', amount: '₹15,000', day: 25, status: 'active', last: '25 Apr · success', next: '25 May 2026' },
  ];
  const sb = s => ({
    active: <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Active</span>,
    pending_user_auth: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Pending auth</span>,
    paused: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Paused</span>,
    revoked: <span className="be-badge be-badge-failed"><span className="be-badge-dot"/>Revoked</span>,
  }[s]);
  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Active mandates" value="2,418"/>
        <StatTile label="Pending auth" value="34"/>
        <StatTile label="Paused" value="48"/>
        <StatTile label="AutoPay success (30d)" value="97.8%" deltaTone="be-gain"/>
      </div>
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Mandates</span>
            <h3 className="adm-card-title">Active register</h3>
          </div>
          <div className="adm-card-actions">
            <button className="be-btn be-btn-secondary be-btn-sm">Filter status</button>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Mandate</th><th>User</th><th>Amount</th><th>Debit day</th><th>Status</th><th>Last debit</th><th>Next</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><code className="adm-code">{r.id}</code></td>
                <td>{r.user}</td>
                <td className="be-money">{r.amount}</td>
                <td className="be-num">{r.day}</td>
                <td>{sb(r.status)}</td>
                <td className="adm-cell-meta">{r.last}</td>
                <td className="adm-cell-meta">{r.next}</td>
                <td className="adm-cell-actions">
                  <button className="be-btn be-btn-secondary be-btn-sm">Pause</button>
                  <button className="be-btn be-btn-danger be-btn-sm">Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export {
  AdminSidebar, AdminTopBar, StatTile,
  ApprovalsScreen, PaymentsScreen, MandatesScreen,
};
