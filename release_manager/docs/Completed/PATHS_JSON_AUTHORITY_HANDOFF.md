# paths.json Authority Migration — Agent Handoff

## Objective

Make each stack's tracked `paths.json` the sole authoritative source for every
deployment, backup, log, database, image, configuration, APK, and runtime-script
path. Operational scripts must not contain or derive raw `/srv/...` paths.

A future path change must require editing only the selected stack's
`paths.json`, followed by validation and shipping that contract to the VPS.

Stacks:

- `dev_release`
- `prod_release`
- `monitor_service`

## Important: current working-tree state

This handoff was written while other release-manager changes were in progress.
Do not commit or deploy blindly. Inspect the complete working diff first:

```bash
git status --short
git diff -- release_manager emu/boe_update.sh
git diff --cached -- release_manager emu/boe_update.sh
```

The current diff includes:

- hierarchical `status.sh` menus (`Git`, `Exports`, `Ship + Deploy`);
- explicit local-worktree synchronization and merge-collision protection;
- deploy/rollback exit-status propagation;
- a production `export.sh --skip-build` prohibition;
- a new `lib/apk_ship.sh` and `tests/apk_ship.test.sh`;
- APK publishing moved toward post-deploy ordering and standalone archival;
- documentation and verification updates.

The APK work is not ready for deployment yet. `lib/apk_ship.sh` was changed to
require an exact APK version, but every caller/export path has not yet been
fully reconciled. Review findings that remain open are listed below.

## Verified live VPS state (2026-08-03)

SSH alias: `beonedge`.

All five active APK holder directories exist and are owned by
`beonedge:beonedge`, mode `775`:

```text
/srv/dev_stack/BOE_APP/dev_release/dev_apk
/srv/dev_stack/BOE_APP/dev_release/dev_admin_apk
/srv/dev_stack/BOE_APP/prod_release/prod_apk
/srv/dev_stack/BOE_APP/prod_release/admin_apk
/srv/dev_stack/BOE_APP/monitor_service/ms_apk
```

Rollback APK roots exist, are empty, and are owned by `beonedge:beonedge`, mode
`755`:

```text
/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK
/srv/backup/BOE_APP/PROD_ROLLBACK/APK
```

Live path contracts:

```text
dev_release/paths.json       populated, valid schema 2
prod_release/paths.json      zero bytes
monitor_service/paths.json   zero bytes
```

Do not deploy prod or monitor until their validated contracts have been
installed atomically.

The seven suspended legacy `status.sh` processes were terminated. No old
control-center process remained at the time of this handoff.

## Current architecture mismatch

The repository currently implements the opposite ownership model:

- `lib/stacks.sh` hardcodes VPS and backup roots and stack path fragments.
- `lib/paths.sh` generates `paths.json` from `stacks.sh`.
- `export.sh` calls `paths_write`, overwriting the tracked JSON.
- `status.sh` exposes `Regenerate paths.json`.
- `verify.sh` treats a JSON differing from generated output as stale.

Therefore manual edits to `paths.json` are currently lost. This must be
inverted, not patched around.

## Target contract: schema 3

Bump all three contracts to schema `3`. The tracked JSON files become
hand-edited canonical configuration. Remove `generated_at` and the note saying
the files are generated.

Keep the existing top-level structure where useful, but add explicit fields so
no script infers a path from a directory name.

Required additions:

```json
{
  "schema": 3,
  "stack": "dev_release",
  "environment": "development",
  "short": "dev",
  "vps": {
    "root": "/srv/dev_stack/BOE_APP",
    "stack_dir": "/srv/dev_stack/BOE_APP/dev_release",
    "paths_file": "/srv/dev_stack/BOE_APP/dev_release/paths.json",
    "database_dir": "/srv/dev_stack/BOE_APP/dev_release/dev_psql_db",
    "config_dir": null
  },
  "apk": {
    "enabled": true,
    "destinations": [
      {
        "variant": "client",
        "current_dir": "/srv/dev_stack/BOE_APP/dev_release/dev_apk",
        "rollback_dir": "/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/client"
      },
      {
        "variant": "admin",
        "current_dir": "/srv/dev_stack/BOE_APP/dev_release/dev_admin_apk",
        "rollback_dir": "/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/admin"
      }
    ]
  }
}
```

