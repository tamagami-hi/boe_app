import { useMemo, useState } from 'react';
import { ArrowRight, History, Search } from 'lucide-react';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import { fmtInt } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * An event stream, not a table per day.
 *
 * It was a `<table>` rendered once per date group, so the six-column header
 * repeated for every day on screen, and at phone width the columns that matter
 * (actor, reason) sat off the right edge.
 *
 * The expanded detail was worse: it printed
 * `{ before, after, ip: ipAddress, ua: userAgent }`, and the audit projection sends
 * NONE of those four fields — JSON.stringify drops undefined, so every "details"
 * panel on the compliance screen rendered an empty object. What the projection
 * does send, and what an auditor actually needs, is the state transition
 * (`fromState` -> `toState`), the `requestId` that ties the change to a request, the
 * entity version it produced, who the actor was and the command metadata. That is
 * what the panel shows now.
 *
 * The detail also used to be appended after ALL of a day's rows rather than under
 * the row that was expanded.
 */

function dayLabel(date) {
  if (date === 'Unknown') return 'Date not recorded';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return 'Today';
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeOf(value) {
  const text = String(value || '');
  return text.length >= 19 ? text.slice(11, 19) : '—';
}

function AuditLogScreen({ rows = [], loading = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [openId, setOpenId] = useState('');

  const actions = useMemo(() => {
    const set = new Set(rows.map((r) => r.action).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const entityTypes = useMemo(() => {
    const set = new Set(rows.map((r) => r.entityType).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch = !q || [r.action, r.entityType, r.reason, r.adminId, r.entityId]
        .some((value) => String(value || '').toLowerCase().includes(q));
      const matchesAction = actionFilter === 'all' || r.action === actionFilter;
      const matchesEntity = entityFilter === 'all' || r.entityType === entityFilter;
      return matchesSearch && matchesAction && matchesEntity;
    });
  }, [rows, searchQuery, actionFilter, entityFilter]);

  const groupedByDate = useMemo(() => {
    const map = new Map();
    for (const row of filtered) {
      const date = String(row.createdAt || '').slice(0, 10) || 'Unknown';
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(row);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // Counted from every loaded entry, not the filtered view: a tile labelled
  // "Entries today" that drops as you type in the search box is not a count.
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = rows.filter((r) => String(r.createdAt || '').startsWith(today)).length;

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Entries loaded" value={fmtInt(rows.length)} />
        <StatTile label="Entries today" value={fmtInt(todayCount)} />
        <StatTile label="Distinct commands" value={fmtInt(actions.length)} />
        <StatTile label="Entity types" value={fmtInt(entityTypes.length)} />
      </div>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Compliance</span>
            <h2 className="adm-card-title">Audit log</h2>
          </div>
        </div>

        <div className="adm-payment-filters">
          <label className="adm-search">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search the audit log</span>
            <input
              type="text"
              placeholder="Search command, entity, actor or reason"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Command</span>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">All commands</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Entity type</span>
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">All entities</option>
              {entityTypes.map((et) => <option key={et} value={et}>{et}</option>)}
            </select>
          </label>
        </div>

        {loading && rows.length === 0 && (
          <div className="be-pad-5 be-stack-2">
            <Skeleton width="100%" height="3.5rem" count={4} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="adm-empty-state">
            <I icon={History} size={32} />
            <p>
              {rows.length === 0
                ? 'No audit entries yet. Every administrative command is recorded here as it happens.'
                : 'No entries match the current filters.'}
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="be-pad-5">
            {groupedByDate.map(([date, entries]) => (
              <section key={date} className="adm-daygroup">
                <h3 className="adm-daygroup__date">{dayLabel(date)}</h3>
                <ul className="adm-stream">
                  {entries.map((r) => {
                    const isOpen = openId === r.id;
                    const panelId = `audit-detail-${r.id}`;
                    return (
                      <li key={r.id} className="adm-list-item">
                        <div className="adm-event__head">
                          <span className="adm-event__time">{timeOf(r.createdAt)}</span>
                          <code className="adm-code">{r.action || 'unknown'}</code>
                          <span className="adm-list-item__title">{r.entityType || 'entity'}</span>
                          {(r.fromState || r.toState) && (
                            <span className="adm-event__transition">
                              {r.fromState || 'new'}
                              <I icon={ArrowRight} size={12} />
                              {r.toState || '—'}
                            </span>
                          )}
                          <button
                            type="button"
                            className="be-btn be-btn-ghost be-btn-sm adm-event__toggle"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            onClick={() => setOpenId(isOpen ? '' : r.id)}
                          >
                            {isOpen ? 'Hide detail' : 'Detail'}
                          </button>
                        </div>

                        {/* The actor was sliced to 8 characters. `adminId` is the
                            actor's EMAIL when there is one, so that turned
                            "asha@example.com" into "asha@ex...". */}
                        <div className="adm-list-item__body">
                          {r.adminId || 'System'}
                          {r.reason ? ` · ${r.reason}` : ''}
                        </div>

                        {isOpen && (
                          <div className="adm-event__detail" id={panelId}>
                            <dl className="adm-decision-facts">
                              <div>
                                <dt>Entity</dt>
                                <dd><code className="adm-code">{r.entityId || '—'}</code></dd>
                              </div>
                              <div>
                                <dt>Version</dt>
                                <dd>{r.entityVersion ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Actor</dt>
                                <dd>{r.actorType || '—'}{r.adminId ? ` · ${r.adminId}` : ''}</dd>
                              </div>
                              <div>
                                <dt>Request</dt>
                                <dd><code className="adm-code">{r.requestId || '—'}</code></dd>
                              </div>
                            </dl>
                            {r.metadata !== null && r.metadata !== undefined && (
                              <pre className="adm-code-block adm-code-block--scroll adm-m-t-2">
                                {JSON.stringify(r.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AuditLogScreen;
