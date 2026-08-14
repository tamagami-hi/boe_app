// Shared overlay behaviour tests (Task 18).
//
// These cover the parts every previous overlay implementation got wrong in a
// different way: the body-scroll lock (the admin drawer's was not ref-counted, so
// closing an inner overlay unlocked the page while an outer one was still open),
// focus trap and restore (the page-level overlays had neither), and the absence of
// a per-overlay Escape listener (three implementations each adding one meant a
// single press closed all of them).
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OverlayStackProvider } from './OverlayStackContext.jsx';
import { useOverlayBehavior, __resetBodyLockForTests } from './useOverlayBehavior.js';

function Panel({ open, onClose, dismissible = true, lockScroll = true, label = 'panel' }) {
  const { panelRef } = useOverlayBehavior({ open, onClose, dismissible, lockScroll });
  if (!open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label={label} tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

function Harness({ children }) {
  return <OverlayStackProvider>{children}</OverlayStackProvider>;
}

beforeEach(() => {
  __resetBodyLockForTests();
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('body scroll lock', () => {
  test('locks while open and restores on close', () => {
    const { rerender } = render(<Harness><Panel open={false} onClose={() => {}} /></Harness>);
    expect(document.body.style.overflow).toBe('');

    rerender(<Harness><Panel open onClose={() => {}} /></Harness>);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Harness><Panel open={false} onClose={() => {}} /></Harness>);
    expect(document.body.style.overflow).toBe('');
  });

  test('is ref-counted: closing an inner overlay keeps the page locked', () => {
    // The admin drawer wrote body.style.overflow directly, so this sequence
    // unlocked the page while the outer overlay was still up.
    const { rerender } = render(
      <Harness>
        <Panel open onClose={() => {}} label="outer" />
        <Panel open onClose={() => {}} label="inner" />
      </Harness>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Harness>
        <Panel open onClose={() => {}} label="outer" />
        <Panel open={false} onClose={() => {}} label="inner" />
      </Harness>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Harness>
        <Panel open={false} onClose={() => {}} label="outer" />
        <Panel open={false} onClose={() => {}} label="inner" />
      </Harness>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  test('preserves a pre-existing overflow value rather than clearing it', () => {
    document.body.style.overflow = 'clip';
    const { rerender } = render(<Harness><Panel open onClose={() => {}} /></Harness>);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Harness><Panel open={false} onClose={() => {}} /></Harness>);
    expect(document.body.style.overflow).toBe('clip');
  });

  test('can be opted out of', () => {
    render(<Harness><Panel open onClose={() => {}} lockScroll={false} /></Harness>);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('focus management', () => {
  test('moves focus into the overlay on open', () => {
    render(<Harness><Panel open onClose={() => {}} /></Harness>);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  test('restores focus to the opener on close', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <Harness>
          <button type="button" onClick={() => setOpen(true)}>open</button>
          <Panel open={open} onClose={() => setOpen(false)} />
        </Harness>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'open' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();

    // Closing returns the user to the control they came from — what makes an
    // overlay feel like part of the app rather than a page navigation.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  test('wraps Tab at the end of the overlay', () => {
    render(<Harness><Panel open onClose={() => {}} /></Harness>);
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  test('wraps Shift+Tab at the start', () => {
    render(<Harness><Panel open onClose={() => {}} /></Harness>);
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe('dismissal is centralised, not per-overlay', () => {
  test('Escape closes via the overlay stack', () => {
    const onClose = vi.fn();
    render(<Harness><Panel open onClose={onClose} /></Harness>);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape closes only the top overlay', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Harness>
        <Panel open onClose={outer} label="outer" />
        <Panel open onClose={inner} label="inner" />
      </Harness>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  test('a non-dismissible overlay absorbs Escape', () => {
    // The state a financial confirmation is in mid-submit.
    const onClose = vi.fn();
    render(<Harness><Panel open onClose={onClose} dismissible={false} /></Harness>);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
