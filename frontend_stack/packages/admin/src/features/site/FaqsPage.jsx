import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAdminFaqs } from '../../data/adminResources.js';
import { StatusBadge, StatusFilterChips } from './fields.jsx';
import FaqEditorDrawer from './FaqEditorDrawer.jsx';
import I from '../../components/I.jsx';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

const NEW_FAQ = {};

export default function FaqsPage() {
  const faqs = useAdminFaqs();
  const { rows: items, isLoading: loading, refresh: reload } = faqs;
  const error = faqs.error ? faqs.error.message || 'Could not load data.' : '';
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null);

  const visible = useMemo(() => {
    const filtered = statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter);
    return [...filtered].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [items, statusFilter]);

  return (
    <div className="ash-page">
      {error && (
        <div className="ash-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" onClick={reload}>Retry</button>
        </div>
      )}

      <div className="ash-card">
        <div className="ash-card-head">
          <div>
            <h2 className="ash-card-title">FAQs</h2>
            <div className="ash-card-sub">Answers shown in client app support. Published entries are visible to users.</div>
          </div>
          <button type="button" className="ash-btn ash-btn-primary" onClick={() => setEditing(NEW_FAQ)}>
            <I icon={Plus} size={14} />
            New FAQ
          </button>
        </div>

        <div className="ash-card-toolbar">
          <StatusFilterChips value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
        </div>

        <div className="ash-table-wrap">
          <table className="ash-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Category</th>
                <th>Order</th>
                <th>Status</th>
                <th className="adm-col-actions" />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 3 }, (_, index) => (
                <tr key={index} aria-hidden="true">
                  <td colSpan={5}><div className="ash-skel" /></td>
                </tr>
              ))}
              {!loading && visible.map((faq) => (
                <tr key={faq.id}>
                  <td data-label="Question">
                    <div className="ash-cell-main">{faq.question}</div>
                    <div className="ash-cell-sub">{String(faq.answer || '').slice(0, 90)}</div>
                  </td>
                  <td data-label="Category">{faq.category}</td>
                  <td data-label="Order" className="ash-cell-num">{faq.order ?? 0}</td>
                  <td data-label="Status"><StatusBadge status={faq.status} /></td>
                  {}
                  <td data-label="" className="adm-col-actions">
                    <button
                      type="button"
                      className="be-btn be-btn-ghost be-btn-sm"
                      onClick={() => setEditing(faq)}
                    >
                      Edit<span className="adm-sr-only"> {faq.question}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && visible.length === 0 && !error && (
            <div className="ash-empty ash-empty-table">
              <div className="ash-empty-title">
                {statusFilter === 'all' ? 'No FAQs yet' : `No ${statusFilter} FAQs`}
              </div>
              <p className="ash-empty-desc">
                FAQs start as drafts. Publish one and it becomes visible in client app support.
              </p>
              {statusFilter === 'all' && (
                <button type="button" className="ash-btn ash-btn-primary" onClick={() => setEditing(NEW_FAQ)}>
                  Create the first FAQ
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <FaqEditorDrawer
        open={editing !== null}
        faq={editing === NEW_FAQ ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </div>
  );
}
