# Migration Metrics

## Current Snapshot After `9e884ad`

| Area | Production TS/TSX | Test TS/TSX | Tooling/operational TS | Remaining authored JS/JSX |
|---|---:|---:|---:|---:|
| Contracts | 857 lines / 9 files | 1,641 lines / 6 files | Config tracked separately | 0 |
| Backend migrated runtime | 209 lines / 4 files | 271 lines / 5 files | 88-line smoke script + 22-line Vitest config | 12,600 lines / 89 files |
| Landing | 3,345 lines / 55 files | 222 lines / 3 files | TS config plus 34-line `next.config.mjs` | 0 authored JS/JSX |
| Other frontend authored source | Not yet migrated in this program | One JS test is included in backlog | Existing package tooling | 20,480 lines / 188 files |

Backend remaining JS breakdown: 85 production/operational files and 4 test
files. The completed runtime packet deleted 164 production/operational JS lines
and 47 JS test lines (211 total) while adding 209 production TS, 88 operational
TS, 271 test TS, and 22 tooling-config TS lines.

Frontend authored JS/JSX backlog:

| Package | Files | Lines |
|---|---:|---:|
| Vite app source + `vite.config.js` | 6 | 257 |
| Admin source | 77 | 9,212 |
| Client source | 76 | 8,223 |
| Shared source | 23 | 1,522 |
| Design tokens | 1 | 2 |
| UI kits | 5 | 1,264 |
| **Total** | **188** | **20,480** |

Global literal JS/JSX backlog is 277 files / 33,080 lines: 272
production/config files / 32,433 lines and five tests / 647 lines. Four active
MJS tooling/config files add 96 lines, producing a JS-family total of 281 files
and 33,176 lines. See the inventory ledger for classification and exceptions.

## Reproduction Commands

Run from the repository root. Exclude dependency, build, generated Android, and
legacy-session trees from authored-source counts.

```bash
find backend_controller/src backend_controller/scripts -type f \
  \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 wc -l

find backend_controller/src backend_controller/scripts -type f \
  \( -name '*.js' -o -name '*.jsx' \) -print | wc -l

find backend_controller/src backend_controller/scripts -type f \
  -name '*.test.js' -print0 | xargs -0 wc -l

find packages/contracts/src -type f -name '*.ts' ! -name '*.test.ts' \
  -print0 | xargs -0 wc -l

find packages/contracts/src -type f -name '*.test.ts' \
  -print0 | xargs -0 wc -l

find frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' -o -path '*/android/app/src/main/assets' \) -prune \
  -o -type f \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 wc -l

find frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' -o -path '*/android/app/src/main/assets' \) -prune \
  -o -type f \( -name '*.js' -o -name '*.jsx' \) -print | wc -l

find frontend_stack/packages/landing_page \
  \( -path '*/node_modules' -o -path '*/.next' \) -prune \
  -o -type f -name '*.test.ts' -print0 | xargs -0 wc -l

find backend_controller packages/contracts frontend_stack \
  \( -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
     -o -path '*/.next' \) -prune -o -type f -name '*.mjs' -print0 \
  | xargs -0 wc -l

find frontend_stack/app/android/app/src/main/assets/public -type f -name '*.js' \
  -printf '%s\n' | awk '{ files += 1; bytes += $1 } END { print files, bytes }'
```

For the backend production/test split, subtract the `*.test.js` result from the
total or list both sets with `find`. For landing production TS/TSX, count its
`src` TS/TSX set and exclude `*.test.ts`; the inventory ledger records the exact
snapshot. Generated Android byte counts are diagnostic only and never enter the
authored-source total.

Each completed packet appends a new snapshot or delta. Do not overwrite a prior
checkpoint's figures without recording the correction and reason.
