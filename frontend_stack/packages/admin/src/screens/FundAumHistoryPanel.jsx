import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, History, RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { AUM_CORRECTION_REASONS } from '../helpers/aumReasons.js';
import { fmtDateTime, fmtPaise as rupees } from '../helpers/formatters.js';
import { hasAnyPermission } from '../navigation/nav.js';
import { toAbsolutePaise } from '../helpers/signedAmounts.js';
import useAumHistory from './useAumHistory.js';

export default function FundAumHistoryPanel({ fundId, fundName }) {
  const { user } = useAdminSession();
  const canCorrect = hasAnyPermission(user, ['aum.write']);
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();
  const history = useAumHistory(fundId);

  const [correcting, setCorrecting] = useState(null);
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false);
  const formRef = useRef(null);

  useEffect(() => {
    setCorrecting(null);
  }, [fundId]);

  useEffect(() => {
    if (correcting && formRef.current) formRef.current.focus();
  }, [correcting]);

  function openCorrection(snapshot) {
    setCorrecting(snapshot);
    setAmount(snapshot.aumPaise != null ? String(Number(snapshot.aumPaise) / 100) : '');
    setReasonCode('');
    setNote('');
    setFormError('');
    setMessage('');
  }

  async function onCorrect(event) {
    event.preventDefault();
    if (lockRef.current || !correcting) return;
    const aumPaise = toAbsolutePaise(amount);
    if (aumPaise === null) {
      setFormError('Enter the corrected AUM in rupees. Zero is allowed; negative is not.');
      return;
    }
    if (!AUM_CORRECTION_REASONS.some((reason) => reason.value === reasonCode)) {
      setFormError('Choose a reason. It is recorded on the audit entry.');
      return;
    }
    const trimmedNote = note.trim();
    const body = {
      aumPaise,
      reasonCode,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    };
    lockRef.current = true;
    setBusy(true);
    setFormError('');
    try {
      await apiRequest(`/v1/admin/aum/snapshots/${encodeURIComponent(correcting.id)}/corrections`, {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor(`correction:${correcting.id}`, body) },
      });
      setMessage('Correction published as a new revision. The earlier snapshot is preserved.');
      setCorrecting(null);
      invalidateAum();
      await history.reload();
    } catch (correctError) {
      setFormError(
        correctError?.status === 409
          ? 'This snapshot is no longer the authoritative revision for its date. The history was refreshed — review it first.'
          : correctError?.message || 'The correction was not published.',
      );
      if (correctError?.status === 409) await history.reload();
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  const columnCount = canCorrect ? 6 : 5;

  return (
    <div className="adm-card adm-table">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title"><I icon={History} size={16} /> Snapshot history</h3>
          <div className="adm-card-sub">
            {fundName ? `${fundName} — ` : ''}
            append-only, newest first. A correction adds a revision for the same date; the previous
            snapshot is never changed.
          </div>
        </div>
      </div>

      {history.error !== '' && (
        <div className="adm-read-failure">
          <div
            className="adm-validation-banner adm-validation-banner--error adm-validation-banner--start"
            role="alert"
          >
            <I icon={AlertTriangle} size={14} /> {history.error}
          </div>
          <button
            type="button"
            className="be-btn be-btn-secondary be-btn-sm"
            onClick={() => history.reload()}
            disabled={history.loading}
          >
            <I icon={RefreshCw} size={13} /> Try again
          </button>
        </div>
      )}
      {message && <div className="adm-gain-result adm-inline-note" role="status">{message}</div>}

      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th scope="col">As of</th>
              <th scope="col">Revision</th>
              <th scope="col">AUM</th>
              <th scope="col">Reason</th>
              <th scope="col">Published</th>
              {canCorrect && (
                <th scope="col" className="adm-col-actions"><span className="adm-sr-only">Actions</span></th>
              )}
            </tr>
          </thead>
          <tbody>
            {history.loading && (
              <>
                <SkeletonTableRow columnCount={columnCount} />
                <SkeletonTableRow columnCount={columnCount} />
              </>
            )}
            {!history.loading && history.error === '' && history.rows.length === 0 && (
              <EmptyTableRow colSpan={columnCount}>
                No AUM has been published for this fund yet.
              </EmptyTableRow>
            )}
            {history.rows.map((snapshot, index) => (
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
                      aria-expanded={correcting?.id === snapshot.id}
                      aria-controls="aum-correction-form"
                      onClick={() => (correcting?.id === snapshot.id
                        ? setCorrecting(null)
                        : openCorrection(snapshot))}
                    >
                      {correcting?.id === snapshot.id ? 'Close' : 'Correct'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.hasMore && (
        <div className="adm-table-foot">
          <span className="adm-cell-meta">Showing the {history.rows.length} newest snapshots.</span>
          <button
            type="button"
            className="be-btn be-btn-secondary be-btn-sm"
            onClick={() => history.loadMore()}
            disabled={history.loadingMore}
          >
            {history.loadingMore ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}

      {correcting && (
        <section
          className="adm-correction-panel"
          id="aum-correction-form"
          aria-label={`Correct the AUM published for ${correcting.asOfDate}`}
          tabIndex={-1}
          ref={formRef}
        >
          <h4 className="adm-correction-title">
            Correct revision {correcting.revision} of {correcting.asOfDate}
          </h4>
          <p className="adm-screen-note">
            The corrected date is fixed by the snapshot being corrected. This publishes revision
            {' '}{correcting.revision + 1} for the same date; nothing on other dates is recalculated.
          </p>
          <form className="adm-form-grid" onSubmit={onCorrect}>
            <label className="adm-field">
              <span className="adm-field-label">Corrected AUM (₹)</span>
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
              <span className="adm-field-label">Reason</span>
              <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                <option value="">Choose a reason</option>
                {AUM_CORRECTION_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            </label>
            <label className="adm-field adm-field--wide">
              <span className="adm-field-label">Internal note (optional)</span>
              <textarea
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {formError && (
              <div className="be-error adm-field--wide" role="alert">{formError}</div>
            )}
            <div className="adm-field--wide adm-form-actions adm-form-actions--start">
              <button
                type="button"
                className="be-btn be-btn-secondary"
                onClick={() => setCorrecting(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
                {busy ? 'Publishing…' : 'Publish correction'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
