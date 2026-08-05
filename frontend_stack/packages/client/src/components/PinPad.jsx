import React from 'react';
import { Delete, Fingerprint } from 'lucide-react';

/**
 * PinPad — in-app numeric keypad for entering an app PIN.
 *
 * ── WHY NOT AN <input> ──────────────────────────────────────────────────────
 * A focused numeric `<input>` summons the device keyboard, which resizes the
 * WebView viewport. That pushes the bottom navigation bar up over the content
 * and, on the lock screen, can cover the keypad itself. An in-app keypad keeps
 * the layout completely still, and it also means the PIN never passes through
 * the system IME — so it cannot be captured by a third-party keyboard, logged in
 * an autofill/clipboard history, or shoulder-surfed from a prediction bar.
 *
 * There is deliberately no hidden input either: the value lives in React state
 * in the parent, and this component only renders dots plus buttons.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

/**
 * Fixed-width dot row.
 *
 * `length` slots are always rendered so the row never reflows as digits are
 * typed — a display that grows would shift the keypad under the user's thumb.
 */
function PinDots({ value, length }) {
  return (
    <div className="apk-pinpad-dots" aria-hidden="true">
      {Array.from({ length }, (_, index) => (
        <span
          key={index}
          className={'apk-pinpad-dot' + (index < value.length ? ' is-filled' : '')}
        />
      ))}
    </div>
  );
}

export default function PinPad({
  value,
  onChange,
  onSubmit,
  label,
  hint,
  error,
  length = 4,
  maxLength = 6,
  disabled = false,
  autoSubmitAt = 0,
  onBiometric,
  biometricLabel = 'Use biometrics',
  footer,
}) {
  function press(digit) {
    if (disabled || value.length >= maxLength) return;
    const next = `${value}${digit}`;
    onChange(next);
    // Optional: submit as soon as a fixed-length PIN is complete, so unlocking
    // takes exactly as many taps as the PIN is long. Only used where the length
    // is known (the lock screen), never while choosing a new PIN.
    if (autoSubmitAt > 0 && next.length === autoSubmitAt && onSubmit) onSubmit(next);
  }

  function backspace() {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  }

  return (
    <div className="apk-pinpad">
      {label && <div className="apk-pinpad-label">{label}</div>}
      <PinDots value={value} length={Math.max(length, value.length)} />
      {/* aria-live so a screen reader announces progress without reading digits. */}
      <span className="be-sr-only" aria-live="polite">
        {value.length === 0 ? 'No digits entered' : `${value.length} digits entered`}
      </span>
      {error ? (
        <div className="apk-pinpad-error be-field-error" role="alert">{error}</div>
      ) : (
        hint && <div className="apk-pinpad-hint">{hint}</div>
      )}

      <div className="apk-pinpad-grid">
        {KEYS.map((key, index) => {
          if (key === '') {
            // The slot left of zero holds biometrics when available, and is an
            // inert spacer otherwise so the 0 key stays centred.
            return onBiometric ? (
              <button
                key="biometric"
                type="button"
                className="apk-pinpad-key apk-pinpad-key--action"
                onClick={onBiometric}
                disabled={disabled}
                aria-label={biometricLabel}
              >
                <Fingerprint size={22} strokeWidth={1.7} />
              </button>
            ) : (
              <span key="spacer" className="apk-pinpad-key apk-pinpad-key--empty" aria-hidden="true" />
            );
          }
          if (key === 'backspace') {
            return (
              <button
                key="backspace"
                type="button"
                className="apk-pinpad-key apk-pinpad-key--action"
                onClick={backspace}
                disabled={disabled || value.length === 0}
                aria-label="Delete last digit"
              >
                <Delete size={22} strokeWidth={1.7} />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className="apk-pinpad-key"
              onClick={() => press(key)}
              disabled={disabled || value.length >= maxLength}
              // The digit is the whole label; index keeps React keys stable.
              aria-label={`Digit ${key}`}
              data-index={index}
            >
              {key}
            </button>
          );
        })}
      </div>

      {footer}
    </div>
  );
}
