// Overlay stack tests (Task 16).
//
// LIFO ordering and the non-dismissible case are covered against the real Back
// button in NativeBackCoordinator.test.jsx. This file covers the parts that are
// independent of Back: keyboard Escape, and behaving sanely with no provider.
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  OverlayStackProvider,
  useOverlayRegistration,
  useOverlayStack,
} from './OverlayStackContext.jsx';

function Overlay({ open, onDismiss, dismissible }) {
  useOverlayRegistration(open, { onDismiss, dismissible });
  return null;
}

function DepthProbe() {
  const { depth, hasOverlay } = useOverlayStack();
  return <div data-testid="depth" data-has-overlay={String(hasOverlay)}>{depth}</div>;
}

const pressEscape = () => fireEvent.keyDown(window, { key: 'Escape' });

describe('registration lifecycle', () => {
  test('depth tracks open overlays', () => {
    const { rerender } = render(
      <OverlayStackProvider>
        <DepthProbe />
        <Overlay open={false} onDismiss={() => {}} />
      </OverlayStackProvider>,
    );
    expect(screen.getByTestId('depth')).toHaveTextContent('0');
    expect(screen.getByTestId('depth')).toHaveAttribute('data-has-overlay', 'false');

    rerender(
      <OverlayStackProvider>
        <DepthProbe />
        <Overlay open onDismiss={() => {}} />
      </OverlayStackProvider>,
    );
    expect(screen.getByTestId('depth')).toHaveTextContent('1');
    expect(screen.getByTestId('depth')).toHaveAttribute('data-has-overlay', 'true');
  });

  test('unmounting an open overlay deregisters it', () => {
    const { rerender } = render(
      <OverlayStackProvider>
        <DepthProbe />
        <Overlay open onDismiss={() => {}} />
      </OverlayStackProvider>,
    );
    expect(screen.getByTestId('depth')).toHaveTextContent('1');

    rerender(
      <OverlayStackProvider>
        <DepthProbe />
      </OverlayStackProvider>,
    );
    expect(screen.getByTestId('depth')).toHaveTextContent('0');
  });
});

describe('Escape handling', () => {
  test('dismisses only the top overlay', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <OverlayStackProvider>
        <Overlay open onDismiss={first} />
        <Overlay open onDismiss={second} />
      </OverlayStackProvider>,
    );

    pressEscape();

    // One listener for the whole app, acting on the top entry. Per-overlay
    // listeners closed everything at once.
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test('is inert when no overlay is open', () => {
    const dismiss = vi.fn();
    render(
      <OverlayStackProvider>
        <Overlay open={false} onDismiss={dismiss} />
      </OverlayStackProvider>,
    );

    pressEscape();

    expect(dismiss).not.toHaveBeenCalled();
  });

  test('a non-dismissible overlay ignores Escape', () => {
    const dismiss = vi.fn();
    render(
      <OverlayStackProvider>
        <Overlay open onDismiss={dismiss} dismissible={false} />
      </OverlayStackProvider>,
    );

    pressEscape();

    expect(dismiss).not.toHaveBeenCalled();
  });

  test('other keys are ignored', () => {
    const dismiss = vi.fn();
    render(
      <OverlayStackProvider>
        <Overlay open onDismiss={dismiss} />
      </OverlayStackProvider>,
    );

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('without a provider', () => {
  test('an overlay still renders instead of throwing', () => {
    // Overlays appear in tests and in browser builds where the native root may be
    // absent. Back coordination being unavailable must not make a sheet unopenable.
    expect(() => render(<Overlay open onDismiss={() => {}} />)).not.toThrow();
  });

  test('the null-object reports an empty stack', () => {
    render(<DepthProbe />);
    expect(screen.getByTestId('depth')).toHaveTextContent('0');
    expect(screen.getByTestId('depth')).toHaveAttribute('data-has-overlay', 'false');
  });
});
