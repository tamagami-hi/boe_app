import { useEffect, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';
import useAdminList from '../hooks/useAdminList.js';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import { initials, displayRole, fmtInt } from '../helpers/formatters.js';
import './admin-screens-shared.css';

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

  const { items: users, loading, error, hasMore, loadMore } = useAdminList(
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

  function SortHeader({ label, column, className }) {
    const active = sortKey === column;
    return (
      <th className={className} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleSort(column)}>
          {label}
          {active && <span aria-hidden="true">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
          <span className="adm-sr-only">{active ? (sortDir === 'asc' ? ' sorted ascending' : ' sorted descending') : ' not sorted'}</span>
        </button>
      </th>
    );
  }

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
          <div className="adm-search adm-search--grow">
            <I icon={Search} size={14} />
            <input
              type="text"
              placeholder="Search by name, email or phone..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
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

        {error && <div className="adm-load-note">{error}</div>}

        <div className="adm-table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader label="User" column="name" className="adm-col-user" />
                <SortHeader label="Signed up" column="createdAt" className="adm-col-date" />
                <SortHeader label="Approved" column="approvedAt" className="adm-col-date" />
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
                  <SkeletonTableRow columnCount={6} />
                  <SkeletonTableRow columnCount={6} />
                </>
              )}
              {!loading && sortedUsers.length === 0 && (
                <EmptyTableRow colSpan={6}>
                  No users match this filter yet. Approved clients appear here automatically.
                </EmptyTableRow>
              )}
              {sortedUsers.map((r) => (
                <tr key={r.id || r.email}>
                  <td className="adm-col-user">
                    <div className="adm-user">
                      <div className="adm-avatar adm-avatar-sm">{initials(r.name, 'CL')}</div>
                      <div className="adm-user-info">
                        <div className="adm-user-name">{r.name}</div>
                        <div className="adm-cell-meta">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="adm-col-date">
                    <span className="adm-cell-meta">{r.createdAt || '—'}</span>
                  </td>
                  <td className="adm-col-date">
                    <span className="adm-cell-meta">{r.activatedAt || '—'}</span>
                  </td>
                  <td className="adm-col-status">
                    <span className="be-badge be-badge-green"><CheckCircle2 size={12} /> {r.status || 'active'}</span>
                  </td>
                  <td className="adm-col-role">{displayRole(r)}</td>
                  <td className="adm-col-actions">
                    <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => onUserDetail?.(r)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div className="adm-toolbar adm-toolbar--center adm-toolbar--bordered adm-toolbar--gap-2">
            <button className="be-btn be-btn-secondary be-btn-sm" disabled={loading} onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
