# Page plan — Client Login Verification

> Login was marked done before this session. This file is a verification plan so the client surface
> still has one page record per page.

## Page
- **Route:** `/app/login`
- **Component:** `frontend_stack/packages/client/src/pages/Login.jsx`
- **Styles:** `packages/client/src/styles/mobile/auth.css`, `.../desktop/auth.css`.
- **Intent:** sign in or start account creation, with APK/browser-specific routing behavior.

## Checks
- Mobile APK: login form fits without marketing copy crowding; keyboard does not hide the active
  input or submit button.
- Desktop browser: auth layout remains balanced and readable.
- Signup/open-onboarding behavior still matches the browser vs client-shell decision.
- Post-login redirect sends APK users to dashboard and browser users to the intended app route.

## Planned fixes
- None unless verification finds regression from routing or UI changes.

## Acceptance Criteria
- Valid login reaches the correct route.
- Invalid login shows an inline error.
- Create-account path opens the intended onboarding flow.
