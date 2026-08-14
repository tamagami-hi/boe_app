import { RefreshCw } from 'lucide-react';
import I from '../components/I.jsx';

// Replaces the shell's global `loadNote`, which reported failures for all six
// collections from the top of every page — including screens that did not use the
// collection that failed, and never next to the empty table it was explaining.
// Renders nothing when all resources succeeded.
export default function AdminReadError({ resources = [] }) {
  const failed = resources.filter((resource) => resource?.error);
  if (failed.length === 0) return null;

  const busy = failed.some((resource) => resource.isRefreshing);
  const detail = failed
    .map((resource) => `${resource.label}: ${resource.error?.message || 'read failed'}`)
    .join('; ');

  function retry() {
    for (const resource of failed) resource.refresh?.();
  }

  return (
    <div className="ash-load-note" role="alert">
      <span>Some data on this screen could not be loaded — {detail}</span>
      <button
        type="button"
        className="ash-btn ash-btn-secondary ash-btn-sm"
        onClick={retry}
        disabled={busy}
      >
        <I icon={RefreshCw} size={13} />
        {busy ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
