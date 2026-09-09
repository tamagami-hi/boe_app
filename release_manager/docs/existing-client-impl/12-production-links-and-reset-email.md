# Production links and password-reset delivery audit

Verified 2026-09-10. Existing explicit URL settings remain authoritative; no NODE_ENV-based link derivation was added.

## Environment controls

| Setting | Development | Production | Actual effect |
| --- | --- | --- | --- |
| WEB_ORIGIN_ALLOWLIST first entry | https://dev-app.beonedge.in | https://app.beonedge.in | Password reset and initial password invitation origin |
| APK_DOWNLOAD_BASE_URL | https://dev-app.beonedge.in/downloads | https://app.beonedge.in/downloads | Approval/reset download emails and in-app APK URLs; also selects matching release artifact identity |
| PUBLIC_API_BASE_URL | https://dev-app.beonedge.in/api | https://app.beonedge.in/api | Passed by Compose, but not consumed by the current backend link builders |
| CORS_ORIGIN | https://dev-app.beonedge.in | https://app.beonedge.in | Browser access; fallback when WEB_ORIGIN_ALLOWLIST is absent |

Production WEB_ORIGIN_ALLOWLIST should be `https://app.beonedge.in,https://admin.beonedge.in,https://localhost`. Keep the client origin first. Android needs `https://localhost`. NODE_ENV still configures runtime behavior and existing payment callback validation; use production for production, development for development.

The private stack .env is protected from conflicting inherited shell values by the deploy wrapper. SPA/API and APK build targets are selected during export/native build. Changing runtime .env cannot retarget an already compiled development APK into a production APK.

## VPS observations

- `/srv/dev_stack/BOE_APP/dev_release/.env` and running backend agree: development mode, dev-app first allowed origin, dev-app download base, release root `/srv/boe/apk`.
- Development reset page and client APK HEAD requests returned HTTP 200. The live client update feed reports version 0.14.0 and its dev-app download URL.
- `/srv/dev_stack/BOE_APP/prod_release/.env` exists but is zero bytes. Populate a private production configuration before deployment; the deploy validation rejects this empty file.
- No VPS environment, service, nginx or live user data was changed. No test email was sent to a live recipient.

## Implementation

After valid reset/invitation-token redemption commits, the backend resolves the latest client APK from the configured release feed and sends installation/login instructions to the account email read from the locked user record. The response carries confirmed, unconfirmed, or unavailable download-email status. The page shows a sent notice only after transport acceptance and offers a direct download when available. Email failure does not undo the password change or instruct the user to replay a consumed token. Waiting for SMTP acceptance is limited to five seconds; after that the page reports unconfirmed delivery, since SMTP may still complete later. This direct notification does not use the durable outbox retry pipeline.

Production nginx now permits public downloads of admin APK filenames, matching development. The narrow APK-only location and catch-all 404 remain; sidecar JSON and directory listings are not exposed. The release scripts stage nginx files and print installation instructions; install the changed app.beonedge.in config and run nginx validation/reload as part of release.

## Verification

- Backend typecheck, lint, build, 888 tests passed, including reset commit ordering, token replay rejection, SMTP failure, missing artifact and stalled-mail cases.
- Frontend typecheck, lint, 212 tests, client/admin builds passed.
- Contracts typecheck, lint, 95 tests, OpenAPI lint and generated-client boundary check passed; API artifacts regenerated.
- Release-manager verification: 109 passed, 0 failed, 1 automatic remote-check skip. Separate read-only VPS inspection performed as above.
- Temporary Chromium checks with mocked API responses: sent notice, unconfirmed fallback, missing APK notice, direct URL and no browser exceptions. No permanent UI test file added.
