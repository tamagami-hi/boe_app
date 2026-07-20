# Page plan — Client Splash Verification

> Splash was marked done before this session. This file is a verification plan so the client surface
> still has one page record per page.

## Page
- **Route:** `/app/splash`
- **Component:** `frontend_stack/packages/client/src/pages/Splash.jsx`
- **Styles:** `packages/client/src/styles/mobile/auth.css`, `.../desktop/auth.css`.
- **Intent:** branded launch/loading transition before login/dashboard routing.

## Checks
- Splash logo and loading bar render on mobile and desktop without cropping.
- The page waits for session loading before navigating.
- APK/client shell routes authenticated users to `/app/dashboard`.
- Browser route keeps existing web-start behavior.

## Planned fixes
- None unless timing/routing verification finds regression.

## Acceptance Criteria
- Splash displays briefly, then routes deterministically.
- No flash of wrong page for authenticated or unauthenticated users.
- Market-risk text remains visible.
