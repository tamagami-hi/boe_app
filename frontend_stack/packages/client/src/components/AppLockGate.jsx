import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, LockKeyhole, LogOut } from 'lucide-react';
import { platformLifecycle } from '../platform/clientPlatform.js';
import PinPad from './PinPad.jsx';
import {
  authenticateBiometric,
  clearUnlock,
  getSecurityState,
  isUnlocked,
  markUnlocked,
  verifyPin,
} from '../services/securitySettings.js';

/**
 * AppLockGate — the device-level PIN/biometric lock.
 *
 * ── WHEN IT LOCKS ───────────────────────────────────────────────────────────
 * Exactly on launch and on return from background, and only when a PIN is set.
 * There is no inactivity timeout: staying signed in is the point, and a client
 * reading a statement for ten minutes should not be interrupted. The lock is
 * about *device* possession, so the moments that matter are the ones where the
 * device may have changed hands.
 *
 * The unlock flag lives in memory only (see securitySettings), so a cold start
 * cannot inherit an unlocked state — no timestamp to trust, nothing to go stale.
 *
 * ── BIOMETRICS FIRST ────────────────────────────────────────────────────────
 * When biometric unlock is enabled it is prompted automatically as soon as the
 * lock appears, and again on every resume. The PIN pad stays visible underneath
 * as the fallback, so a failed or cancelled scan needs no extra tap to recover.
 * It is never prompted more than once per lock without the user asking, because
 * a re-prompt loop on cancel is indistinguishable from the app refusing to let
 * you type your PIN.
 */

const PIN_MIN_LENGTH = 4;

/**
 * What the lock screen is currently offering.
 *
 *   biometric  the system fingerprint dialog is up (or about to be); the app
 *              shows only a plain cover behind it
 *   pin        the keypad, reached when biometrics are off, declined, or failed
 */
const PROMPT_BIOMETRIC = 'biometric';
const PROMPT_PIN = 'pin';

