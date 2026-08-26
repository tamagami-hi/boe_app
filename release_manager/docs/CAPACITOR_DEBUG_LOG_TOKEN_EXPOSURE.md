# Capacitor Debug Log Token Exposure

Status: code and APK remediation completed on 2026-08-26; authenticated on-device confirmation remains pending.

## Finding

Running Android logcat with the `Capacitor:V` tag records Capacitor bridge method payloads and return values. Calls to the secure-storage plugin can therefore place native access tokens, refresh tokens, user records, and other stored session data in logcat.

This was a debug-observability issue. The production APK remains non-debuggable and PhonePe SDK logging remains disabled in production builds.

## Impact

Anyone with access to an unlocked development device, an authorized ADB connection, or collected verbose logcat output could recover active session credentials while the affected calls occur. Copying verbose logs into tickets, terminals, or automated collectors expands that exposure.

## Containment Performed

- The verbose Capacitor log stream was stopped immediately.
- The session values observed during discovery were revoked through the native logout endpoint.
- BeOnEdge application data and the existing logcat buffer were cleared.
- The payment diagnostic stream was restricted to PhonePe SDK, Android runtime, and activity-manager tags.
- No credential value is recorded in this document.

## Remediation Implemented

- Capacitor bridge logging is disabled for every build: `loggingBehavior: 'none'` in `frontend_stack/app/capacitor.config.ts`. Bridge call arguments and return values — including secure-storage tokens, biometric credentials, and PhonePe `startTransaction` request payloads — no longer reach logcat at any verbosity. The app ships no logger of its own, so no application-side log statement can record plugin arguments, plugin results, authorization headers, cookies, payment tokens, or secure-storage values.
- `emu/boe_logcat.sh` is the only sanctioned logcat collection path. It requires an explicit tag allowlist, forces every unspecified tag silent, hard-refuses the Capacitor bridge tags, WebView/chromium tags, wildcard filters, and symlink destinations, and redacts authorization, cookie, session, payment-token, and secret fields before anything is written to a mode-600 capture. A capture in which redaction fired exits non-zero and must be treated as an incident.
- `emu/boe_update.sh` measures the final APK with `aapt dump badging`, aborts if inspection fails, and refuses to produce a release artifact whose manifest is debuggable. The sidecar records the measured `debuggable` flag and the Android `buildType`; `release_manager/lib/apk_ship.sh` rejects any production APK without explicit `buildType == "release"` and `debuggable == false`, so the debug-build fallback can never reach prod.
- PhonePe SDK logging stays disabled outside debug builds (`enableLogging: androidBuildType === 'debug'` in `frontend_stack/app/src/platform/phonePeMobileCheckout.js`, fed by `VITE_BEO_ANDROID_BUILD_TYPE`).
- `release_manager/tests/apk_logging_policy.test.sh` covers all of the above and runs as part of `release_manager/verify.sh`.

## Operational Restriction

The Capacitor bridge tags remain forbidden while an authenticated BeOnEdge session is active, and are now refused by the collection wrapper outright:

```text
Capacitor:V
Capacitor/Console:V
```

Avoid collecting broad WebView, Chromium, network, or unrestricted logcat output during authenticated testing. Collect diagnostics only through `./emu/boe_logcat.sh` with an explicit tag allowlist, and inspect output before sharing it. For WebView internals use `chrome://inspect` remote devtools instead of logcat.

## Incident Steps

If credential-shaped content is ever observed in diagnostic output (including a redaction-triggered `boe_logcat.sh` capture):

1. Stop the capture immediately.
2. Revoke the session through the native logout endpoint.
3. Clear the device log buffer (`adb logcat -c`, or `./emu/boe_logcat.sh --clear ...`).
4. Clear the BeOnEdge application data on the device.
5. Quarantine the capture file; do not paste it into tickets, terminals, or collectors.
6. Record the incident without any credential values.

## Acceptance Criteria

- Authenticated application startup produces no session credentials in approved diagnostic output. Verified structurally: bridge logging is `none` for all builds, and `apk_logging_policy.test.sh` proves the collection wrapper defaults unspecified tags to silent, refuses sensitive tags and unsafe destinations, and redacts credential-shaped content. On-device confirmation remains required at the next authenticated diagnostics session through `emu/boe_logcat.sh`.
- PhonePe initiation and return can be diagnosed without logging request tokens or authorization material: SDK logging is debug-only, and the wrapper's allowlist plus redaction covers the collection boundary.
- Debug diagnostics remain opt-in and production builds fail closed: the production ship gate requires a sidecar proving `signing == "release"`, `buildType == "release"`, and `debuggable == false`, and `emu/boe_update.sh` refuses to build a debuggable release APK or accept a failed manifest inspection. A fresh signed dev client APK was built and independently confirmed to embed `loggingBehavior == "none"` with a non-debuggable manifest.
