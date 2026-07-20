import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { pathsOverlap, resolveCoordPath } from "./lib/paths.mjs";
import { createInitialState, publicState, validateState } from "./lib/model.mjs";
import { loadRuntimeConfig, validateAgentId } from "./lib/config.mjs";

const execFileAsync = promisify(execFile);
const COORD_CLI = resolve(dirname(new URL(import.meta.url).pathname), "coord.mjs");
const ADMIN_ID = "coord-admin";

function createHarness() {
  const repoRoot = mkdtempSync(join(tmpdir(), "boe-coord-test-"));
  const coordHome = join(repoRoot, "resources", "_coord");
  const packetRoot = join(repoRoot, "resources", "sessions", "1", "packets");
  mkdirSync(packetRoot, { recursive: true });
  mkdirSync(coordHome, { recursive: true });
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(packetRoot, "TASK-A.md"), "# TASK-A\n");
  writeFileSync(join(packetRoot, "TASK-B.md"), "# TASK-B\n");
  writeFileSync(
    join(coordHome, "project.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      staleMs: 60_000,
      lockTimeoutMs: 5_000,
      lockStaleMs: 30_000,
      historyLimit: 200,
      stateMaxBytes: 1_000_000,
      protectedPaths: ["resources/sessions/Legacy"],
      packetRoots: ["resources/sessions/1/packets"],
      adminAgents: [ADMIN_ID],
    }, null, 2)}\n`,
  );
  return { repoRoot, coordHome };
}

function cliEnv(harness, overrides = {}) {
  return {
    ...process.env,
    COORD_HOME: harness.coordHome,
    COORD_REPO_ROOT: harness.repoRoot,
    ...overrides,
  };
}

function runCli(harness, args, overrides = {}) {
  try {
    const stdout = execFileSync(process.execPath, [COORD_CLI, ...args], {
      cwd: harness.repoRoot,
      env: cliEnv(harness, overrides),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      status: error.status,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

function initAgent(harness, id) {
  const result = runCli(harness, ["--id", id, "init", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.agent.id, id);
  assert.match(payload.sessionToken, /^[a-f0-9]{64}$/);
  return payload.sessionToken;
}

function authenticated(harness, id, token, args) {
  return runCli(harness, ["--id", id, ...args], { COORD_SESSION_TOKEN: token });
}

function createReadyTask(harness, adminToken, taskId, dependencies = []) {
  const create = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "create", taskId,
    "--title", taskId,
    "--packet", `resources/sessions/1/packets/${taskId}.md`,
    "--owner", "src",
    ...dependencies.flatMap((dependency) => ["--depends-on", dependency]),
    "--json",
  ]);
  assert.equal(create.status, 0, create.stderr);
  const ready = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "ready", taskId, "--json",
  ]);
  assert.equal(ready.status, 0, ready.stderr);
}

test("hierarchical paths overlap symmetrically", () => {
  assert.equal(pathsOverlap("src", "src/server.ts"), true);
  assert.equal(pathsOverlap("src/server.ts", "src"), true);
  assert.equal(pathsOverlap("src/server.ts", "src/server.ts"), true);
  assert.equal(pathsOverlap("src/server.ts", "src/server.test.ts"), false);
});

test("path resolution rejects protected and outside-repository targets", () => {
  const harness = createHarness();
  assert.throws(
    () => resolveCoordPath(harness.repoRoot, harness.repoRoot, "../outside.ts", []),
    /outside repository/i,
  );
  assert.throws(
    () => resolveCoordPath(
      harness.repoRoot,
      harness.repoRoot,
      "resources/sessions/Legacy/secret.md",
      ["resources/sessions/Legacy"],
    ),
    /protected path/i,
  );
});

test("task readiness fails until dependencies are done and packet exists", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  createReadyTask(harness, adminToken, "TASK-A");
  const createB = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "create", "TASK-B",
    "--title", "Task B",
    "--packet", "resources/sessions/1/packets/TASK-B.md",
    "--owner", "src",
    "--depends-on", "TASK-A",
    "--json",
  ]);
  assert.equal(createB.status, 0, createB.stderr);
  const blocked = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "ready", "TASK-B", "--json",
  ]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /dependency.*TASK-A/i);

  const missingPacket = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "create", "TASK-C",
    "--title", "Task C",
    "--packet", "resources/sessions/1/packets/TASK-C.md",
    "--owner", "src",
    "--json",
  ]);
  assert.equal(missingPacket.status, 1);
  assert.match(missingPacket.stderr, /packet/i);
});

test("claim requires an active task and passive next never blocks", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  const otherToken = initAgent(harness, "codex-b");
  createReadyTask(harness, adminToken, "TASK-A");

  const withoutTask = authenticated(harness, "codex-a", workerToken, [
    "claim", "src/server.ts", "--json",
  ]);
  assert.equal(withoutTask.status, 1);
  assert.match(withoutTask.stderr, /active task/i);

  const next = authenticated(harness, "codex-b", otherToken, [
    "next", "src/server.ts", "--json",
  ]);
  assert.equal(next.status, 0, next.stderr);
  const start = authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]);
  assert.equal(start.status, 0, start.stderr);
  const claim = authenticated(harness, "codex-a", workerToken, [
    "claim", "src/server.ts", "--json",
  ]);
  assert.equal(claim.status, 0, claim.stderr);
});

test("three simultaneous same-path claims produce one holder", async () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  createReadyTask(harness, adminToken, "TASK-A");
  const tokens = new Map();
  for (const id of ["codex-a", "codex-b", "codex-c"]) {
    tokens.set(id, initAgent(harness, id));
    const join = authenticated(harness, id, tokens.get(id), [
      "task", id === "codex-a" ? "start" : "join", "TASK-A", "--json",
    ]);
    assert.equal(join.status, 0, join.stderr);
  }

  const results = await Promise.all(
    [...tokens].map(([id, token]) => execFileAsync(
      process.execPath,
      [COORD_CLI, "--id", id, "claim", "src/shared.ts", "--json"],
      { cwd: harness.repoRoot, env: cliEnv(harness, { COORD_SESSION_TOKEN: token }) },
    ).then(
      ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
      (error) => ({ status: error.code, stdout: error.stdout, stderr: error.stderr }),
    )),
  );
  assert.equal(results.filter((result) => result.status === 0).length, 1);

  const status = runCli(harness, ["status", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.claims.length, 1);
  assert.equal(payload.claims[0].path, "src/shared.ts");
});

test("stale claims block until revision-checked admin reclaim fences the session", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const firstToken = initAgent(harness, "codex-a");
  const secondToken = initAgent(harness, "codex-b");
  createReadyTask(harness, adminToken, "TASK-A");
  for (const [id, token, action] of [
    ["codex-a", firstToken, "start"],
    ["codex-b", secondToken, "join"],
  ]) {
    const result = authenticated(harness, id, token, ["task", action, "TASK-A", "--json"]);
    assert.equal(result.status, 0, result.stderr);
  }
  const firstClaim = authenticated(harness, "codex-a", firstToken, [
    "claim", "src/server.ts", "--json",
  ]);
  assert.equal(firstClaim.status, 0, firstClaim.stderr);

  const statePath = join(harness.coordHome, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.agents["codex-a"].heartbeatAt = "2000-01-01T00:00:00.000Z";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const blocked = authenticated(harness, "codex-b", secondToken, [
    "claim", "src/server.ts", "--json",
  ]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /codex-a.*stale/i);

  const current = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  const reclaim = authenticated(harness, ADMIN_ID, adminToken, [
    "reclaim", "codex-a", "--expected-revision", String(current.revision), "--json",
  ]);
  assert.equal(reclaim.status, 0, reclaim.stderr);
  const after = authenticated(harness, "codex-b", secondToken, [
    "claim", "src/server.ts", "--json",
  ]);
  assert.equal(after.status, 0, after.stderr);
  const fenced = authenticated(harness, "codex-a", firstToken, ["heartbeat", "--json"]);
  assert.equal(fenced.status, 1);
  assert.match(fenced.stderr, /session token|reclaimed/i);
});

test("protected path claims and task owner escapes fail without changing revision", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  const before = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  const result = authenticated(harness, "codex-a", workerToken, [
    "claim", "resources/sessions/Legacy/secret.md", "--json",
  ]);
  assert.equal(result.status, 1);
  const after = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  assert.equal(after.revision, before.revision);
});

test("successful mutations have monotonic revisions and bounded audit events", () => {
  const harness = createHarness();
  const token = initAgent(harness, ADMIN_ID);
  const first = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  const brief = authenticated(harness, ADMIN_ID, token, ["brief", "central work", "--json"]);
  assert.equal(brief.status, 0, brief.stderr);
  const second = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.events.at(-1).action, "agent.brief");
  const persisted = JSON.parse(readFileSync(join(harness.coordHome, "state.json"), "utf8"));
  assert.equal(validateState(persisted).revision, second.revision);
});

test("complete task lifecycle records agent metadata, intents, releases, and history", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "brief", "Implement", "central", "state", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "ref", "resources/sessions/1/packets/TASK-A.md", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "next", "src/intent.ts", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "drop", "src/intent.ts", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "claim", "src/module.ts", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "release", "src/module.ts", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "done", "TASK-A", "--json",
  ]).status, 0);

  const whoami = authenticated(harness, "codex-a", workerToken, ["whoami", "--json"]);
  assert.equal(whoami.status, 0, whoami.stderr);
  assert.equal(JSON.parse(whoami.stdout).agent.activeTask, null);
  assert.match(runCli(harness, ["history"]).stdout, /task\.done/);
  assert.equal(JSON.parse(runCli(harness, ["doctor", "--json"]).stdout).status, "ok");
  assert.match(runCli(harness, ["status"]).stdout, /TASK-A \[DONE\]/);
  const list = authenticated(harness, "codex-a", workerToken, ["task", "list", "--json"]);
  assert.equal(JSON.parse(list.stdout).tasks["TASK-A"].status, "DONE");
});

test("task and claim transition errors fail closed", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  assert.equal(runCli(harness, ["--id", "codex-a", "init", "--json"]).status, 1);

  const forbiddenCreate = authenticated(harness, "codex-a", workerToken, [
    "task", "create", "TASK-A",
    "--title", "Task A",
    "--packet", "resources/sessions/1/packets/TASK-A.md",
    "--owner", "src",
    "--json",
  ]);
  assert.equal(forbiddenCreate.status, 1);
  assert.match(forbiddenCreate.stderr, /not authorized/i);

  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  const ownerEscape = authenticated(harness, "codex-a", workerToken, [
    "claim", "resources/sessions/1/README.md", "--json",
  ]);
  assert.equal(ownerEscape.status, 1);
  assert.match(ownerEscape.stderr, /owner boundary/i);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "release", "src/missing.ts", "--json",
  ]).status, 1);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "drop", "src/missing.ts", "--json",
  ]).status, 1);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "claim", "src/held.ts", "--json",
  ]).status, 0);
  const prematureDone = authenticated(harness, "codex-a", workerToken, [
    "task", "done", "TASK-A", "--json",
  ]);
  assert.equal(prematureDone.status, 1);
  assert.match(prematureDone.stderr, /still has.*claim/i);

  const current = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  const activeReclaim = authenticated(harness, ADMIN_ID, adminToken, [
    "reclaim", "codex-a", "--expected-revision", String(current.revision), "--json",
  ]);
  assert.equal(activeReclaim.status, 1);
  assert.match(activeReclaim.stderr, /still active/i);
});

test("completed dependencies unlock downstream readiness", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, ADMIN_ID, adminToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, ADMIN_ID, adminToken, [
    "task", "done", "TASK-A", "--json",
  ]).status, 0);
  const createB = authenticated(harness, ADMIN_ID, adminToken, [
    "task", "create", "TASK-B",
    "--title", "Task B",
    "--packet", "resources/sessions/1/packets/TASK-B.md",
    "--owner", "src",
    "--depends-on", "TASK-A",
    "--json",
  ]);
  assert.equal(createB.status, 0, createB.stderr);
  assert.equal(authenticated(harness, ADMIN_ID, adminToken, [
    "task", "ready", "TASK-B", "--json",
  ]).status, 0);
});

test("state validation and public projection reject malformed ownership without exposing token hashes", () => {
  const initial = createInitialState(new Date().toISOString());
  assert.equal(validateState(initial).revision, 0);
  assert.throws(() => validateState({ ...initial, schemaVersion: 99 }), /schema/i);
  assert.throws(() => validateState({ ...initial, revision: -1 }), /revision/i);
  assert.throws(() => validateState({ ...initial, agents: [] }), /agent\/task maps/i);

  const harness = createHarness();
  initAgent(harness, ADMIN_ID);
  const publicView = JSON.parse(runCli(harness, ["status", "--json"]).stdout);
  assert.equal("tokenHash" in publicView.agents[ADMIN_ID], false);
  assert.equal(publicState(validateState(JSON.parse(
    readFileSync(join(harness.coordHome, "state.json"), "utf8"),
  )), 60_000).revision, publicView.revision);
});

test("symlink escapes, unsafe state links, and oversized state fail closed", () => {
  const harness = createHarness();
  const outside = mkdtempSync(join(tmpdir(), "boe-coord-outside-"));
  symlinkSync(outside, join(harness.repoRoot, "src", "escape"));
  assert.throws(
    () => resolveCoordPath(harness.repoRoot, harness.repoRoot, "src/escape/file.ts", []),
    /outside repository.*symlink/i,
  );

  const target = join(harness.repoRoot, "unsafe-state.json");
  writeFileSync(target, "{}\n");
  symlinkSync(target, join(harness.coordHome, "state.json"));
  const linked = runCli(harness, ["status", "--json"]);
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /symlink|regular file/i);

  const oversizedHarness = createHarness();
  writeFileSync(join(oversizedHarness.coordHome, "state.json"), "x".repeat(1_000_001));
  const oversized = runCli(oversizedHarness, ["status", "--json"]);
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /above.*limit/i);
});

test("a stale store mutex is fenced and recovered", () => {
  const harness = createHarness();
  const lockPath = join(harness.coordHome, "state.lock");
  mkdirSync(lockPath, { mode: 0o700 });
  writeFileSync(join(lockPath, "owner.json"), "{\"token\":\"abandoned\"}\n");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockPath, old, old);
  const token = initAgent(harness, ADMIN_ID);
  assert.equal(token.length, 64);
});

test("corrupt central state fails closed", () => {
  const harness = createHarness();
  initAgent(harness, ADMIN_ID);
  writeFileSync(join(harness.coordHome, "state.json"), "{not json\n");
  const result = runCli(harness, ["status", "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /corrupt|invalid json/i);
});

test("unknown options and invalid command arity exit with usage status", () => {
  const harness = createHarness();
  assert.equal(runCli(harness, ["--wat", "status"]).status, 2);
  assert.equal(runCli(harness, ["claim"]).status, 2);
});

test("configuration validation rejects malformed policy and identity inputs", () => {
  const harness = createHarness();
  const configPath = join(harness.coordHome, "project.json");
  const original = JSON.parse(readFileSync(configPath, "utf8"));
  const environment = { COORD_HOME: harness.coordHome, COORD_REPO_ROOT: harness.repoRoot };
  assert.equal(loadRuntimeConfig(environment).schemaVersion, 1);
  assert.throws(() => validateAgentId("../lead"), /invalid agent id/i);

  const invalidConfigs = [
    null,
    { ...original, schemaVersion: 2 },
    { ...original, staleMs: -1 },
    { ...original, protectedPaths: [1] },
    { ...original, adminAgents: ["../admin"] },
  ];
  for (const invalid of invalidConfigs) {
    writeFileSync(configPath, `${JSON.stringify(invalid)}\n`);
    assert.throws(() => loadRuntimeConfig(environment), /invalid|unsupported/i);
  }
  const missing = { ...original };
  delete missing.staleMs;
  writeFileSync(configPath, `${JSON.stringify(missing)}\n`);
  assert.throws(() => loadRuntimeConfig(environment), /missing 'staleMs'/i);
  writeFileSync(configPath, "{broken\n");
  assert.throws(() => loadRuntimeConfig(environment), /invalid coordinator project config/i);
});

test("central state schema rejects every malformed ownership boundary", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "claim", "src/held.ts", "--json",
  ]).status, 0);
  const base = JSON.parse(readFileSync(join(harness.coordHome, "state.json"), "utf8"));
  const variants = [
    (state) => { state.agents["codex-a"] = null; },
    (state) => { state.agents["codex-a"].status = "UNKNOWN"; },
    (state) => { state.agents["codex-a"].tokenHash = "short"; },
    (state) => { state.agents["codex-a"].heartbeatAt = "not-a-date"; },
    (state) => { state.agents["codex-a"].brief = "x".repeat(501); },
    (state) => { state.agents["codex-a"].refs = [1]; },
    (state) => { state.agents["codex-a"].activeTask = 7; },
    (state) => { state.tasks["TASK-A"] = null; },
    (state) => { state.tasks["TASK-A"].status = "UNKNOWN"; },
    (state) => { state.tasks["TASK-A"].dependsOn = [1]; },
    (state) => { state.tasks["TASK-A"].createdAt = "never"; },
    (state) => { state.claims = [{}]; },
    (state) => { state.claims[0].agentId = 2; },
    (state) => { state.claims[0].leaseEpoch = 0; },
    (state) => { state.claims[0].agentId = "missing-agent"; },
    (state) => { state.claims.push({ ...state.claims[0], path: "src" }); },
    (state) => { state.events = {}; },
  ];
  for (const mutate of variants) {
    const invalid = structuredClone(base);
    mutate(invalid);
    assert.throws(() => validateState(invalid), /invalid state/i);
  }
});

test("CLI derived identity, usage guards, and administrator revision checks are enforced", () => {
  const harness = createHarness();
  const derived = runCli(harness, ["init", "--json"], {
    COORD_AGENT: "codex",
    COORD_SESSION: "stable-test-session",
  });
  assert.equal(derived.status, 0, derived.stderr);
  const derivedPayload = JSON.parse(derived.stdout);
  assert.match(derivedPayload.agent.id, /^codex-[a-f0-9]{6}$/);

  assert.equal(runCli(harness, ["--id", derivedPayload.agent.id, "heartbeat", "--json"]).status, 1);
  assert.equal(runCli(harness, ["--id", "../bad", "init"]).status, 1);
  assert.equal(runCli(harness, ["--id", derivedPayload.agent.id, "task", "wat"], {
    COORD_SESSION_TOKEN: derivedPayload.sessionToken,
  }).status, 2);
  assert.equal(runCli(harness, ["--id", derivedPayload.agent.id, "task", "create", "TASK-A", "--json"], {
    COORD_SESSION_TOKEN: derivedPayload.sessionToken,
  }).status, 2);
  assert.equal(runCli(harness, ["--id", derivedPayload.agent.id, "reclaim", "coord-admin", "--json"], {
    COORD_SESSION_TOKEN: derivedPayload.sessionToken,
  }).status, 2);
  assert.equal(runCli(harness, ["wat", "--id", derivedPayload.agent.id], {
    COORD_SESSION_TOKEN: derivedPayload.sessionToken,
  }).status, 2);
  assert.match(runCli(harness, ["history"]).stdout, /agent\.init/);
  assert.equal(runCli(createHarness(), ["history"]).stdout.trim(), "No events.");
});

test("held claims can be dropped and stale claims make check fail", () => {
  const harness = createHarness();
  const adminToken = initAgent(harness, ADMIN_ID);
  const workerToken = initAgent(harness, "codex-a");
  createReadyTask(harness, adminToken, "TASK-A");
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "task", "start", "TASK-A", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "claim", "src/drop.ts", "--json",
  ]).status, 0);
  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "drop", "src/drop.ts", "--json",
  ]).status, 0);
  assert.equal(JSON.parse(runCli(harness, ["status", "--json"]).stdout).claims.length, 0);

  assert.equal(authenticated(harness, "codex-a", workerToken, [
    "claim", "src/stale.ts", "--json",
  ]).status, 0);
  const statePath = join(harness.coordHome, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.agents["codex-a"].heartbeatAt = "2000-01-01T00:00:00.000Z";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const check = runCli(harness, ["check", "--json"]);
  assert.equal(check.status, 1);
  assert.equal(JSON.parse(check.stdout).status, "blocked");
});
