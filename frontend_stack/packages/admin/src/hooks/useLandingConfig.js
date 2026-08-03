import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, useHttpApi } from '@beonedge/client/services/_util.js';
import { LANDING_DEFAULTS } from '../features/site/landingDefaults.js';

// Loads the published landing config, overlays it on the built-in defaults
// (field-wise: published values win, defaults fill anything a partial
// publish left out; arrays replace wholesale), tracks unpublished edits,
// and publishes new versions.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(defaults, published) {
  if (published === undefined || published === null) return defaults;
  if (!isPlainObject(defaults) || !isPlainObject(published)) return published;
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(published)) {
    merged[key] = deepMerge(defaults[key], value);
  }
  return merged;
}

function mergeWithDefaults(published) {
  const merged = {};
  for (const [section, defaults] of Object.entries(LANDING_DEFAULTS)) {
    merged[section] = deepMerge(defaults, published?.[section]);
  }
  return merged;
}

export default function useLandingConfig() {
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [versionMeta, setVersionMeta] = useState({ version: null, publishedAt: null, publishedBy: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError('');

    // Fixture mode: render the built-in defaults instead of failing. The
    // canonical `/v1/admin/landing-config` endpoint is still unbuilt (marketing
    // content has no canonical table yet), so http mode surfaces that error.
    if (!useHttpApi()) {
      const merged = mergeWithDefaults(null);
      if (reqId !== reqRef.current) return;
      setDraft(merged);
      setBaseline(merged);
      setVersionMeta({ version: null, publishedAt: null, publishedBy: null });
      setLoading(false);
      return;
    }

    try {
      const payload = await apiRequest('/v1/admin/landing-config', { scope: 'admin' });
      if (reqId !== reqRef.current) return;
      const merged = mergeWithDefaults(payload?.config);
      setDraft(merged);
      setBaseline(merged);
      setVersionMeta({
        version: payload?.version ?? null,
        publishedAt: payload?.publishedAt ?? null,
        publishedBy: payload?.publishedBy ?? null,
      });
      setLoading(false);
    } catch (requestError) {
      if (reqId !== reqRef.current) return;
      setError(requestError?.message || 'Could not load the landing configuration.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setSection = useCallback((sectionId, nextValue) => {
    setDraft((prev) => (prev ? { ...prev, [sectionId]: nextValue } : prev));
  }, []);

  const dirtySections = useMemo(() => {
    if (!draft || !baseline) return new Set();
    const dirty = new Set();
    for (const section of Object.keys(draft)) {
      if (JSON.stringify(draft[section]) !== JSON.stringify(baseline[section])) {
        dirty.add(section);
      }
    }
    return dirty;
  }, [draft, baseline]);

  const publish = useCallback(async (reason) => {
    setPublishing(true);
    try {
      const payload = await apiRequest('/v1/admin/landing-config', {
        method: 'PATCH',
        body: { config: draft, reason: reason || undefined },
        scope: 'admin',
      });
      const merged = mergeWithDefaults(payload?.config);
      setDraft(merged);
      setBaseline(merged);
      setVersionMeta({
        version: payload?.version ?? null,
        publishedAt: payload?.publishedAt ?? null,
        publishedBy: payload?.publishedBy ?? null,
      });
      return payload;
    } finally {
      setPublishing(false);
    }
  }, [draft]);

  // Warn before leaving the page with unpublished edits.
  useEffect(() => {
    if (dirtySections.size === 0) return undefined;
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtySections]);

  return {
    draft,
    setSection,
    dirtySections,
    versionMeta,
    loading,
    error,
    publishing,
    publish,
    reload,
  };
}
