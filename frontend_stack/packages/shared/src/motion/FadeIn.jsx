import React, { useRef, useState, useEffect } from 'react';
import { useReducedMotion } from './useReducedMotion.js';

/**
 * FadeIn — a scroll-triggered reveal, for RARE purposeful use.
 *
 * Not for staged page reveals. Dashboard, Explore and FundDetail wrapped 34 blocks
 * in this, each starting at opacity 0 with delays up to 400ms, so a primary tab
 * rendered empty and then assembled itself. Those call sites are gone.
 *
 * Two behavioural fixes kept here for whatever uses it next:
 *   - `will-change` is set only while the reveal is pending, not permanently. 34
 *     promoted layers sitting on a scroll container is a frame-rate problem.
 *   - reduced motion renders visible immediately with no transition at all.
 */
export default function FadeIn({
  children,
  direction = 'up',
  distance = 16,
  duration = 400,
  delay = 0,
  threshold = 0.15,
  once = true,
  as: Tag = 'div',
  className = '',
  style = {},
  ...rest
}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (reduced) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    // No IntersectionObserver (older WebView, jsdom): show the content rather than
    // leaving it invisible forever.
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(el);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, once, reduced]);

  if (reduced) {
    return <Tag ref={ref} className={className} style={style} {...rest}>{children}</Tag>;
  }

  const offset = {
    up: `translateY(${distance}px)`,
    down: `translateY(-${distance}px)`,
    left: `translateX(${distance}px)`,
    right: `translateX(-${distance}px)`,
  }[direction] || 'none';

  const computedStyle = {
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'none' : offset,
    transition: `opacity ${duration}ms cubic-bezier(0.23, 1, 0.32, 1), transform ${duration}ms cubic-bezier(0.23, 1, 0.32, 1)`,
    transitionDelay: `${delay}ms`,
    // Dropped once the reveal has run.
    willChange: isVisible ? undefined : 'opacity, transform',
    ...style,
  };

  return <Tag ref={ref} className={className} style={computedStyle} {...rest}>{children}</Tag>;
}
