# BE-009c: ES256 Access-Token Service (child of BE-009)

- Status: `DONE`
- Owner surface: `backend_controller/src/auth/**`, tests.
- Dependencies: BE-009a (`jose@6.2.3`).
- Objective: ES256 access-JWT sign/verify with versioned `kid` selection,
  consumed by the native/admin auth flows.
- Normative sources: `specifications/04` §4.1 (ES256 only; PKCS#8 signing + SPKI
  verification by `kid`; pinned iss/aud/typ/skew; claims; 10-min TTL); `05` §3.5.
- Production replacement closure: `src/auth/accessToken.ts`.
- Scope boundary / deferrals: refresh/CSRF rotation (BE-009d); env PEM/kid config
  parsing + route wiring (BE-010). Additive — no JS deletion here.
- Exact JS/JSX deletion target: none (legacy `security/tokens.js` deleted at
  BE-009d).
- Capability eval: sign then verify round-trips sub/sid/jti + kid; an unknown
  `kid`, a wrong audience, and a tampered/malformed token all reject with
  AUTHENTICATION_REQUIRED.
- Coverage/build gates: unit `npm run check` green (jose in dist smoke);
  `npm run test:integration` green.
- Required reviews: general + security (ES256-only; unknown-kid rejection;
  pinned claims; no key logged; single failure code).
- Rollback shape: revert the BE-009c commit.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-009c log](../logs/BE-009c-access-token.md)
