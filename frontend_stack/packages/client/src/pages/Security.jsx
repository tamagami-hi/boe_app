import React, { useEffect, useState } from 'react';
import AppBar from '../layout/AppBar.jsx';
import { Fingerprint, KeyRound, LockKeyhole, LogOut, MonitorSmartphone, ShieldCheck, Trash2 } from 'lucide-react';
import { useSession } from '../store/SessionContext.jsx';
import { platformSecurity } from '../platform/clientPlatform.js';
import PinPad from '../components/PinPad.jsx';
import {
  authenticateBiometric,
  clearPin,
  currentSession,
  disableBiometric,
  enableBiometric,
  getSecurityState,
  setPin,
  validatePin,
  verifyPin,
} from '../services/securitySettings.js';

function resolveBiometricLabel(availability, pinSet) {
  if (!pinSet) return 'Set an app PIN first';
  if (!availability?.available) {
    // Tell the user which of the several "unavailable" cases they are in — the
    // fix is different for each, and a bare "not available" invites a support
    // ticket.
    if (availability?.reason === 'not-enrolled' || availability?.reason === 'biometric-not-enrolled') {
      return 'Add a fingerprint or face unlock in device settings first';
    }
    if (availability?.reason === 'device-not-secure') {
      return 'Set a device screen lock first';
    }
    if (availability?.reason === 'locked-out') {
      return 'Too many attempts — unlock your device, then retry';
    }
    if (availability?.reason === 'not-supported') return 'This device has no biometric sensor';
    return 'Not available on this device';
  }
  return availability.label || 'Use fingerprint or face unlock on this device';
}

/** Which PIN field a keypad press should land in. */
const STEP_LABEL = {
  current: 'Enter current PIN',
  next: 'Enter new PIN',
  confirm: 'Re-enter new PIN',
};

