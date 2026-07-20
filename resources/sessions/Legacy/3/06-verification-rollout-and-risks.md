# Verification, Rollout, And Risks

## Build Verification

Run from:

```bash
cd /home/nethunter07/PROJECTS/boe_app/frontend_stack
```

Browser build:

```bash
npm run build
```

Android build:

```bash
npm run build:android
```

Capacitor sync:

```bash
npm run android:sync
```

Emulator reinstall/update:

```bash
bash emu/boe_update.sh
```

## Manual Android Test Matrix

### Startup

- App launches on emulator.
- Backend calls work through emulator networking.
- `adb reverse` mapping exists for backend port.
- Login/create flows work.

### PIN

- Set 4 digit PIN.
- Set 6 digit PIN.
- Reject non-numeric PIN.
- Reject PIN shorter than 4 digits.
- Reject mismatched confirmation.
- Change PIN with correct current PIN.
- Reject change with wrong current PIN.
- Remove PIN with correct current PIN.
- Confirm removing PIN disables biometric.

### Lock Gate

- App remains unlocked immediately after PIN setup.
- App locks after configured inactivity timeout.
- App locks when sent to background.
- App asks for unlock on resume.
- Wrong PIN does not unlock.
- Correct PIN unlocks.
- Sign out works from locked screen.

### Native Biometric

- Biometric row disabled until PIN exists.
- Biometric row disabled if device has no enrolled biometric.
- Enabling biometric shows native prompt.
- Cancelling prompt leaves biometric disabled.
- Successful prompt enables biometric.
- Lock screen shows biometric button only when enabled and available.
- Successful biometric unlock opens app.
- Cancelled biometric prompt keeps app locked.
- PIN fallback works after biometric cancellation.
- Removing PIN disables biometric.

### Secure Storage

- Security settings survive app restart.
- Unlock session does not survive full app restart unless explicitly intended.
- Clearing app data removes PIN/biometric settings.
- Uninstall/reinstall removes local security settings.

## Manual Desktop Test Matrix

### Browser PIN

- Set/change/remove PIN works.
- Auto-lock works.
- Visibility lock works when tab loses focus or browser hides page.
- App lock overlay does not break desktop layout.

### WebAuthn

- If platform authenticator is available, biometric/WebAuthn enrollment works.
- If unavailable, UI shows disabled state.
- If prompt is cancelled, UI shows safe error and keeps PIN fallback.

### Desktop Build Isolation

- `npm run build` must not require Android SDK.
- Desktop build must not import native biometric plugin code.
- Desktop build must not fail when Capacitor native runtime is unavailable.

## Automated Test Opportunities

Short-term tests:

- Unit test PIN validation.
- Unit test settings migration from current storage format.
- Unit test error normalization.
- Unit test platform alias default behavior where practical.

Medium-term tests:

- Playwright test for browser Security page:
  - PIN setup.
  - PIN change.
  - PIN remove.
  - lock overlay.
- Mock platform adapter tests:
  - biometric available.
  - biometric unavailable.
  - biometric cancel.
  - secure storage unavailable.

Native plugin behavior is harder to automate reliably in CI, so emulator/manual verification remains required.

## Rollout Strategy

Use a staged rollout:

1. Land platform packages with web implementation and native stubs.
2. Switch shared client to platform contract.
3. Confirm desktop behavior is unchanged.
4. Add native secure storage.
5. Add native biometric plugin.
6. Enable native biometric behind a feature flag.
7. Remove feature flag only after emulator and physical device testing.

Recommended flag:

```bash
VITE_BEO_NATIVE_SECURITY=1
```

When disabled:

- Native build still runs.
- PIN remains available.
- Biometric shows unavailable or hidden.

## Rollback Strategy

If native biometric creates build/runtime issues:

- Keep platform packages.
- Point Android alias temporarily to web package or native safe-stub package.
- Disable `VITE_BEO_NATIVE_SECURITY`.
- Keep PIN fallback enabled.
- Re-run `npm run build:android`.
- Re-run `bash emu/boe_update.sh`.

If secure storage plugin creates issues:

- Keep native biometric disabled.
- Keep browser-compatible PIN behavior for development only if explicitly acceptable.
- Do not claim hardware-backed local security until secure storage is working.

## Key Risks

### Plugin Compatibility

Capacitor plugin APIs and package health can change. The selected biometric and secure storage plugins must be checked before implementation.

### WebView Runtime Differences

Android WebView may behave differently from Chrome desktop:

- Storage lifecycle can differ.
- WebAuthn may not behave like desktop browser.
- Visibility events may not map cleanly to native pause/resume.

Native adapter should prefer Capacitor events where available.

### False Security Claims

Browser local storage is not hardware-backed secure storage.

The UI and docs should not imply desktop browser PIN storage is equivalent to Android secure storage.

### Backend Session Confusion

Local biometric unlock does not refresh backend auth.

If backend session expires, the user must still log in.

### Emulator Limitations

Some emulator images may not support reliable biometric simulation. A physical Android device should be used before considering native biometric complete.

## Implementation Acceptance Criteria

The work is complete when:

- Shared client imports platform capability from `@beonedge/client-platform`.
- Browser build uses `client-platform-web`.
- Android build uses `client-platform-native`.
- Desktop Security & PIN behavior still works.
- Android PIN behavior works.
- Android native biometric availability is correctly detected.
- Android native biometric unlock works on a supported device/emulator.
- PIN fallback always works.
- Builds pass:
  - `npm run build`
  - `npm run build:android`
- Emulator update script still works.

