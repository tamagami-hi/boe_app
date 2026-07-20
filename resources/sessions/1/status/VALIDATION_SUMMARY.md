# Validation Summary

## Latest Code Checkpoint: `9e884ad`

Approved runtime: Node 22.20.0 and npm 11.16.0.

| Gate | Result |
|---|---|
| Backend strict typecheck and typed lint | Pass |
| Backend Vitest | 18/18 pass |
| Backend coverage | 95.17% statements/lines, 88.88% branches, 100% functions |
| Backend production build | Pass |
| Real source CLI liveness smoke | Pass |
| Real emitted CLI liveness smoke | Pass |
| Backend dependency audit | Zero vulnerabilities |
| Digest-pinned Docker build | Pass |
| Non-root container health and exact `/health/live` | Pass, `{ "status": "ok" }` |
| Contract package regression | 113/113 pass, 100% all coverage metrics |
| Code/TypeScript re-review | Approved; no CRITICAL/HIGH/MEDIUM |
| Security re-review | Approved; no CRITICAL/HIGH/MEDIUM |
| `git diff --check` | Pass |

The runtime image is buildable but remains non-release until canonical routes,
readiness, repositories, consumers, CI, and release gates are complete.

## Documentation Checkpoint Requirements

`DOC-001` must pass:

- all Markdown relative links resolve;
- no stale root-level references to moved Session 1 documents remain;
- `resources/sessions/Legacy` content hash is unchanged;
- task IDs and status references are consistent;
- code inventory counts reproduce `status/METRICS.md`;
- `git diff --check` passes; and
- independent documentation review finds no broken resume path or ambiguous
  source-replacement intention.

Legacy-tree guard baseline for this reorganization:
`d5fd7425d67bce6f52da178dbce9f5c27d0f36921d838115ccc9631755e93fee`.
It is the SHA-256 of the sorted per-file SHA-256 list under
`resources/sessions/Legacy`. Recompute it before the documentation commit; it
must match exactly.
