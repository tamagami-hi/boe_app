# Repository Agent Instructions

Before inspecting, changing, testing, or committing this project, read the root `README.md` completely and follow every instruction in it.

## Forward-Only Development

This application is pre-production. Implement changes as forward-only development.

- Do not preserve backward compatibility, legacy code paths, compatibility aliases, dual-read or dual-write behavior, deprecated endpoints, or migration branches unless the user explicitly requests compatibility for the current task.
- Remove superseded implementation paths instead of retaining dormant alternatives.
- Keep historical behavior in version control, not in commented-out or unreachable source code.
- Prefer a clean current schema and API contract over compatibility scaffolding while the application remains pre-production.

The user may override this rule explicitly for a production release or a specific migration.

## NOTE:

```text
Must implement the rules from README.md from this projects root.```
