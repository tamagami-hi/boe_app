# Page plan — Client KYC Detail

> Shared workflow, environment, and CSS-cascade warning are in `00-program-overview.md`.
> Implement this page only; do not make backend/data-wiring changes.

## Page
- **Route:** `/app/kyc`
- **Component:** `frontend_stack/packages/client/src/pages/KycDetail.jsx`
- **Styles:** `packages/client/src/styles/mobile/profile.css`, `.../desktop/profile.css`,
  auth field-row styles.
- **Intent:** manage FATCA, nominee allocation, and re-KYC state.
- **Evidence:** `/tmp/ui/desk_kyc.png`, `/tmp/ui/mob_kyc.png`.

## Issues found
- **No confirmed collapse-block issue.** `.apk-list-row` was already removed from the bad shared
  collapse block.
- **M1 — Verify nominee rows and form fields on mobile.** The page is form-heavy and needs screenshot
  confirmation for label/value wrapping.
- **F1 — Percentage validation exists but should remain visible and close to nominee controls.**

## Fixes
1. No planned CSS change unless mobile screenshot shows nominee/action overflow.
2. If nominee rows crowd, add a targeted `.apk-nominee-row` mobile rule in `mobile/profile.css`
   instead of changing `.apk-list-row` globally.
3. Keep existing form validation and avoid data/API changes.

## Acceptance Criteria
- Mobile: FATCA fields, nominee form, nominee list, and re-KYC details are readable with no overlap.
- Desktop: two-column field rows remain intact.
- Nominee total validation and delete actions continue to work.
