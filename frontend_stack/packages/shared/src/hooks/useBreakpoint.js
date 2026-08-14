import { useEffect, useState } from 'react';

/**
 * useBreakpoint — shared media-query hook.
 *
 * Documented breakpoints:
 *   sm: 375px  | md: 430px  | lg: 768px
 *   sidebar-collapse: 1100px
 *   mobile: <= 768px
 *
 * @param {number} [breakpoint=768] — width in px at/below which the hook returns true
 * @returns {boolean} whether the viewport matches `(max-width: breakpoint px)`
 */
export default function useBreakpoint(breakpoint = 768) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Guarded: a missing matchMedia used to throw inside the effect, which unmounts
    // the whole subtree. Treating the viewport as wide is the safe fallback — the
    // desktop layout works at any width, a phone-only layout does not.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMatches(query.matches);

    update();

    // Modern API with fallback for older Safari.
    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, [breakpoint]);

  return matches;
}
