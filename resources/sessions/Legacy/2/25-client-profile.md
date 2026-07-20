# Page plan — Client Profile Verification

> Profile was marked done before this session. This file is a verification plan so the client surface
> still has one page record per page.

## Page
- **Route:** `/app/profile`
- **Component:** `frontend_stack/packages/client/src/pages/Profile.jsx`
- **Styles:** `packages/client/src/styles/mobile/profile.css`, `.../desktop/profile.css`,
  shared `components.css`.
- **Intent:** account overview, profile actions, mandates/linked settings entry points.

## Checks
- Confirm the previous `.apk-list-row` fix remains in `desktop/components.css`; do not add it back
  to the `max-width:767px` collapse block.
- Mobile: profile rows keep label/action alignment and do not stack awkwardly.
- Desktop: row spacing and card widths remain consistent with KYC/Security pages.
- Links to KYC, Security, Support, Legal, Investor Charter, Grievance, and mandates work.

## Planned fixes
- None unless verification finds a regression.

## Acceptance Criteria
- Profile remains the reference for list-row behavior.
- No horizontal overflow on mobile.
- All profile routes remain reachable.
