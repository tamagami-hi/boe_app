# Kimi Web Orchestration Context — Claude Handoff

> **Purpose:** This document captures the full context of a conversation about uploading the BOE codebase to Kimi Web (Moonshot AI) for agent-swarm completion, and the subsequent realization that Kimi Web lacks a project download mechanism. Claude should read this file, then build a local automation script that enables a round-trip workflow: upload to Kimi → get AI-generated changes → apply them back to the local repo automatically.

---

## 1. Project Overview

**Project:** BeOnEdge (BOE) — Indian institutional wealth-management platform  
**Location:** `/home/nethunter07/PROJECTS/boe_app`  
**Status:** Finalization project (Phases 1–6 largely complete). Remaining work: production hardening, test coverage, bundle optimization.

### Tech Stack
- **Backend:** Node.js 22+ (ES modules), custom HTTP router (no Express), PostgreSQL / JSON file store, JWT auth, Razorpay payments
- **Frontend:** React 18 + Vite 5, React Router 6, React Context state, Capacitor 8 for Android, plain CSS with design tokens
- **Container:** Docker + Docker Compose

### Key Directories
```
backend_controller/     # Node.js HTTP API server
frontend_stack/         # React + Vite design system (workspace)
resources/sessions/     # Session plans and architecture docs
resources/reference/    # Design system references, screenshots, external refs
resources/app-map/      # Living architecture maps
resources/agent/        # Agent coordination docs
```

---

## 2. The Original Goal

The user wanted to upload the **entire codebase** to the **Kimi Web interface** (kimi.moonshot.cn) and use Kimi's agent-swarm / multi-agent features to finish the project.

### What We Did
1. Examined folder contents and sizes:
   - `backend_controller/`: ~7.2 MB (6.1 MB was `node_modules`)
   - `frontend_stack/`: ~197 MB (~153 MB was `node_modules` + `android` build artifacts)
   - `resources/sessions/`: ~304 KB
   - `resources/reference/`: ~3.1 MB

2. Created a zip file for upload:
   - **File:** `/home/nethunter07/PROJECTS/boe_app/boe_upload.zip`
   - **Size:** 2.4 MB
   - **Files:** 673 files
   - **Contents:** `backend_controller/`, `frontend_stack/`, `resources/sessions/`, `resources/reference/`
   - **Excluded:** `node_modules/`, `.git/`, `dist/`, `build/`, `frontend_stack/app/android/`, `package-lock.json`

---

## 3. Kimi Web Upload Constraints

### Initial Assumption (User)
User believed Kimi Web only supports: `.doc`, `.ppt`, `.pdf`, etc.

### What the Research Found (via Web Search)
Kimi actually supports a **much wider** range of formats:

**API & Web Interface Supported Formats:**
- Documents: `.pdf`, `.txt`, `.csv`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.md`
- Code files: `.js`, `.jsx`, `.ts`, `.tsx`, `.css`, `.html`, `.json`, `.py`, `.java`, `.go`, `.c`, `.cpp`, `.cxx`, `.cc`, `.cs`, `.jsp`, `.php`, `.asp`, `.yaml`, `.yml`, `.ini`, `.conf`, `.sql`, `.log`
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico`, `.avif`, etc.
- Others: `.epub`, `.mobi`, `.html`

**Limits:**
- Single file: ≤ 100 MB
- Max files per user: 1,000
- Total storage: ≤ 10 GB
- Context window: Kimi K2.5/K2.6 supports up to **256k tokens** (~400k+ English words / ~200k Chinese characters)

**Source:** Kimi API official docs (`platform.kimi.com/docs/api/files-upload`)

---

## 4. The Scale Problem

The codebase text files total:
- **~201,621 lines** of code / config / markdown
- **~6,000+ individual text files** (`.js`, `.jsx`, `.css`, `.html`, `.json`, `.md`, `.sql`, `.mjs`)

This is **too large** for a single upload/context window and too many files for manual drag-and-drop.

### Proposed Chunking Strategy
Split the codebase into **4–6 consolidated `.txt` files** organized by domain so Kimi agents can reason about each surface independently:

| File | Contents | Est. Lines |
|---|---|---|
| `backend_routes_services.txt` | All backend routes & business logic (`src/client/`, `src/admin/`, `src/website/`, `src/shared/routes/`, `src/shared/services/`) | ~15k |
| `backend_db_config.txt` | DB adapters, migrations, config, scripts (`src/db/`, `src/config/`, `src/http/`, `src/security/`, `db/migrations/`, `scripts/`) | ~8k |
| `frontend_client.txt` | Client APK pages, services, styles (`frontend_stack/packages/client/`, `frontend_stack/app/src/client/`) | ~60k |
| `frontend_admin.txt` | Admin console pages & screens (`frontend_stack/packages/admin/`, `frontend_stack/app/src/admin/`) | ~25k |
| `frontend_website.txt` | Landing, onboarding, website package (`frontend_stack/packages/website/`, `frontend_stack/app/src/website/`) | ~20k |
| `frontend_shared.txt` | Shared components, design tokens, UI kits (`frontend_stack/packages/shared/`, `frontend_stack/packages/ui-kits/`, `frontend_stack/packages/design-tokens/`, `frontend_stack/app/src/shared/`) | ~30k |
| `resources_plans.txt` | Sessions, references, architecture maps (`resources/sessions/`, `resources/reference/`, `resources/app-map/`) | ~15k |

