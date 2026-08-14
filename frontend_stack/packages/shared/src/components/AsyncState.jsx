import React from 'react';
import Skeleton from './Skeleton.jsx';
import EmptyState from './EmptyState.jsx';
import ErrorState from './ErrorState.jsx';
import { isDegraded } from '../net/connectivity.js';
import './AsyncState.css';

// One place that decides what a screen shows while a read is in flight, has failed,
// or came back empty. Every page was branching on this by hand and getting it
// subtly wrong: a failed read left a skeleton on screen forever, or fell through to
// an empty state that read as "you have no investments".
//
// The rules, in order:
//   1. data present  -> children, ALWAYS. A refresh or a failed refresh never
//                       replaces content the user is already reading.
//   2. loading       -> skeleton
//   3. error         -> ErrorState with a retry
//   4. empty         -> EmptyState
//
// Pass the resource object from useResource directly as `resource`, or the
// individual flags.

// A retained value is labelled with the time it was read whenever it can no longer
// be confirmed, so figures are never presented as live while offline.
function asOf(updatedAt) {
  if (!updatedAt) return '';
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return '';
  return ` as of ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

export default function AsyncState({
  resource,
  isLoading,
  error,
  isRefreshing,
  hasData,
  isEmpty = false,
  onRetry,
  skeleton,
  empty,
  errorTitle,
  errorDescription,
  children,
  className = '',
}) {
  const loading = isLoading ?? resource?.isLoading ?? false;
  const failure = error ?? resource?.error ?? null;
  const refreshing = isRefreshing ?? resource?.isRefreshing ?? false;
  const present = hasData ?? (resource ? resource.data !== undefined : undefined);
  const retry = onRetry ?? resource?.refresh;
  const degraded = isDegraded();

  const content = typeof children === 'function' ? children(resource?.data) : children;

  if (present && !isEmpty) {
    // A Fragment, not a wrapper: a wrapper element would break a grid or flex parent
    // that expects the content as its direct child.
    return (
      <>
        {(failure || degraded) && (
          <div className="be-async__stale" role="status">
            <span>
              {degraded && !failure
                ? `Not connected. Showing the last values we loaded${asOf(resource?.updatedAt)}.`
                : `Showing the last values we could load${asOf(resource?.updatedAt)}.`}
            </span>
            {retry && (
              <button type="button" className="be-async__retry" onClick={retry} disabled={refreshing}>
                {refreshing ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </div>
        )}
        {content}
      </>
    );
  }

  if (loading) {
    return (
      <div className={`be-async ${className}`} aria-busy="true">
        {skeleton ?? <Skeleton variant="text" height="56px" count={3} />}
      </div>
    );
  }

  if (failure) {
    return (
      <div className={`be-async ${className}`}>
        <ErrorState
          title={errorTitle}
          description={errorDescription}
          onRetry={retry}
          busy={refreshing}
        />
      </div>
    );
  }

  if (isEmpty || present) {
    return (
      <div className={`be-async ${className}`}>
        {empty ?? <EmptyState title="Nothing here yet" />}
      </div>
    );
  }

  // Not started: a resource whose key is null (an id that is not known yet).
  return null;
}