export default function AppLockGate({ user, logout, children }) {
  const [state, setState] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Starts on the biometric branch so the keypad is never painted for a frame
   * before the system dialog appears. When biometrics are not usable the render
   * falls through to the keypad regardless of this value.
   */
  const [prompt, setPrompt] = useState(PROMPT_BIOMETRIC);
  // Only the *automatic* prompt is once-per-lock; the keypad's biometric button
  // can be used as often as the user likes.
  const autoPromptedRef = useRef(false);
  /**
   * Suppresses lifecycle handling while our own biometric dialog is on screen.
   *
   * BiometricPrompt is a separate system window, so showing it fires
   * visibilitychange/appStateChange exactly as if the app had been backgrounded.
   * Without this guard, dismissing the dialog with "Use PIN" was immediately
   * followed by a synthetic "resume" that reset the screen back to the biometric
   * branch — the keypad the user just asked for never appeared. The timestamp
   * covers the resume event arriving a moment after the promise settles.
   */
  const suppressLifecycleUntilRef = useRef(0);
  const biometricInFlightRef = useRef(false);

  const lifecycleSuppressed = () =>
    biometricInFlightRef.current || Date.now() < suppressLifecycleUntilRef.current;

  // Read the persisted settings once per user. Until they arrive nothing is
  // rendered: showing the app first and the lock a moment later would flash
  // account balances on a device that was supposed to be locked.
  useEffect(() => {
    let cancelled = false;

    function load() {
      getSecurityState(user).then((next) => {
        if (cancelled) return;
        setState(next);
        setLocked(next.pinSet && !isUnlocked(user));
      });
    }

    load();
    window.addEventListener('boe:security-settings-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('boe:security-settings-changed', load);
    };
  }, [user]);

  // Lock on background, and re-lock on the way back in.
  useEffect(() => {
    if (!state?.pinSet) return undefined;

    function onPause() {
      if (lifecycleSuppressed()) return;
      clearUnlock(user);
      autoPromptedRef.current = false;
    }

    function onResume() {
      if (lifecycleSuppressed()) return;
      if (!isUnlocked(user)) {
        setPin('');
        setError('');
        // Back to the biometric branch, so returning from background prompts the
        // fingerprint again instead of resuming on a keypad the user left behind.
        setPrompt(PROMPT_BIOMETRIC);
        setLocked(true);
      }
    }

    const cleanupPause = platformLifecycle.onPause(onPause);
    const cleanupResume = platformLifecycle.onResume(onResume);
    return () => {
      cleanupPause();
      cleanupResume();
    };
  }, [state?.pinSet, user]);

  const canUseBiometric = Boolean(state?.biometricEnabled && state?.biometricAvailable);

  const unlockWithBiometric = useCallback(async () => {
    setBusy(true);
    setError('');
    biometricInFlightRef.current = true;
    try {
      const ok = await authenticateBiometric(user);
      if (ok) {
        setPin('');
        setLocked(false);
        return;
      }
      // Enabled in settings but unusable right now (biometrics removed from the
      // device, hardware unavailable): fall through to the keypad and say why.
      setPrompt(PROMPT_PIN);
      setError('Biometric unlock is unavailable. Enter your PIN.');
    } catch (biometricError) {
      // Declined ("Use PIN"), failed, or cancelled by the system: the keypad is
      // the only way forward, so reveal it. A cancel is a deliberate choice, not
      // an error, so it carries no message.
      setPrompt(PROMPT_PIN);
      setError(
        biometricError?.code === 'BIOMETRIC_CANCELLED'
          ? ''
          : biometricError?.message || 'Biometric unlock failed. Enter your PIN.',
      );
    } finally {
      biometricInFlightRef.current = false;
      // Keep ignoring lifecycle events briefly: the resume that accompanies the
      // dialog closing can land just after this promise settles.
      suppressLifecycleUntilRef.current = Date.now() + 1500;
      setBusy(false);
    }
  }, [user]);

  // Automatic biometric prompt: on first lock and after every resume.
  useEffect(() => {
    if (!locked || !canUseBiometric || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    unlockWithBiometric();
  }, [locked, canUseBiometric, unlockWithBiometric]);

  const submitPin = useCallback(
    async (candidate) => {
      const value = candidate ?? pin;
      if (value.length < PIN_MIN_LENGTH || busy) return;
      setBusy(true);
      setError('');
      try {
        const ok = await verifyPin(user, value);
        if (!ok) {
          setError('Incorrect PIN.');
          setPin('');
          return;
        }
        markUnlocked(user);
        setPin('');
        setLocked(false);
      } finally {
        setBusy(false);
      }
    },
    [busy, pin, user],
  );

  async function signOut() {
    clearUnlock(user);
    await logout();
  }

  // Settings not read yet: render nothing rather than risk a flash of content.
  if (state === null) return null;
  if (!locked) return children;

  /**
   * While the system fingerprint dialog is up, the app must show nothing but a
   * cover. Rendering the keypad underneath it put a second, redundant
   * authentication surface on screen behind a modal the user cannot dismiss
   * without answering — it read as the app asking for both at once.
   */
  const awaitingBiometric = canUseBiometric && prompt === PROMPT_BIOMETRIC;

  return (
    <>
      {children}
      <div className="security-lock-overlay" role="dialog" aria-modal="true" aria-label="App locked">
        {awaitingBiometric ? (
          <div className="security-lock-card security-lock-card--waiting">
            <div className="security-lock-icon"><Fingerprint size={26} strokeWidth={1.6} /></div>
            <div>
              <h2>Unlocking BeOnEdge</h2>
              <p>Confirm your fingerprint to continue.</p>
            </div>
            {/*
              The system dialog covers this, so it is only reachable if that
              dialog failed to appear. Without it a user in that state would be
              stuck behind a cover with no way to reach their PIN.
            */}
            <button
              className="be-btn be-btn-ghost be-btn-block"
              type="button"
              onClick={() => { setError(''); setPrompt(PROMPT_PIN); }}
            >
              Use PIN instead
            </button>
          </div>
        ) : (
          <div className="security-lock-card">
            <div className="security-lock-icon"><LockKeyhole size={24} strokeWidth={1.6} /></div>
            <div>
              <h2>Enter app PIN</h2>
              <p>Security lock is active on this device.</p>
            </div>

            <PinPad
              value={pin}
              onChange={setPin}
              onSubmit={submitPin}
              error={error}
              length={PIN_MIN_LENGTH}
              disabled={busy}
              // PINs are 4–6 digits, so submit at 4 and let longer PINs be
              // confirmed with the button. Checking a 4-digit prefix of a longer
              // PIN is harmless: it simply fails and clears.
              autoSubmitAt={PIN_MIN_LENGTH}
              {...(canUseBiometric
                ? { onBiometric: unlockWithBiometric, biometricLabel: 'Unlock with fingerprint' }
                : {})}
            />

            <button
              className="be-btn be-btn-primary be-btn-block be-btn-lg"
              type="button"
              onClick={() => submitPin()}
              disabled={pin.length < PIN_MIN_LENGTH || busy}
            >
              Unlock
            </button>
            <button className="be-btn be-btn-ghost be-btn-block" type="button" onClick={signOut} disabled={busy}>
              <LogOut size={16} strokeWidth={1.7} /> Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}
