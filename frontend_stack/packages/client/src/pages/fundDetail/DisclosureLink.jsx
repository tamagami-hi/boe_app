import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DESTINATION_KIND } from '../../navigation/routes.js';
import { openExternal } from '../../utils/openExternal.js';

/**
 * A disclosure link whose destination was classified at the service edge.
 *
 * Internal → router link. External HTTPS → the validated external opener (in the
 * APK that means the Capacitor browser view, not an in-WebView navigation that
 * would strand the user outside the app with no chrome). Refused → the row is not
 * rendered at all: a disclosure link that goes nowhere is worse than its absence,
 * because the surrounding copy implies a regulatory obligation was met.
 */
export default function DisclosureLink({ destination, icon: Icon, label }) {
  const [failed, setFailed] = useState(false);

  if (destination?.kind === DESTINATION_KIND.INTERNAL) {
    return (
      <Link className="apk-disclosure-link" to={destination.path}>
        <Icon size={14} strokeWidth={2} />
        {label}
      </Link>
    );
  }

  if (destination?.kind === DESTINATION_KIND.EXTERNAL) {
    return (
      <button
        type="button"
        className="apk-disclosure-link"
        onClick={async () => {
          const result = await openExternal(destination.url);
          setFailed(!result.ok);
        }}
      >
        <Icon size={14} strokeWidth={2} />
        {failed ? `${label} — couldn\u2019t open` : label}
      </button>
    );
  }

  return null;
}
