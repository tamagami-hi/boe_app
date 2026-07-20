#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

import { loadRuntimeConfig, validateAgentId } from "./lib/config.mjs";
import { CoordError, operationalError, usageError } from "./lib/errors.mjs";
import {
  authenticate,
  claimPaths,
  completeTask,
  createTask,
  dropIntent,
  isAgentStale,
  joinTask,
  publicState,
  readyTask,
  reclaimAgent,
  registerAgent,
  releasePaths,
  setAgentIntent,
  startTask,
  updateAgent,
} from "./lib/model.mjs";
import { isOwnedPath, resolveCoordPath } from "./lib/paths.mjs";
import { CentralStore } from "./lib/store.mjs";

const BOOLEAN_OPTIONS = new Set(["json"]);
const VALUE_OPTIONS = new Set([
  "id",
  "agent",
  "instance",
  "title",
  "packet",
  "owner",
  "depends-on",
  "expected-revision",
]);
const REPEATED_OPTIONS = new Set(["owner", "depends-on"]);

function parseArguments(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw usageError(`Unknown option '--${name}'.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw usageError(`Option '--${name}' requires a value.`);
    index += 1;
    if (REPEATED_OPTIONS.has(name)) options[name] = [...(options[name] ?? []), value];
    else if (options[name] !== undefined) throw usageError(`Option '--${name}' may be supplied only once.`);
    else options[name] = value;
  }
  return { options, positionals };
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

function resolveIdentity(options, environment = process.env) {
  const explicit = options.id || environment.COORD_AGENT_ID;
  if (explicit) {
    const id = validateAgentId(explicit);
    return { id, kind: id.split("-")[0] };
  }
  const kind = options.agent || environment.COORD_AGENT;
  if (!kind) throw usageError("Set COORD_AGENT_ID=<full-id> or COORD_AGENT=<kind>.");
  validateAgentId(kind, "agent kind");
  const instance = options.instance || environment.COORD_INSTANCE || shortHash(environment.COORD_SESSION || String(process.ppid));
  const id = validateAgentId(`${kind}-${instance}`);
  return { id, kind };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function requireToken(environment = process.env) {
  const token = environment.COORD_SESSION_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    throw operationalError("Set COORD_SESSION_TOKEN to the 64-character token returned by 'init'.", "TOKEN_REQUIRED");
  }
  return hashToken(token);
}

function nowIso() {
  return new Date().toISOString();
}

function uniquePaths(values, config) {
  if (!values.length) throw usageError("At least one path is required.");
  return [...new Set(values.map((path) => resolveCoordPath(
    config.repoRoot,
    process.cwd(),
    path,
    config.protectedPaths,
  )))];
}

function requirePositionals(positionals, count, usage) {
  if (positionals.length !== count) throw usageError(`Usage: ${usage}`);
}

function assertPacket(packetPath, config) {
  const packet = resolveCoordPath(config.repoRoot, process.cwd(), packetPath, config.protectedPaths);
  const isUnderPacketRoot = config.packetRoots.some((root) => isOwnedPath(packet, [root]));
  if (!isUnderPacketRoot) {
    throw operationalError(`Task packet '${packet}' is outside configured packet roots.`, "INVALID_PACKET");
  }
  const absolute = resolve(config.repoRoot, packet);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
    throw operationalError(`Task packet '${packet}' does not exist as a regular file.`, "MISSING_PACKET");
  }
  return packet;
}

function mutation(store, identity, tokenHash, action, reducer) {
  return store.mutate({
    actor: identity.id,
    action,
    reducer: (state) => {
      const agent = authenticate(state, identity.id, tokenHash);
      return reducer(state, agent);
    },
  });
}

function successfulPayload(mutationResult, extra = {}) {
  return {
    status: "ok",
    revision: mutationResult.state.revision,
    ...mutationResult.result,
    ...extra,
  };
}

function printResult(payload, isJson, humanMessage) {
  if (isJson) console.log(JSON.stringify(payload, null, 2));
  else console.log(humanMessage ?? JSON.stringify(payload, null, 2));
}

function humanStatus(state) {
  const lines = [
    `Central coordination revision ${state.revision} (${state.updatedAt})`,
    "",
    `Tasks: ${Object.keys(state.tasks).length}  Agents: ${Object.keys(state.agents).length}  Claims: ${state.claims.length}`,
  ];
  for (const task of Object.values(state.tasks).sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`- ${task.id} [${task.status}] ${task.title}`);
    if (task.dependsOn.length) lines.push(`  depends: ${task.dependsOn.join(", ")}`);
    if (task.assignees.length) lines.push(`  agents: ${task.assignees.join(", ")}`);
  }
  for (const agent of Object.values(state.agents).sort((a, b) => a.id.localeCompare(b.id))) {
    const stale = agent.isStale ? " STALE" : "";
    lines.push(`- ${agent.id} [${agent.status}${stale}] task=${agent.activeTask ?? "none"}`);
  }
  for (const claim of state.claims) lines.push(`- CLAIM ${claim.path} -> ${claim.agentId} (${claim.taskId})`);
  return lines.join("\n");
}

function taskCommand(context, subcommand, rest) {
  const { config, identity, isJson, options, store, tokenHash } = context;
  if (subcommand === "list") {
    requirePositionals(rest, 0, "coord task list [--json]");
    const state = publicState(store.read(), config.staleMs);
    printResult({ revision: state.revision, tasks: state.tasks }, isJson, humanStatus(state));
    return;
  }
  if (subcommand === "create") {
    requirePositionals(rest, 1, "coord task create <id> --title <text> --packet <path> --owner <path...>");
    if (!options.title || !options.packet || !(options.owner?.length)) {
      throw usageError("task create requires --title, --packet, and at least one --owner.");
    }
    const packet = assertPacket(options.packet, config);
    const ownerPaths = uniquePaths(options.owner, config);
    const result = mutation(store, identity, tokenHash, "task.create", (state, agent) => createTask(
      state,
      agent,
      {
        id: rest[0],
        title: options.title,
        packet,
        ownerPaths,
        dependsOn: options["depends-on"] ?? [],
      },
      nowIso(),
    ));
    printResult(successfulPayload(result), isJson, `Created ${rest[0]} at revision ${result.state.revision}.`);
    return;
  }
  if (["ready", "start", "join", "done"].includes(subcommand)) {
    requirePositionals(rest, 1, `coord task ${subcommand} <id>`);
    const taskId = rest[0];
    if (subcommand === "ready") {
      const current = store.read().tasks[taskId];
      if (current) assertPacket(current.packet, config);
    }
    const reducers = {
      ready: readyTask,
      start: startTask,
      join: joinTask,
      done: completeTask,
    };
    const result = mutation(store, identity, tokenHash, `task.${subcommand}`, (state, agent) => (
      reducers[subcommand](state, agent, taskId, nowIso())
    ));
    printResult(successfulPayload(result), isJson, `${subcommand} ${taskId} at revision ${result.state.revision}.`);
    return;
  }
  throw usageError("Task commands: create | ready | start | join | done | list");
}

function dispatch(parsed) {
  const config = loadRuntimeConfig();
  const store = new CentralStore(config);
  const [command, ...rest] = parsed.positionals;
  const isJson = Boolean(parsed.options.json);

  if (!command) throw usageError("A command is required.");
  if (command === "status") {
    requirePositionals(rest, 0, "coord status [--json]");
    const state = publicState(store.read(), config.staleMs);
    printResult(state, isJson, humanStatus(state));
    return;
  }
  if (command === "history") {
    requirePositionals(rest, 0, "coord history [--json]");
    const state = publicState(store.read(), config.staleMs);
    printResult({ revision: state.revision, events: state.events }, isJson,
      state.events.map((event) => `${event.revision} ${event.at} ${event.actor} ${event.action}: ${event.summary}`).join("\n") || "No events.");
    return;
  }
  if (command === "doctor" || command === "check") {
    requirePositionals(rest, 0, `coord ${command} [--json]`);
    const state = publicState(store.read(), config.staleMs);
    const staleClaims = state.claims.filter((claim) => state.agents[claim.agentId]?.isStale);
    const payload = {
      status: staleClaims.length ? "blocked" : "ok",
      revision: state.revision,
      staleClaims,
      statePath: config.statePath,
      protectedPaths: config.protectedPaths,
    };
    printResult(payload, isJson, staleClaims.length ? `BLOCKED: ${staleClaims.length} stale claim(s) require reclaim.` : "Coordinator state is healthy.");
    if (staleClaims.length) process.exitCode = 1;
    return;
  }

  const identity = resolveIdentity(parsed.options);
  if (command === "init") {
    requirePositionals(rest, 0, "coord init [--id <agent>] [--json]");
    const sessionToken = randomBytes(32).toString("hex");
    const role = config.adminAgents.includes(identity.id) ? "admin" : "worker";
    const result = store.mutate({
      actor: identity.id,
      action: "agent.init",
      reducer: (state) => registerAgent(state, {
        ...identity,
        role,
        tokenHash: hashToken(sessionToken),
        now: nowIso(),
      }),
    });
    printResult(successfulPayload(result, { sessionToken }), isJson,
      `Registered '${identity.id}' as ${role}. Save: export COORD_SESSION_TOKEN=${sessionToken}`);
    return;
  }

  const tokenHash = requireToken();
  const context = { config, identity, isJson, options: parsed.options, store, tokenHash };
  if (command === "task") {
    const [subcommand, ...taskRest] = rest;
    if (!subcommand) throw usageError("Task commands: create | ready | start | join | done | list");
    taskCommand(context, subcommand, taskRest);
    return;
  }
  if (command === "whoami") {
    requirePositionals(rest, 0, "coord whoami [--json]");
    const state = store.read();
    authenticate(state, identity.id, tokenHash);
    const agent = publicState(state, config.staleMs).agents[identity.id];
    printResult({ status: "ok", revision: state.revision, agent }, isJson, JSON.stringify(agent, null, 2));
    return;
  }
  if (command === "brief") {
    if (!rest.length) throw usageError("Usage: coord brief <text>");
    const brief = rest.join(" ");
    if (brief.length > 500) throw operationalError("Brief exceeds 500 characters.", "INPUT_TOO_LONG");
    const result = mutation(store, identity, tokenHash, "agent.brief", (state, agent) => ({
      state: updateAgent(state, agent.id, { brief }, nowIso()),
      result: { brief },
      summary: `updated brief for ${agent.id}`,
    }));
    printResult(successfulPayload(result), isJson, `Brief set: ${brief}`);
    return;
  }
  if (command === "ref") {
    const refs = uniquePaths(rest, config);
    const result = mutation(store, identity, tokenHash, "agent.ref", (state, agent) => {
      const merged = [...new Set([...agent.refs, ...refs])];
      return {
        state: updateAgent(state, agent.id, { refs: merged }, nowIso()),
        result: { refs: merged },
        summary: `updated refs for ${agent.id}`,
      };
    });
    printResult(successfulPayload(result), isJson, `Refs: ${result.result.refs.join(", ")}`);
    return;
  }
  if (command === "heartbeat") {
    requirePositionals(rest, 0, "coord heartbeat");
    const result = mutation(store, identity, tokenHash, "agent.heartbeat", (state, agent) => {
      const at = nowIso();
      return {
        state: updateAgent(state, agent.id, {}, at),
        result: { heartbeatAt: at },
        summary: `heartbeat ${agent.id}`,
      };
    });
    printResult(successfulPayload(result), isJson, `Heartbeat ${result.result.heartbeatAt}.`);
    return;
  }
  if (command === "next" || command === "claim" || command === "release" || command === "drop") {
    const paths = uniquePaths(rest, config);
    const action = command === "next" ? "claim.next" : `claim.${command}`;
    const result = mutation(store, identity, tokenHash, action, (state, agent) => {
      const at = nowIso();
      if (command === "next") return setAgentIntent(state, agent, paths, at);
      if (command === "claim") return claimPaths(state, agent, paths, config.staleMs, at);
      if (command === "release") return releasePaths(state, agent, paths, at, "released");
      const held = state.claims.filter((claim) => claim.agentId === agent.id).map((claim) => claim.path);
      return paths.every((path) => held.includes(path))
        ? releasePaths(state, agent, paths, at, "dropped")
        : dropIntent(state, agent, paths, at);
    });
    printResult(successfulPayload(result), isJson, `${command}: ${paths.join(", ")}`);
    return;
  }
  if (command === "reclaim") {
    requirePositionals(rest, 1, "coord reclaim <agent> --expected-revision <n>");
    const targetId = validateAgentId(rest[0]);
    const expectedRevision = Number(parsed.options["expected-revision"]);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw usageError("reclaim requires --expected-revision <non-negative integer>.");
    }
    const result = mutation(store, identity, tokenHash, "agent.reclaim", (state, agent) => reclaimAgent(
      state,
      agent,
      targetId,
      expectedRevision,
      config.staleMs,
      nowIso(),
    ));
    printResult(successfulPayload(result), isJson, `Reclaimed '${targetId}' at revision ${result.state.revision}.`);
    return;
  }
  throw usageError("Commands: init | brief | ref | next | claim | release | drop | heartbeat | status | whoami | reclaim | task | history | doctor | check");
}

try {
  dispatch(parseArguments(process.argv.slice(2)));
} catch (error) {
  if (error instanceof CoordError) {
    console.error(`${error.code}: ${error.message}`);
    process.exitCode = error.exitCode;
  } else {
    console.error(`INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
