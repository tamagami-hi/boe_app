# APK Export and Ship — Agent Handoff

## Objective

Complete the APK-only and bundle-integrated workflows for all four Android
artifacts:

| Stack | Variant | VPS current directory |
|---|---|---|
| `dev_release` | client | `/srv/dev_stack/BOE_APP/dev_release/dev_apk` |
| `dev_release` | admin | `/srv/dev_stack/BOE_APP/dev_release/dev_admin_apk` |
| `prod_release` | client | `/srv/dev_stack/BOE_APP/prod_release/prod_apk` |
| `prod_release` | admin | `/srv/dev_stack/BOE_APP/prod_release/admin_apk` |

Every destination and rollback path must ultimately be read from the selected
stack's `paths.json`. Coordinate this work with
`PATHS_JSON_AUTHORITY_HANDOFF.md`; do not introduce new `/srv/...` literals in
operational scripts.

This handoff was created on 2026-08-03. No APK was built, uploaded, published,
or deployed as part of creating it.

## Current working-tree warning

APK work is partially implemented and is not deployment-ready. Before editing:

```bash
git status --short
git diff -- release_manager emu/boe_update.sh
git diff --cached -- release_manager emu/boe_update.sh
```

Relevant untracked/modified files include:

- `release_manager/lib/apk_ship.sh` (untracked)
- `release_manager/tests/apk_ship.test.sh` (untracked)
- `release_manager/export.sh`
- `release_manager/deploy.sh`
- `release_manager/status.sh`
- `release_manager/verify.sh`
- release-manager documentation and adjacent tests

Preserve unrelated user changes. Inspect staged and unstaged diffs separately.

## Intended user-facing flows

### APK-only flow

From `status.sh`:

```text
Exports
└── Build + ship APKs
    ├── development APKs (client + admin)
    └── production APKs (client + admin)
```

The flow must:

1. Select dev or prod explicitly.
2. Apply the appropriate Git/release gate before a production build.
3. Build exactly client and admin for the selected target.
4. identify the exact artifacts produced by this invocation.
5. Validate their sidecars and provenance.
6. Archive currently published APKs into the variant's rollback destination.
7. Publish each new APK and sidecar to its explicit `paths.json` destination.
8. Verify the remote regular file and SHA-256.

### Bundle flow

`export.sh --with-apk` must stage only the exact APKs built for that bundle.
`deploy.sh` must publish those exact manifest-bound files only after the remote
deployment has successfully archived the previous release. An upload-only
operation must not unexpectedly replace live/downloadable APKs.

## Partial implementation already present

`lib/apk_ship.sh` currently contains helpers for:

- selecting an exact filename using target, variant, and version;
- rejecting local APK symlinks;
- validating sidecar metadata and SHA-256;
- archiving existing remote APKs;
- routing client/admin by `paths.json` directory order;
- transferring APK plus JSON sidecar and checking the remote digest.

`tests/apk_ship.test.sh` currently exercises some dev routing, exact-version
selection, sidecar transfer, archiving, symlink rejection, production gating,
and post-deploy ordering.

The helper signature was changed to require an exact version, but all callers
have not been reconciled. Treat the current implementation as a draft.

## Known blockers that must be fixed

### 1. Export stages retained artifacts instead of the exact new build

`export.sh` currently loops over matching files in `emu/out`. This can copy old
retained APKs into a new bundle. Copy only the two artifacts produced for the
current target and exact release version, along with their exact sidecars.

Record at least variant, filename, SHA-256, target, version, and Git commit in
the bundle manifest. Deployment must consume this manifest instead of choosing
by mtime or wildcard.

### 2. Standalone production publishing is insufficiently gated

The APK-only production route must not publish a dirty, untagged, unpushed, or
debug/unapproved artifact under a stable production filename.

Before production build/publish, require:

- clean source tree;
- exact expected release tag/version;
- local release commit present on the configured origin branch;
- sidecar commit matches the gated commit;
- `gitDirty == false` in sidecar;
- production target and both expected variants;
- approved production signing/build type.

If the current Android builder only produces `assembleDebug`, block production
publishing with a clear error until the production signing path exists. Do not
weaken this check just to make the workflow pass.

### 3. Paths contract is not yet authoritative enough

The current schema-2 helper trusts ordered `.vps.apk_dirs` plus one aggregate
`.backup.rollback_apk`. The target schema in
`PATHS_JSON_AUTHORITY_HANDOFF.md` uses explicit mappings:

```json
{
  "apk": {
    "enabled": true,
    "destinations": [
      {
        "variant": "client",
        "current_dir": "/absolute/current/client/path",
        "rollback_dir": "/absolute/rollback/client/path"
      },
      {
        "variant": "admin",
        "current_dir": "/absolute/current/admin/path",
        "rollback_dir": "/absolute/rollback/admin/path"
      }
    ]
  }
}
```

Route by the explicit `variant` field, never array position or directory name.
Validate containment, uniqueness, normalization, stack identity, and schema
before any SSH/rsync interpolation.

### 4. Remote symlink and digest verification must fail closed