**Total: ~173k lines** — chunked by domain.

---

## 5. The Critical Gap: No Download from Kimi Web

**Kimi Web is a chat interface.** It generates text/code in responses but **does not maintain a live file system** that you can export. There is no "download project" button.

### Options Discussed for Getting Changes Back

#### Option A: Unified Diff / Patch File
- Ask Kimi: *"Output all changes as a single unified diff patch file that I can apply with `git apply`."*
- **Pros:** One copy-paste, preserves exact line changes
- **Cons:** If Kimi hallucinates line numbers or context, the patch fails; large patches are brittle
- **Apply locally:**
  ```bash
  cd /home/nethunter07/PROJECTS/boe_app
  git diff > backup-before-kimi.patch
  # paste Kimi's diff into kimi-changes.patch
  git apply kimi-changes.patch
  ```

#### Option B: Full File Rewrite Blocks
- Ask Kimi to output complete files with clear headers:
  ```
  === FILE: backend_controller/src/client/services/authService.js ===
  [full file content]
  === END FILE ===
  ```
- **Pros:** Exact final state of each file
- **Cons:** Massive copy-paste burden if many files changed

#### Option C: Hybrid — Plan on Kimi Web, Execute Locally (Recommended)
- Use Kimi web's agent swarm for **architecture decisions, bug diagnosis, and planning**
- Bring the plan/spec back to **Kimi Code CLI** (or Claude) to implement exact file changes locally
- **Pros:** You get Kimi's reasoning + precise local file edits with test validation
- **Cons:** One extra hop

#### Option D: Kimi API (Programmatic)
- Use the Kimi API with a custom script to upload files, get completions, and write responses back to disk
- **Pros:** Fully automated round-trip
- **Cons:** Requires building the glue script and paying for API tokens

---

## 6. Decision & Next Step

The user decided to **pivot to a local-agent workflow** using Claude (this handoff).

**Goal for Claude:** Read this context and build a script/tooling that enables one of the following:
1. **Chunk generator:** A script that splits the codebase into the domain-based `.txt` files listed in Section 4, ready for Kimi upload.
2. **Patch parser / file writer:** A script that takes Kimi's response (in diff format or file-block format) and automatically applies/writes the changes back to the local repo.
3. **Round-trip harness:** A combined workflow that optionally uploads chunks, captures Kimi responses, and applies them locally.

The user explicitly wants to **complete the project locally** using Claude rather than wrestling with manual copy-paste from Kimi Web.

---

## 7. Key Files & References

| Path | Description |
|---|---|
| `/home/nethunter07/PROJECTS/boe_app/boe_upload.zip` | Pre-built zip (2.4 MB, 673 files) of backend + frontend + resources |
| `/home/nethunter07/PROJECTS/boe_app/AGENTS.md` | Full project context for agents |
| `/home/nethunter07/PROJECTS/boe_app/resources/agent/AGENT_PLAN.md` | Multi-agent coordination plan, phase status |
| `/home/nethunter07/PROJECTS/boe_app/resources/agent/WORKING_MODEL.md` | Working-model rules |
| `/home/nethunter07/PROJECTS/boe_app/resources/docs/TESTING_GUIDE.md` | End-to-end testing guide |
| `/home/nethunter07/PROJECTS/boe_app/resources/app-map/md-maps/` | Living architecture maps (00_index.md is the master) |

---

## 8. Action Items for Claude

1. **Read this file** (`resources/sessions/kimi-orch.md`) to understand the full context.
2. **Check `resources/agent/AGENT_PLAN.md`** to see what work remains unfinished.
3. **Decide on strategy:**
   - Build a chunk-generation script for Kimi upload?
   - Build a patch-applier script for Kimi responses?
   - Or just work directly on the repo using existing local agent coordination (`resources/_coord/`) + Claude?
4. **Implement the smallest coherent change** per `AGENTS.md` rules.
5. **Run validation:** `npm run routes && npm run db:check && npm run build`.
6. **Update maps** and mark slices done in `AGENT_PLAN.md`.

---

*Saved: 2026-06-05*  
*Session: kimi-orch*  
*Next expected action: Claude reads this file and begins building the requested script or directly resumes project completion.*
