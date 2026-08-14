import { useEffect, useState } from 'react';

/**
 * Detects prefers-reduced-motion and returns a boolean.
 * Also returns a `motionProps` helper that strips transform/animation
 * props when reduced motion is preferred, falling back to opacity crossfades.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // Guarded: a missing matchMedia used to throw inside the effect, which unmounts
    // the whole subtree. Not animating is the safe fallback.
    const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (!mql) return undefined;

    setReduced(mql.matches);
    const handler = (e) => setReduced(e.matches);
    // Safari < 14 and some WebViews only have the deprecated listener API.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  return reduced;
}

/**
 * Returns style props for an element based on reduced-motion preference.
 * When reduced motion is on, skips transform/position animations and uses
 * opacity-only crossfades. When off, returns the animated style.
 */
export function getMotionStyle(reduced, animatedStyle, fallbackStyle = {}) {
  if (reduced) {
    // Keep opacity transitions but strip transforms
    const { opacity, ...rest } = animatedStyle;
    return { ...fallbackStyle, ...(opacity !== undefined && { opacity }) };
  }
  return animatedStyle;
}