Production must define exactly:

```text
client current  /srv/dev_stack/BOE_APP/prod_release/prod_apk
client rollback /srv/backup/BOE_APP/PROD_ROLLBACK/APK/client
admin current   /srv/dev_stack/BOE_APP/prod_release/admin_apk
admin rollback  /srv/backup/BOE_APP/PROD_ROLLBACK/APK/admin
```

Monitoring has no Android application today. Represent this honestly:

```json
{
  "apk": {
    "enabled": false,
    "reserved_current_dir": "/srv/dev_stack/BOE_APP/monitor_service/ms_apk",
    "destinations": []
  }
}
```

If monitoring later gets an APK, enable it and add an explicit variant mapping.
Never infer client/admin from whether a directory basename contains `admin`.

Also add/retain explicit paths for:

- compose, env, env example, manifest, checksums, version file;
- deploy, rollback, guide, and shared runtime scripts;
- image and monitoring configuration directories;
- database holder directory (or `null` for monitoring);
- registry and lock file;
- backup mount/root;
- rollback images/APKs/database;
- scheduled/emergency database backups;
- deploy/image/database/application logs.

## Contract validation requirements

Implement `paths_validate <stack> <file>` in `lib/paths.sh` and fail closed.

Validate:

1. Valid JSON, exact schema, stack ID, environment, and short name.
2. Every required field has the correct JSON type and is non-empty.
3. Every remote path is absolute, normalized, contains no `..`, control bytes,
   whitespace, quotes, or shell metacharacters.
4. Stack-owned paths are contained beneath that contract's `vps.stack_dir`.
5. Backup paths are contained beneath `backup.root`; `backup.root` is beneath
   or equal to the intended mounted tree represented by `backup.mount_check`.
6. Lock files are beneath `/run/lock`.
7. APK current and rollback destinations are unique and non-overlapping within
   and across stacks.
8. Dev and prod define exactly one `client` and one `admin` destination.
9. Monitoring has `apk.enabled == false` until an APK actually exists.
10. `has_database` agrees with `vps.database_dir`.
11. Filenames and absolute file paths agree where both are retained.
12. Common roots are consistent across the three contracts where intended.

Every JSON value must be validated before interpolation into SSH, rsync, or a
remote shell command.

## Implementation phases

### Phase 0 — stabilize the current diff

Before the authority inversion:

1. Run every release-manager test and record failures.
2. Finish or revert the partially changed APK helper signature.
3. Resolve these open review findings:
   - standalone production APK shipping needs the clean/tagged/origin release
     gate and sidecar Git provenance validation;
   - export must stage exactly the APK built for the current version, not every
     retained `emu/out` match;
   - bundle/standalone publishing must select explicit artifact names/version,
     never mtime;
   - reject local and remote APK/sidecar/destination symlinks;
   - full deploy must archive old APKs before publishing new ones;
   - `--ship-only` must not silently publish live/downloadable APKs;
   - worktree sync must revalidate the destination branch/HEAD/cleanliness after
     confirmation and use `git merge --no-overwrite-ignore`.
4. Get the suite green before beginning schema 3.

### Phase 1 — tests first

Create `release_manager/tests/paths_contract.test.sh` with fixtures that prove:

- all three real schema-3 contracts pass;
- empty, malformed, schema-2, missing-key, traversal, unsafe-character, wrong
  containment, duplicate APK, overlapping APK, and mismatched-stack contracts
  fail;
- changing fixture roots to `/srv/custom/...` makes stubbed SSH/rsync calls use
  only the changed JSON values;
- a static scan rejects operational `/srv/...` literals outside canonical JSON,
  tests, documentation, and explicitly retired fixtures.

Extend APK tests to cover all four routes and four rollback destinations.

### Phase 2 — invert local authority

Refactor `lib/paths.sh`:

- remove `paths_json` generation and `paths_write`;
- add `stack_paths_file`, `paths_validate`, `paths_get`, and typed array readers;
- never reconstruct one path from another in operational callers.

Refactor `lib/stacks.sh`:

- retain stack IDs, selector resolution, image naming rules if still needed,
  and SSH plumbing;
- remove `BOE_VPS_ROOT`, `BOE_BACKUP_ROOT`, `BOE_BACKUP_MOUNT`, path-returning
  `stack_attr` cases, and derived `stack_dir`;