Reject symlinks for:

- local APK and sidecar;
- remote current and rollback directories;
- remote APK and sidecar destination files.

The expected remote digest must come from the already validated immutable
sidecar/manifest value. Do not recompute the expected value from a mutable
local file after validation. Verify the remote target is a regular non-symlink
file before hashing it.

### 5. `--ship-only` semantics are unsafe/ambiguous

`deploy.sh --ship-only` is documented as uploading for inspection, but the
partial code publishes APKs into live directories. Preserve upload-only
semantics: stage the bundle on the VPS but do not change current APK holders.
Use a separate explicitly named APK publish action for live publication.

### 6. Archive destinations must be variant-specific

Create/use dedicated rollback directories from `paths.json`:

```text
/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/client
/srv/backup/BOE_APP/DEV_ROLLBACK/DEV_APK/admin
/srv/backup/BOE_APP/PROD_ROLLBACK/APK/client
/srv/backup/BOE_APP/PROD_ROLLBACK/APK/admin
```

Archive the existing client only to client rollback, and admin only to admin
rollback. Keep timestamped immutable archive directories and checksums. Never
infer a rollback path by appending a hardcoded component in a script; the final
absolute paths belong in `paths.json`.

## Recommended TDD sequence

Work test-first and keep network/build commands stubbed until local behavior is
green.

### RED: expand `tests/apk_ship.test.sh`

Add failing cases for:

1. all four routes use their explicit current and rollback destinations;
2. swapped JSON array ordering does not change variant routing;
3. missing client/admin or duplicate variants fail;
4. wrong stack, schema, target, containment, traversal, or unsafe paths fail;
5. exact version is required and retained older/newer artifacts are ignored;
6. bundle manifest filename and digest must match the selected file;
7. missing, symlinked, malformed, dirty, wrong-target, wrong-version, or
   wrong-commit sidecars fail;
8. remote symlink directories/files fail;
9. digest mismatch fails before live replacement is reported successful;
10. archive happens before publish for standalone APK flow;
11. full bundle deployment publishes only after successful remote deploy;
12. failed remote deployment publishes no APK;
13. `--ship-only` uploads but performs no live APK publish;
14. production debug/unsigned APK publishing is blocked;
15. custom fixture paths prove there is no fallback to raw `/srv/...` values.

Also add a test for atomic publication: transfer to a temporary filename,
verify it, then rename into place, so an interrupted upload cannot leave a
partial current APK.

### GREEN: minimal implementation

Suggested small helpers in `lib/apk_ship.sh`:

- `apk_contract_destination(pathsFile, variant)`
- `apk_manifest_artifact(manifestFile, variant)`
- `apk_validate_local_artifact(apk, sidecar, expected...)`
- `apk_archive_remote_variant(currentDir, rollbackDir)`
- `apk_publish_remote_atomic(apk, sidecar, currentDir, expectedSha)`
- `apk_ship_variant(...)`
- `apk_ship_release(...)`

Keep functions focused and return non-zero with a precise message on every
failure. Avoid mutation of shared global state; pass values explicitly.

## Files likely requiring changes

- `release_manager/lib/apk_ship.sh`
- `release_manager/tests/apk_ship.test.sh`
- `release_manager/export.sh`
- `release_manager/deploy.sh`
- `release_manager/status.sh`
- `release_manager/verify.sh`
- `emu/boe_update.sh` and/or its manifest/sidecar producer
- `release_manager/stacks/dev_release/paths.json`
- `release_manager/stacks/prod_release/paths.json`
- related README/operator documentation

Do not broaden this task into image/database deployment unless necessary to
keep shared bundle behavior correct.

## Verification commands

Discover the repository's canonical test runner first. At minimum run:

```bash
bash release_manager/tests/apk_ship.test.sh
bash release_manager/tests/status_menu.test.sh
bash release_manager/tests/release_tag_contract.test.sh
bash release_manager/verify.sh
shellcheck release_manager/lib/apk_ship.sh \
  release_manager/export.sh \
  release_manager/deploy.sh \
  release_manager/status.sh
```

Then run the full release-manager suite. Do not run a real build, SSH, rsync,
publication, or deployment until stubbed tests pass and the user explicitly
authorizes the live operation.

Before any commit, review the complete diff for secrets, unsafe path handling,
symlink races, production gating, and accidental publication behavior.

## Completion criteria

The APK task is complete only when:

- dev client/admin and prod client/admin are built and identified exactly;
- bundles contain only their two exact manifest-bound APKs and sidecars;
- every current and rollback destination comes from validated `paths.json`;
- client/admin routing is explicit, not positional or name-derived;
- old current APKs are archived to dedicated variant rollback destinations;
- publication is atomic and remote SHA-256 is verified;
- symlinks and unsafe paths are rejected locally and remotely;
- production refuses dirty, untagged, unpushed, debug, or improperly signed
  artifacts;
- upload-only does not modify live APK holders;
- failure before publication leaves the previous current APKs intact;
- focused and full release-manager tests pass;
- documentation matches actual commands and behavior.
