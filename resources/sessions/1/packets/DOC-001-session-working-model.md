# DOC-001: Session Working Model And Reorganization

- Status: `ACTIVE`
- Owner surface: `resources/sessions/1/**` only
- Dependencies: BE-001 code checkpoint `9e884ad`
- Objective: adapt the referenced algo-engine working flow, reorganize Session
  1 and create durable migration,
  deletion, evidence, metrics, and resume records.
- Normative sources: user instructions; referenced
  `/home/nethunter07/PROJECTS/algo_engine/WORKING_MODEL.md`; existing Session 1
  master plan/specifications.
- Dominant risk: a stale or ambiguous migration authority/resume system causing
  duplicate work or unintended legacy JavaScript retention.
- Production replacement closure: documentation/process only; no code changes
  authorized after checkpoint `9e884ad`.
- Exact JS/JSX deletion target: none.
- Capability eval: a new session can identify intent, authority, live claims,
  one active packet, exact backlog ownership, last validation, and stop boundary
  from README/CURRENT without conversation history.
- Regression evals: all local links/anchors resolve; no old flat Session 1 path
  remains; inventory totals reproduce; Legacy hash matches; only Session 1 is
  changed; task/gate/log statuses agree.
- Gates: Markdown link/anchor/stale-path checks, inventory reproduction,
  `git diff --check`, Legacy hash, independent execution/consistency review.
- Required reviews: execution-model/dependency review and factual
  link/inventory/resume review.
- Rollback shape: revert the containing documentation commit; code checkpoint
  `9e884ad` and `resources/sessions/Legacy` remain unchanged.
- Done condition: every gate/review finding resolved, DOC-001 records marked
  done, docs-only commit pushed, and no code task started.
- Phase log: [DOC-001 log](../logs/DOC-001-session-working-model.md)