- make non-path metadata read from the selected canonical contract where
  practical.

Refactor `export.sh`:

- validate the canonical stack JSON;
- copy it byte-for-byte into the bundle;
- never regenerate or overwrite it;
- include its SHA-256 in both `manifest.json` and `checksums.sha256`.

Change `status.sh` menu option from `Regenerate paths.json` to
`Validate path contracts`.

Change `verify.sh` from generation/freshness comparison to schema, containment,
cross-stack uniqueness, and raw-literal enforcement.

### Phase 3 — refactor every operational caller

Update these files to read every path from the selected JSON:

- `deploy.sh`
- `rollback.sh`
- `status.sh`
- `verify.sh`
- `lib/apk_ship.sh`
- `stacks/_shared/_boe_lib.sh`
- `stacks/_shared/_boe_deploy.sh`
- `stacks/_shared/_boe_rollback.sh`
- monitoring deploy/rollback wrappers

Specific current violations to remove:

- deploy/rollback use `stack_dir` plus `BOE_BACKUP_*` constants;
- status constructs `$root/$stack`, `$d/.env`, and disk labels directly;
- verify constructs remote env paths and uses global backup constants;
- monitor scripts use `$HERE/config` rather than a JSON `config_dir`;
- deprecated `lib/ship.sh` contains wrong raw `/srv/prod_stack` paths. Delete it
  or reduce it to documentation that contains no executable configuration.

Comments and operator docs may show examples, but executable path selection must
come from JSON.

### Phase 4 — APK lifecycle

For APK-only builds:

1. Build exact dev/prod client and admin artifacts.
2. Validate regular files (not symlinks), exact expected filenames, sidecar
   target/variant/version/Git provenance, and SHA-256.
3. Read the selected variant's current and rollback directories from
   `apk.destinations[]`.
4. Snapshot the previous current artifact into that variant's rollback
   directory before upload.
5. Upload APK + sidecar with rsync checksums.
6. Verify remote SHA-256.
7. Retain a bounded number of prior versions per the JSON retention contract.

For full deploy, the VPS-native deploy must archive the old four-channel state
before the local publisher changes active APK holders. Publish only after the
remote application deploy succeeds.

Production standalone publishing must meet the same clean exact-tag,
`origin/main`, remote-tag, and sidecar-provenance gate as production bundles.

### Phase 5 — atomic live bootstrap

Do not overwrite live contracts in place.

For each stack:

1. Validate locally.
2. Upload to a temporary sibling file, for example `paths.json.next`.
3. Run remote `jq empty` and the schema-3 validator against the temporary file.
4. Confirm its `stack` matches the destination stack.
5. Atomically rename it to `paths.json`.
6. Preserve `.env`, ownership, and all unmanaged files.
7. Compare local and remote SHA-256.

Bootstrap order:

1. prod (currently zero bytes)
2. monitor (currently zero bytes)
3. dev (replace schema 2 only after schema-3 runtime compatibility is proven)

Do not run a deployment merely to install path contracts.

### Phase 6 — verification and review

Run:

```bash
for test_script in release_manager/tests/*.test.sh; do
  bash "$test_script" || exit 1
done
./release_manager/verify.sh
./release_manager/verify.sh --remote
git diff --check -- release_manager emu/boe_update.sh
```

Then verify live:

```bash
ssh beonedge 'for f in \
  /srv/dev_stack/BOE_APP/dev_release/paths.json \
  /srv/dev_stack/BOE_APP/prod_release/paths.json \
  /srv/dev_stack/BOE_APP/monitor_service/paths.json; do \
    test -s "$f" && jq -e ".schema == 3" "$f" || exit 1; \
  done'
```

Perform code and security review before any commit or deploy.

## Completion criteria

- All three tracked and live contracts are non-empty, schema 3, validated, and
  checksum-identical local-to-remote.
- No active operational script contains a raw deployment/backup `/srv/...`
  literal or derives a path absent from JSON.
- Editing one stack's JSON fixture changes all stubbed local/remote operations
  without editing shell code.
- Dev/prod client/admin current and rollback routes are explicit and distinct.
- Old APKs are archived before new APKs are published.
- Production APK provenance cannot bypass the release gate.
- Full local and remote verification pass with no Critical, High, or blocking
  Medium review findings.
