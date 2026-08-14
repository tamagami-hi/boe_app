import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import useAdminList from '../hooks/useAdminList.js';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { initials, displayRole, fmtDateTime, fmtInt } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * Declared at module scope on purpose.
 *
 * This was defined inside the component body, so every render produced a new
 * component type and React unmounted and remounted all three header buttons. With
 * the search box re-rendering on each keystroke that meant the sort control under
 * the operator's finger was destroyed mid-interaction, taking keyboard focus with
 * it.
 */
function SortHeader({ label, column, className, sortKey, sortDir, onSort }) {
  const active = sortKey === column;
  return (
    <th className={className} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(column)}>
        {label}
        {active && <span aria-hidden="true">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
        <span className="adm-sr-only">{active ? (sortDir === 'asc' ? ' sorted ascending' : ' sorted descending') : ' not sorted'}</span>
      </button>
    </th>
  );
}

export default function UserDetailsListScreen({ onUserDetail }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [limit, setLimit] = useState(25);
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  // Debounce the search box so each keystroke does not open a new keyset page.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { items: users, loading, error, hasMore, loadMore, reload } = useAdminList(
    '/v1/admin/users',
    { status, q: search },
    { limit },
  );

  const sortedUsers = [...users].sort((a, b) => {
    const aVal = a[sortKey] || '';
    const bVal = b[sortKey] || '';
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortProps = { sortKey, sortDir, onSort: toggleSort };

  return (
    <div className="adm-screen">
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Client Directory</span>
            <h2 className="adm-card-title">Approved Users</h2>
          </div>
          <div className="adm-card-actions">
            <span className="adm-cell-meta">{fmtInt(users.length)} loaded</span>
          </div>
        </div>

        <div className="adm-toolbar">
          <label className="adm-search adm-search--grow">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search users</span>
            <input
              type="text"
              placeholder="Search by name, email or phone..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="adm-filter">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Account status">
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="suspended">Suspended</option>
              <option value="closed">Closed</option>
              <option value="all">All statuses</option>
            </select>
          </div>
          <div className="adm-filter">
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Page size">
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>

        {/*
          A failed read used to render as a bare unannounced note with the empty
          state underneath it, so the directory said "No users match this filter
          yet" when the truth was that it had not managed to ask.
        */}
        {error && (
          <div className="ash-load-note" role="alert">
            <span>{error}</span>
            <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
              <I icon={RefreshCw} size={13} />
              {loading ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        )}

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <SortHeader label="User" column="name" className="adm-col-user" {...sortProps} />
                <SortHeader label="Signed up" column="createdAt" className="adm-col-date" {...sortProps} />
                {/* Sorted by `activatedAt`, the field the cell renders. It sorted on
                    `approvedAt`, which no user record carries, so this column's sort
                    silently did nothing. */}
                <SortHeader label="Approved" column="activatedAt" className="adm-col-date" {...sortProps} />
                <th className="adm-col-status">Status</th>
                <th className="adm-col-role">Role</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading && sortedUsers.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={6} />
                  <SkeletonTableRow columnCount={6} />
                  <SkeletonTableRow columnCount={6} />
                </>
              )}
              {!loading && !error && sortedUsers.length === 0 && (
                <EmptyTableRow colSpan={6}>
                  No users match this filter yet. Approved clients appear here automatically.
                </EmptyTableRow>
              )}
              {sortedUsers.map((r) => (
                <tr key={r.id || r.email}>
                  <td className="adm-col-user" data-label="User">
                    <div className="adm-user">
                      <div className="adm-avatar adm-avatar-sm">{initials(r.name, 'CL')}</div>
                      <div className="adm-user-info">
                        <div className="adm-user-name">{r.name}</div>
                        <div className="adm-cell-meta">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="adm-col-date" data-label="Signed up">
                    <span className="adm-cell-meta">{r.createdAt ? fmtDateTime(r.createdAt) : '—'}</span>
                  </td>
                  <td className="adm-col-date" data-label="Approved">
                    <span className="adm-cell-meta">{r.activatedAt ? fmtDateTime(r.activatedAt) : '—'}</span>
                  </td>
                  <td className="adm-col-status" data-label="Status">
                    <StateBadge state={r.status || 'active'} />
                  </td>
                  <td className="adm-col-role" data-label="Role">{displayRole(r)}</td>
                  <td className="adm-col-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-ghost be-btn-sm"
                      onClick={() => onUserDetail?.(r)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sorting is client-side over the pages loaded so far — say so, because a
            "Signed up ▲" header otherwise reads as the oldest account overall. */}
        {sortedUsers.length > 0 && hasMore && (
          <p className="adm-screen-note">Sorting applies to the {fmtInt(users.length)} rows loaded so far.</p>
        )}

        {hasMore && (
          <div className="adm-toolbar adm-toolbar--center adm-toolbar--bordered adm-toolbar--gap-2">
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" disabled={loading} onClick={loadMore}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
