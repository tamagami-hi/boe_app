import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtDateTime, fmtPaise as rupees } from '../helpers/formatters.js';
import { hasAnyPermission } from '../navigation/nav.js';

/*
 * AUM snapshot history and corrections (spec §5.8, §8.3, §9.5).
 *
 * Snapshots are append-only. A correction never edits a row: it writes the next
 * revision for the same fund/date, and the highest revision wins. Correcting a
 * historical date does not recompute later snapshots.
 *
 *   GET  /v1/admin/aum/funds/:fundId/history
 *   POST /v1/admin/aum/snapshots/:snapshotId/corrections  { amountPaise, asOfDate, reasonCode, note? }
 */

function toAbsolutePaise(value) {
  const rupeesValue = Number(value);
  if (!Number.isFinite(rupeesValue) || rupeesValue < 0) return null;
  return String(Math.round(rupeesValue * 100));
}

export default function FundAumHistoryPanel({ fundId }) {
  const { user } = useAdminSession();
  // Presentation only: the backend enforces aum.write on the correction route.
  const canCorrect = hasAnyPermission(user, ['aum.write']);
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [correctingId, setCorrectingId] = useState(null);
  const [amount, setAmount] = useState('');
  const [asOfDate, setAsOfDate] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest(`/v1/admin/aum/funds/${encodeURIComponent(fundId)}/history`, {
        scope: 'admin',
      });
      setHistory(Array.isArray(payload) ? payload : payload?.items ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the AUM history.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    setCorrectingId(null);
    void load();
  }, [load]);

  function openCorrection(snapshot) {
    setCorrectingId(snapshot.id);
    setAmount(snapshot.aumPaise != null ? String(Number(snapshot.aumPaise) / 100) : '');
    setAsOfDate(snapshot.asOfDate || '');
    setReasonCode('');
    setNote('');
    setFormError('');
  }

  async function onCorrect(event) {
    event.preventDefault();
    if (lockRef.current || !correctingId) return;
    const amountPaise = toAbsolutePaise(amount);
    if (amountPaise === null) {
      setFormError('Enter the corrected AUM in rupees. Zero is allowed; negative is not.');
      return;
    }
    if (!asOfDate) {
      setFormError('Enter the as-of date the correction applies to.');
      return;
    }
    if (!reasonCode.trim()) {
      setFormError('Enter a reason code. It is recorded on the audit entry.');
      return;
    }
    const body = {
      amountPaise,
      asOfDate,
      reasonCode: reasonCode.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    lockRef.current = true;
    setBusy(true);
    setFormError('');
    try {
      await apiRequest(`/v1/admin/aum/snapshots/${encodeURIComponent(correctingId)}/corrections`, {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor(`correction:${correctingId}`, body) },
      });
      setMessage('Correction published as a new revision. The earlier snapshot is preserved.');
      setCorrectingId(null);
      invalidateAum();
      await load();
    } catch (correctError) {
      setFormError(
        correctError?.status === 409
          ? 'This snapshot was corrected already. The history was refreshed — review it first.'
          : correctError?.message || 'The correction was not published.',
      );
      if (correctError?.status === 409) await load();
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title"><I icon={History} size={16} /> Snapshot history</h3>
          <div className="adm-card-sub">
            Append-only. A correction adds a revision for the same date; the previous snapshot is
            never mutated.
          </div>
        </div>
      </div>

      {error && <div className="be-error" role="alert">{error}</div>}
      {message && <div className="adm-gain-result" role="status">{message}</div>}

      <div className="adm-table-scroll">
        <table>
          <thead>
            <tr>
              <th>As of</th>
              <th>Revision</th>
              <th>AUM</th>
              <th>Reason</th>
              <th>Published</th>
              {canCorrect && <th className="adm-col-actions"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <SkeletonTableRow columnCount={canCorrect ? 6 : 5} />
                <SkeletonTableRow columnCount={canCorrect ? 6 : 5} />
              </>
            )}
            {!loading && !error && history.length === 0 && (
              <EmptyTableRow colSpan={canCorrect ? 6 : 5}>
                No AUM has been published for this fund yet.
              </EmptyTableRow>
            )}
            {history.map((snapshot, index) => [
              <tr key={snapshot.id}>
                <td data-label="As of">{snapshot.asOfDate}</td>
                <td className="be-num" data-label="Revision">
                  {snapshot.revision}
                  {index === 0 && <span className="adm-cell-meta"> · authoritative</span>}
                </td>
                <td className="be-money" data-label="AUM">{rupees(snapshot.aumPaise)}</td>
                <td data-label="Reason">{snapshot.reasonCode || '—'}</td>
                <td className="be-num adm-cell-meta" data-label="Published">
                  {snapshot.createdAt ? fmtDateTime(snapshot.createdAt) : '—'}
                </td>
                {canCorrect && (
                  <td className="adm-col-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-secondary be-btn-sm"
                      aria-expanded={correctingId === snapshot.id}
                      onClick={() => (correctingId === snapshot.id ? setCorrectingId(null) : openCorrection(snapshot))}
                    >
                      {correctingId === snapshot.id ? 'Close' : 'Correct'}
                    </button>
                  </td>
                )}
              </tr>,
              correctingId === snapshot.id ? (
                <tr key={`${snapshot.id}-correction`} className="adm-decision-row">
                  <td colSpan={canCorrect ? 6 : 5}>
                    <form className="adm-form-grid" onSubmit={onCorrect}>
                      <label className="adm-field">
                        <span>Corrected AUM (₹)</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </label>
                      <label className="adm-field">
                        <span>As-of date</span>
                        <input
                          type="date"
                          value={asOfDate}
                          onChange={(event) => setAsOfDate(event.target.value)}
                        />
                      </label>
                      <label className="adm-field">
                        <span>Reason code</span>
                        <input
                          type="text"
                          value={reasonCode}
                          onChange={(event) => setReasonCode(event.target.value)}
                          placeholder="e.g. valuation_error"
                        />
                      </label>
                      <label className="adm-field adm-field--wide">
                        <span>Private note (optional)</span>
                        <input
                          type="text"
                          maxLength={2000}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </label>
                      {formError && (
                        <div className="be-error adm-field--wide" role="alert">{formError}</div>
                      )}
                      <div className="adm-field--wide">
                        <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
                          {busy ? 'Publishing…' : 'Publish correction'}
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
