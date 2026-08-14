import React, { useCallback, useEffect, useId, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { EmptyState, ErrorState, FormField, ListRow } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as supportApi from '../services/supportApi.js';
import { fmtDate } from '../utils/format.js';

const CATEGORIES = [
  ['general', 'General'], ['technical', 'Technical'], ['billing', 'Billing'],
  ['kyc', 'KYC'], ['sip', 'SIP'], ['withdrawal', 'Withdrawal'], ['mandate', 'Mandate'],
];

/**
 * One FAQ. A real disclosure button rather than a `<div onClick>`: the heading was
 * unfocusable, unreachable by keyboard, and gave AT no indication it expanded.
 */
function Faq({ question, answer, open, onToggle }) {
  const panelId = useId();
  return (
    <div className="apk-faq-item">
      <button
        type="button"
        className="apk-faq-q"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span>{question}</span>
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className={`apk-faq-chevron ${open ? 'is-open' : ''}`}
        />
      </button>
      {/* Kept mounted but hidden so aria-controls always resolves to a real node. */}
      <div className="apk-faq-a" id={panelId} hidden={!open}>{answer}</div>
    </div>
  );
}

export default function Support() {
  const [faqs, setFaqs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [openIdx, setOpenIdx] = useState(-1);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [loadError, setLoadError] = useState('');

  // A failed read used to set both lists to [], so an outage looked like "you have
  // no tickets" — on the screen an investor opens to check a request they filed.
  const load = useCallback(() => {
    setLoadError('');
    Promise.all([supportApi.listFaqs(), supportApi.listTickets()])
      .then(([faqList, ticketList]) => {
        setFaqs(faqList);
        setTickets(ticketList);
      })
      .catch((error) => setLoadError(error?.message || 'Could not load support content.'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = faqs.filter((f) => {
    const question = (f.q || f.question || '').toLowerCase();
    const answer = (f.a || f.answer || '').toLowerCase();
    const search = q.toLowerCase();
    return question.includes(search) || answer.includes(search);
  });

  async function submit() {
    if (!subject || !body || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await supportApi.createTicket({ subject, body, category });
      setTickets((s) => [created, ...s]);
      setShowForm(false);
      setSubject('');
      setBody('');
    } catch (error) {
      // The request failed, so the form stays filled in and says so. It used to
      // close and prepend an `undefined` ticket on failure.
      setSubmitError(error?.message || 'We could not send that. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppBar title="Support" />
      <div className="apk-screen">
        <div className="apk-search">
          <Search size={18} strokeWidth={1.5} aria-hidden="true" />
          <input
            className="be-input"
            placeholder="Search help articles"
            aria-label="Search help articles"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="be-card apk-faq-card">
          {filtered.length === 0 ? (
            <div className="apk-faq-empty">No matching articles. Open a ticket below.</div>
          ) : filtered.map((f, i) => (
            <Faq
              key={f.id || f.q || f.question || i}
              question={f.q || f.question}
              answer={f.a || f.answer}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
            />
          ))}
        </div>

        <div className="be-card apk-help-card">
          <div className="apk-help-title">Still need help?</div>
          {/* Was "We respond within 1 business day." There is no operator queue
              behind this yet, so the app must not commit to a response time it
              cannot keep. What IS true: the request is recorded with a reference. */}
          <div className="apk-help-subtitle">
            We record your request with a reference you can quote.
          </div>
          <div className="apk-help-actions">
            <button type="button" className="be-btn be-btn-primary" onClick={() => setShowForm(true)}>
              Open a ticket
            </button>
            <a className="be-btn be-btn-secondary" href="mailto:support@beonedge.example">Email us</a>
          </div>
        </div>

        {showForm && (
          <div className="be-card apk-ticket-form">
            {/* Every control is now labelled through FormField. The labels were
                bare `<label>` elements with no `for`, so a screen reader announced
                three unlabelled inputs. */}
            <FormField label="Subject" required>
              <input className="be-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </FormField>
            <FormField label="Category">
              <select className="be-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Describe the issue" required error={submitError || undefined}>
              <textarea className="be-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            </FormField>
            <div className="apk-ticket-actions">
              <button type="button" className="be-btn be-btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="be-btn be-btn-primary"
                onClick={submit}
                disabled={submitting || !subject || !body}
              >
                {submitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </div>
        )}

        <div className="be-eyebrow">My tickets</div>
        <div className="be-card be-card--flush">
          {loadError ? (
            <ErrorState
              title="We could not load your requests"
              description={loadError}
              onRetry={load}
            />
          ) : tickets.length === 0 ? (
            <EmptyState title="No tickets yet" description="Anything you raise appears here with its reference." />
          ) : tickets.map((t) => (
            <ListRow
              key={t.id}
              title={t.subject}
              // The backend mints a short quotable handle (BOE-XXXXXXXX) precisely
              // so the investor can cite it. The UI used to discard it.
              meta={[t.reference, t.updatedAt && `Updated ${fmtDate(t.updatedAt)}`].filter(Boolean).join(' · ')}
              trailing={
                <span className={'be-badge ' + (t.status === 'open' ? 'be-badge-paused' : 'be-badge-active')}>
                  <span className="be-badge-dot" />{t.status}
                </span>
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