export default function Security() {
  const { user, logout } = useSession();
  const [state, setState] = useState(null);
  const [session, setSession] = useState(null);
  const [bioAvail, setBioAvail] = useState(null);
  const [pinMode, setPinMode] = useState(null);
  const [step, setStep] = useState('next');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSecurityState(user), platformSecurity.biometric.availability()]).then(([next, avail]) => {
      if (cancelled) return;
      setState(next);
      setBioAvail(avail);
      setSession(currentSession(user));
    });
    return () => { cancelled = true; };
  }, [user]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  }

  async function refreshState() {
    const [next, avail] = await Promise.all([getSecurityState(user), platformSecurity.biometric.availability()]);
    setState(next);
    setBioAvail(avail);
    setSession(currentSession(user));
  }

  function openPin(mode) {
    setPinMode(mode);
    // A PIN already exists for change/remove, so the first thing to collect is
    // the current one; a first-time setup starts on the new PIN.
    setStep(mode === 'set' && !state?.pinSet ? 'next' : 'current');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError('');
  }

  const stepValue = step === 'current' ? currentPin : step === 'next' ? newPin : confirmPin;
  const setStepValue = step === 'current' ? setCurrentPin : step === 'next' ? setNewPin : setConfirmPin;

  /**
   * Advance through the keypad steps. Each step is confirmed explicitly rather
   * than auto-advancing at 4 digits, because PINs here may be 4 to 6 digits and
   * jumping forward would make a 6-digit PIN impossible to type.
   */
  function nextStep() {
    setError('');
    if (step === 'current') {
      if (!validatePin(currentPin)) {
        setError('Enter your current 4 to 6 digit PIN.');
        return;
      }
      if (pinMode === 'remove') {
        savePin();
        return;
      }
      setStep('next');
      return;
    }
    if (step === 'next') {
      if (!validatePin(newPin)) {
        setError('Use a 4 to 6 digit PIN.');
        return;
      }
      setStep('confirm');
      return;
    }
    savePin();
  }

  async function savePin() {
    setBusy(true);
    setError('');
    try {
      if (pinMode === 'remove') {
        await clearPin(user, currentPin);
        setPinMode(null);
        await refreshState();
        showToast('App PIN removed.');
        return;
      }
      if (state?.pinSet) {
        const ok = await verifyPin(user, currentPin);
        if (!ok) {
          setError('Current PIN is incorrect.');
          setCurrentPin('');
          setStep('current');
          return;
        }
      }
      if (!validatePin(newPin)) {
        setError('Use a 4 to 6 digit PIN.');
        setStep('next');
        return;
      }
      if (newPin !== confirmPin) {
        setError('PIN confirmation does not match.');
        setConfirmPin('');
        setStep('confirm');
        return;
      }
      await setPin(user, newPin);
      setPinMode(null);
      await refreshState();
      showToast(state?.pinSet ? 'App PIN changed.' : 'App PIN set.');
    } catch (err) {
      setError(err?.message || 'Could not update PIN.');
      setCurrentPin('');
      setStep(pinMode === 'remove' || state?.pinSet ? 'current' : 'next');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBiometric() {
    if (!state?.pinSet) {
      setError('Set an app PIN before enabling biometric unlock.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (state.biometricEnabled) {
        await disableBiometric(user);
        showToast('Biometric unlock disabled.');
      } else {
        await enableBiometric(user);
        showToast('Biometric unlock enabled.');
      }
      await refreshState();
    } catch (err) {
      setError(err?.message || 'Could not update biometric unlock.');
    } finally {
      setBusy(false);
    }
  }

  async function testBiometric() {
    setBusy(true);
    setError('');
    try {
      await authenticateBiometric(user);
      showToast('Device unlock confirmed.');
    } catch {
      setError('Device unlock was cancelled or unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
  }

  return (
    <>
      <AppBar title="Security & PIN" />
      <div className="apk-screen security-screen">
        <section className="be-card security-status-card">
          <div className="security-status-icon"><LockKeyhole size={22} strokeWidth={1.6} /></div>
          <div>
            <div className="be-eyebrow">Device security</div>
            <h1 className="apk-h-sm">Security & PIN</h1>
            <p>{state?.pinSet ? 'App lock is active. The PIN is required on every launch and whenever the app returns from the background.' : 'Set an app PIN to protect this device.'}</p>
          </div>
        </section>

        <section className="be-card security-section">
          <button type="button" className="security-row" onClick={() => openPin(state?.pinSet ? 'change' : 'set')}>
            <KeyRound size={18} strokeWidth={1.6} />
            <span>
              <strong>App PIN</strong>
              <small>{state?.pinSet ? 'PIN is set on this device' : 'Not set'}</small>
            </span>
            <span className="security-row-action">{state?.pinSet ? 'Change' : 'Set'}</span>
          </button>

          {state?.pinSet && (
            <button type="button" className="security-row security-row-danger" onClick={() => openPin('remove')}>
              <Trash2 size={18} strokeWidth={1.6} />
              <span>
                <strong>Remove PIN</strong>
                <small>Turns off local app lock and biometric unlock</small>
              </span>
              <span className="security-row-action">Remove</span>
            </button>
          )}

          <div className="security-row">
            <Fingerprint size={18} strokeWidth={1.6} />
            <span>
              <strong>Biometric unlock</strong>
              <small>{resolveBiometricLabel(bioAvail, state?.pinSet)}</small>
            </span>
            <button
              type="button"
              className={'apk-toggle' + (state?.biometricEnabled ? ' is-on' : '')}
              onClick={toggleBiometric}
              role="switch"
              aria-checked={Boolean(state?.biometricEnabled)}
              disabled={busy || !state?.pinSet || !state?.biometricAvailable}
              aria-label="Toggle biometric unlock"
            />
          </div>

          {state?.biometricEnabled && (
            <button className="be-btn be-btn-secondary be-btn-block" type="button" onClick={testBiometric} disabled={busy}>
              <Fingerprint size={16} strokeWidth={1.7} /> Test device unlock
            </button>
          )}
        </section>

        <section className="be-card security-section">
          <div className="security-section-head">
            <ShieldCheck size={18} strokeWidth={1.6} />
            <div>
              <strong>When the app locks</strong>
              <small>
                {state?.pinSet
                  ? 'Every time you open the app and every time it returns from the background. You stay signed in — only the PIN is asked for.'
                  : 'Set an app PIN to lock the app on launch and when it returns from the background.'}
              </small>
            </div>
          </div>
          {state?.pinSet && state?.biometricEnabled && (
            <div className="be-disclosure">
              Biometric unlock is prompted first each time the app locks; your PIN always works as a fallback.
            </div>
          )}
        </section>

        <section className="be-card security-section">
          <div className="security-section-head">
            <MonitorSmartphone size={18} strokeWidth={1.6} />
            <div>
              <strong>Active session</strong>
              <small>{session?.label || 'This device'} · {session?.user || 'Client session'}</small>
            </div>
          </div>
          <button className="be-btn be-btn-secondary be-btn-block" type="button" onClick={signOut}>
            <LogOut size={16} strokeWidth={1.7} /> Sign out this device
          </button>
        </section>

        {error && <div className="apk-banner apk-banner-red">{error}</div>}
        <div className="be-disclosure">App PIN settings are stored locally on this device. Biometric unlock uses your device's secure authenticator when available; we never receive your fingerprint or face data.</div>
      </div>

      {pinMode && (
        <div className="apk-sheet-overlay" role="dialog" aria-modal="true" aria-label="App PIN setup" onClick={() => !busy && setPinMode(null)}>
          <div className="apk-sheet security-pin-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="apk-sheet-handle" />
            <h2 className="apk-h-sm">{pinMode === 'remove' ? 'Remove app PIN' : state?.pinSet ? 'Change app PIN' : 'Set app PIN'}</h2>
            <p className="security-sheet-copy">
              {pinMode === 'remove' ? 'Enter your current PIN to turn off local app lock.' : 'Use 4 to 6 digits. Avoid birthdays or repeated numbers.'}
            </p>

            {/* In-app keypad: a focused numeric input would raise the device
                keyboard, which resizes the WebView and pushes the bottom
                navigation bar up over this sheet. */}
            <PinPad
              value={stepValue}
              onChange={setStepValue}
              onSubmit={nextStep}
              label={STEP_LABEL[step]}
              hint={step === 'confirm' ? 'Repeat the new PIN to confirm.' : '4 to 6 digits'}
              error={error}
              length={4}
              disabled={busy}
            />

            <button
              className="be-btn be-btn-primary be-btn-block be-btn-lg"
              type="button"
              onClick={nextStep}
              disabled={busy || !validatePin(stepValue)}
            >
              {step === 'confirm' || pinMode === 'remove' ? (pinMode === 'remove' ? 'Remove PIN' : 'Save PIN') : 'Continue'}
            </button>
            <button className="be-btn be-btn-ghost be-btn-block" type="button" onClick={() => setPinMode(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && <div className="apk-toast" role="status">{toast}</div>}
    </>
  );
}
