import React from 'react';
import './PageTransition.css';

// Deliberately does not animate.
//
// It used to run a GSAP fade + 12px rise on every location change, starting the
// route at opacity 0. Three consequences: the screen was blank for the first
// frames of every navigation, so a tap looked like it had done nothing and then
// the page assembled itself like a web page; `will-change: transform` made the
// wrapper the containing block for `position: fixed` descendants (the splash still
// carries a viewport-unit workaround for that); and it was the only importer of
// gsap in the whole app.
//
// Kept as a component rather than deleted so route content still has one
// full-height wrapper and the two call sites in ClientLayout do not need to change
// shape. If a route transition is ever wanted, it must not hide content: cross-fade
// between two rendered trees, never fade one in from zero.
export default function PageTransition({ children }) {
  return <div className="be-page-transition">{children}</div>;
}
