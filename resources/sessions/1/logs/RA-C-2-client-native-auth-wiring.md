# RA-C.2 Client native-auth wiring

Status: DONE — branch `ts-migration/backend`. Second batch of RA-C.

Wires the client app's authentication to the canonical **native** auth surface
(spec 04 §3.3): bearer access token + rotating opaque refresh token, replacing
the legacy `/v1/auth/login|signup|refresh|logout|session` calls. With RA-C.1
(admin web auth), **login now works for both surfaces** against the real backend.

## Changes (frontend_stack/packages/client/src/services/authApi.js)

- **login** (client) -> `POST /v1/auth/native/login` `{ email, password, device }`,
  where `device = { installationId (persisted per-install UUID), name,
  platform: 'android', appVersion }`. Stores the returned bearer + refresh tokens
  and principal; `fromNativeUser` maps the canonical principal
  (`userId/fullName/phoneMasked`).
- **refresh** -> `POST /v1/auth/native/refresh` `{ refreshToken, rotationId }`
  (deterministic rotation protocol); retains the stored principal (native refresh
  returns tokens only).
- **currentUser** (client) -> there is no server session endpoint, so it trusts
  the stored principal while an access token is present and otherwise rotates the
  refresh token to re-establish the session.
- **logout** (client) -> `POST /v1/auth/native/logout` (bearer + `{ refreshToken }`).
- **signup** (client, http) -> now fails fast with a clear message: the canonical
  model has no self-service signup (apply on the website -> verify -> admin
  approval -> activation link). Fixture mode is unchanged.

## Validation

- `cd frontend_stack && npm run build` (Vite; client + admin) green.
- Backend unchanged; native endpoints already covered by
  `authNative.integration.test.ts`.
- Guards: whitespace clean; Legacy hash intact; backend authored JS still 0.

## Notes / boundaries

- `device.platform` is `'android'` (backend requires it); accurate for the APK,
  a documented compromise for the browser preview.
- Native login is email-only (backend contract); phone-identifier login is not
  supported by the canonical endpoint.
- E2E (client APK ↔ backend) runs in the user's stack; here it is build-verified
  + backed by the backend native-auth integration tests.
- **Auth layer for both surfaces is now complete.** Remaining RA-C data-layer
  work: the admin applications queue wiring, and the `/v1/client/*` financial
  routes on the backend (the large spec-governed build) + the client data screens.
