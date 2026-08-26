# Capacitor Debug Log Token Exposure

Status: deferred by owner on 2026-08-26.

## Finding

Running Android logcat with the `Capacitor:V` tag records Capacitor bridge method payloads and return values. Calls to the secure-storage plugin can therefore place native access tokens, refresh tokens, user records, and other stored session data in logcat.

This is a debug-observability issue. The production APK remains non-debuggable and PhonePe SDK logging remains disabled in production builds.

## Impact

Anyone with access to an unlocked development device, an authorized ADB connection, or collected verbose logcat output could recover active session credentials while the affected calls occur. Copying verbose logs into tickets, terminals, or automated collectors expands that exposure.

## Containment Performed

- The verbose Capacitor log stream was stopped immediately.
- The session values observed during discovery were revoked through the native logout endpoint.
- BeOnEdge application data and the existing logcat buffer were cleared.
- The payment diagnostic stream was restricted to PhonePe SDK, Android runtime, and activity-manager tags.
- No credential value is recorded in this document.

## Operational Restriction

Do not use the following tags while an authenticated BeOnEdge session is active:

```text
Capacitor:V
Capacitor/Console:V
```

Avoid collecting broad WebView, Chromium, network, or unrestricted logcat output during authenticated testing. Use an explicit tag allowlist and inspect output before sharing it.

## Deferred Remediation

- Add a dedicated diagnostic logging policy that never records plugin arguments, plugin results, authorization headers, cookies, payment tokens, or secure-storage values.
- Add redaction at the log collection boundary as defense in depth.
- Add a release check proving production APKs are non-debuggable and PhonePe SDK logging is disabled.
- Document session revocation and log-buffer clearing as required incident steps.
- Re-run authenticated Android diagnostics and verify that no bearer token, refresh token, payment token, callback credential, or personal record appears.

## Acceptance Criteria

- Authenticated application startup produces no session credentials in approved diagnostic output.
- PhonePe initiation and return can be diagnosed without logging request tokens or authorization material.
- Debug diagnostics remain opt-in and production builds fail closed with SDK logging disabled.
