import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtInt, fmtPaise, humanizeState } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * Read-only register.
 *
 * The Pause and Revoke buttons that used to sit in each row had no `onClick` and
 * no endpoint behind them — the backend exposes no mandate mutation at all — so
 * they were decoration that read as capability. A mandate is an authorisation the
 * customer gave their bank; pausing or revoking it is something they or the
 * provider does, not something an operator asserts here. The same applied to
 * "Filter status", which had no handler either.
 *
 * The columns are the ones `GET /v1/admin/mandates` actually sends. It was showing
 * `r.user`, `r.amount`, `r.day`, `r.last` and `r.next`; the endpoint sends
 * `userEmail`, `maxAmountPaise`, `debitDay`, `validFrom` and `validTo`, so five of
 * eight columns were blank on every row. There is no last-debit or next-debit field
 * to map, and no endpoint to derive one from, so those two columns are gone rather
 * than kept empty.
 */

const STATES = ['active', 'pending_user_authorization', 'paused', 'revoked', 'created', 'failed', 'expired'];

function MandatesScreen({ rows = [], loading = false, onUserDetail }) {
  // Counted from the loaded register. The previous tiles read stats.* keys that no
  // endpoint supplies, and the formatter turned those into a confident "0".
  const countBy = (status) => rows.filter((row) => row.status === status).length;
  const other = rows.length - STATES.slice(0, 4).reduce((total, state) => total + countBy(state), 0);

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Active mandates" value={fmtInt(countBy('active'))} />
        <StatTile label="Pending auth" value={fmtInt(countBy('pending_user_authorization'))} />
        <StatTile label="Paused" value={fmtInt(countBy('paused'))} />
        <StatTile label="Revoked" value={fmtInt(countBy('revoked'))} />
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Mandates</span>
            <h2 className="adm-card-title">Active register</h2>
          </div>
          <div className="adm-payment-count">{fmtInt(rows.length)} loaded</div>
        </div>
        <p className="adm-screen-note">
          Mandates are authorised, paused and revoked through the payment provider and the
          customer&rsquo;s bank. This register is the record of them, most recent first, and shows
          the maximum the customer authorised — not what has been debited.
          {other > 0 && ` ${fmtInt(other)} of these are in another state.`}
        </p>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th>Mandate</th><th>User</th><th>Max debit</th><th>Schedule</th>
                <th>SIPs</th><th className="adm-col-status">Status</th><th>Valid</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={8} />
                  <SkeletonTableRow columnCount={8} />
                  <SkeletonTableRow columnCount={8} />
                </>
              )}
              {!loading && rows.length === 0 && (
                <EmptyTableRow colSpan={8}>
                  No mandates have been created yet. One is created when a customer starts a SIP.
                </EmptyTableRow>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Mandate">
                    <div className="adm-user-info">
                      <code className="adm-code">{r.providerMandateId || r.id}</code>
                      {r.provider && <span className="adm-cell-meta">{r.provider}</span>}
                    </div>
                  </td>
                  <td data-label="User">{r.userEmail || r.userId || '—'}</td>
                  <td className="be-money" data-label="Max debit">{fmtPaise(r.maxAmountPaise)}</td>
                  <td data-label="Schedule">
                    {r.frequency ? humanizeState(r.frequency) : '—'}
                    {r.debitDay ? <span className="adm-cell-meta"> day {r.debitDay}</span> : null}
                  </td>
                  <td className="be-num" data-label="SIPs">{fmtInt(r.sipCount)}</td>
                  <td className="adm-col-status" data-label="Status"><StateBadge state={r.status} /></td>
                  <td className="adm-cell-meta" data-label="Valid">
                    {r.validFrom ? fmtDateTime(r.validFrom) : '—'}
                    {r.validTo ? ` → ${fmtDateTime(r.validTo)}` : ''}
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-ghost be-btn-sm"
                      onClick={() => onUserDetail?.(r)}
                    >
                      View user
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default MandatesScreen;
