import { isOwnedPath, pathsOverlap } from "./paths.mjs";
import { operationalError } from "./errors.mjs";

const TASK_STATUSES = new Set(["BACKLOG", "READY", "ACTIVE", "DONE"]);
const AGENT_STATUSES = new Set(["ACTIVE", "RECLAIMED"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw operationalError(`Invalid state: '${label}' must be an array.`, "INVALID_STATE");
  return value;
}

function requireStrings(value, label) {
  const entries = requireArray(value, label);
  if (entries.some((entry) => typeof entry !== "string" || !entry)) {
    throw operationalError(`Invalid state: '${label}' must contain non-empty strings.`, "INVALID_STATE");
  }
  return entries;
}

function validateAgent(agent, id) {
  if (!isRecord(agent) || agent.id !== id || typeof agent.kind !== "string") {
    throw operationalError(`Invalid state: malformed agent '${id}'.`, "INVALID_STATE");
  }
  if (!AGENT_STATUSES.has(agent.status) || !Number.isSafeInteger(agent.sessionEpoch) || agent.sessionEpoch < 1) {
    throw operationalError(`Invalid state: malformed lifecycle for agent '${id}'.`, "INVALID_STATE");
  }
  if (agent.status === "ACTIVE" && !SHA256_PATTERN.test(agent.tokenHash ?? "")) {
    throw operationalError(`Invalid state: active agent '${id}' has no valid token verifier.`, "INVALID_STATE");
  }
  if (agent.status === "RECLAIMED" && agent.tokenHash !== null) {
    throw operationalError(`Invalid state: reclaimed agent '${id}' retains a token verifier.`, "INVALID_STATE");
  }
  if (!isIsoDate(agent.heartbeatAt) || !isIsoDate(agent.updatedAt)) {
    throw operationalError(`Invalid state: agent '${id}' has invalid timestamps.`, "INVALID_STATE");
  }
  if (typeof agent.brief !== "string" || agent.brief.length > 500) {
    throw operationalError(`Invalid state: agent '${id}' has an invalid brief.`, "INVALID_STATE");
  }
  requireStrings(agent.refs, `agents.${id}.refs`);
  requireStrings(agent.next, `agents.${id}.next`);
  if (agent.activeTask !== null && typeof agent.activeTask !== "string") {
    throw operationalError(`Invalid state: agent '${id}' has an invalid active task.`, "INVALID_STATE");
  }
}

function validateTask(task, id) {
  if (!isRecord(task) || task.id !== id || typeof task.title !== "string" || !task.title) {
    throw operationalError(`Invalid state: malformed task '${id}'.`, "INVALID_STATE");
  }
  if (!TASK_STATUSES.has(task.status) || typeof task.packet !== "string" || !task.packet) {
    throw operationalError(`Invalid state: task '${id}' has an invalid status or packet.`, "INVALID_STATE");
  }
  requireStrings(task.dependsOn, `tasks.${id}.dependsOn`);
  requireStrings(task.ownerPaths, `tasks.${id}.ownerPaths`);
  requireStrings(task.assignees, `tasks.${id}.assignees`);
  if (!isIsoDate(task.createdAt) || !isIsoDate(task.updatedAt)) {
    throw operationalError(`Invalid state: task '${id}' has invalid timestamps.`, "INVALID_STATE");
  }
}

function validateClaim(claim, index) {
  if (!isRecord(claim) || typeof claim.path !== "string" || !claim.path) {
    throw operationalError(`Invalid state: malformed claim ${index}.`, "INVALID_STATE");
  }
  if (typeof claim.agentId !== "string" || typeof claim.taskId !== "string") {
    throw operationalError(`Invalid state: malformed claim ownership at ${index}.`, "INVALID_STATE");
  }
  if (!Number.isSafeInteger(claim.leaseEpoch) || claim.leaseEpoch < 1 || !isIsoDate(claim.claimedAt)) {
    throw operationalError(`Invalid state: malformed claim lease at ${index}.`, "INVALID_STATE");
  }
}

export function createInitialState(now) {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now,
    agents: {},
    tasks: {},
    claims: [],
    events: [],
  };
}

export function validateState(state) {
  if (!isRecord(state) || state.schemaVersion !== 1) {
    throw operationalError("Invalid or unsupported central state schema.", "INVALID_STATE");
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !isIsoDate(state.updatedAt)) {
    throw operationalError("Invalid central state revision or timestamp.", "INVALID_STATE");
  }
  if (!isRecord(state.agents) || !isRecord(state.tasks)) {
    throw operationalError("Invalid central state agent/task maps.", "INVALID_STATE");
  }
  for (const [id, agent] of Object.entries(state.agents)) validateAgent(agent, id);
  for (const [id, task] of Object.entries(state.tasks)) validateTask(task, id);
  requireArray(state.claims, "claims").forEach(validateClaim);
  requireArray(state.events, "events");

  for (let index = 0; index < state.claims.length; index += 1) {
    const claim = state.claims[index];
    const agent = state.agents[claim.agentId];
    const task = state.tasks[claim.taskId];
    if (!agent || !task || agent.sessionEpoch !== claim.leaseEpoch) {
      throw operationalError(`Invalid state: claim '${claim.path}' has a dangling or fenced owner.`, "INVALID_STATE");
    }
    const overlap = state.claims.findIndex(
      (other, otherIndex) => otherIndex !== index && pathsOverlap(claim.path, other.path),
    );
    if (overlap !== -1) {
      throw operationalError(
        `Invalid state: overlapping claims '${claim.path}' and '${state.claims[overlap].path}'.`,
        "INVALID_STATE",
      );
    }
  }
  return state;
}

export function publicState(state, staleMs, nowMs = Date.now()) {
  const agents = Object.fromEntries(Object.entries(state.agents).map(([id, agent]) => [id, {
    id: agent.id,
    kind: agent.kind,
    role: agent.role,
    status: agent.status,
    sessionEpoch: agent.sessionEpoch,
    heartbeatAt: agent.heartbeatAt,
    updatedAt: agent.updatedAt,
    isStale: isAgentStale(agent, staleMs, nowMs),
    brief: agent.brief,
    refs: [...agent.refs],
    next: [...agent.next],
    activeTask: agent.activeTask,
  }]));
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    updatedAt: state.updatedAt,
    agents,
    tasks: state.tasks,
    claims: state.claims,
    events: state.events,
  };
}

export function isAgentStale(agent, staleMs, nowMs = Date.now()) {
  return agent.status !== "ACTIVE" || nowMs - Date.parse(agent.heartbeatAt) > staleMs;
}

export function authenticate(state, agentId, tokenHash) {
  const agent = state.agents[agentId];
  if (!agent || agent.status !== "ACTIVE" || agent.tokenHash !== tokenHash) {
    throw operationalError(
      `Agent '${agentId}' has no active session or the session token is invalid/reclaimed.`,
      "AUTHENTICATION_FAILED",
    );
  }
  return agent;
}

export function requireAdmin(agent) {
  if (agent.role !== "admin") {
    throw operationalError(`Agent '${agent.id}' is not authorized for this administrator action.`, "FORBIDDEN");
  }
}

export function registerAgent(state, { id, kind, role, tokenHash, now }) {
  const existing = state.agents[id];
  if (existing?.status === "ACTIVE") {
    throw operationalError(`Agent '${id}' already has a session; use its existing token or reclaim it when stale.`, "SESSION_EXISTS");
  }
  const sessionEpoch = existing?.sessionEpoch ?? 1;
  const agent = {
    id,
    kind,
    role,
    status: "ACTIVE",
    sessionEpoch,
    tokenHash,
    heartbeatAt: now,
    updatedAt: now,
    brief: "",
    refs: [],
    next: [],
    activeTask: null,
  };
  return {
    state: { ...state, agents: { ...state.agents, [id]: agent } },
    result: { agent: { id, kind, role, sessionEpoch } },
    summary: `registered ${id}`,
  };
}

export function updateAgent(state, agentId, changes, now) {
  const agent = state.agents[agentId];
  const nextAgent = { ...agent, ...changes, updatedAt: now, heartbeatAt: now };
  return { ...state, agents: { ...state.agents, [agentId]: nextAgent } };
}

export function createTask(state, agent, input, now) {
  requireAdmin(agent);
  if (!/^[A-Z][A-Z0-9]*-[0-9A-Z]+$/.test(input.id) || input.id.length > 80) {
    throw operationalError(`Invalid task id '${input.id}'.`, "INVALID_TASK");
  }
  if (state.tasks[input.id]) throw operationalError(`Task '${input.id}' already exists.`, "TASK_EXISTS");
  for (const dependency of input.dependsOn) {
    if (!state.tasks[dependency]) throw operationalError(`Unknown dependency '${dependency}'.`, "UNKNOWN_DEPENDENCY");
  }
  const task = {
    id: input.id,
    title: input.title,
    status: "BACKLOG",
    dependsOn: [...new Set(input.dependsOn)],
    packet: input.packet,
    ownerPaths: [...new Set(input.ownerPaths)],
    assignees: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  return {
    state: { ...state, tasks: { ...state.tasks, [task.id]: task } },
    result: { task },
    summary: `created task ${task.id}`,
  };
}

export function readyTask(state, agent, taskId, now) {
  requireAdmin(agent);
  const task = requireTask(state, taskId);
  if (task.status !== "BACKLOG") throw operationalError(`Task '${taskId}' is ${task.status}, not BACKLOG.`, "INVALID_TRANSITION");
  const incomplete = task.dependsOn.filter((dependency) => state.tasks[dependency]?.status !== "DONE");
  if (incomplete.length) {
    throw operationalError(`Task '${taskId}' has incomplete dependency: ${incomplete.join(", ")}.`, "DEPENDENCY_BLOCKED");
  }
  const nextTask = { ...task, status: "READY", updatedAt: now };
  return {
    state: { ...state, tasks: { ...state.tasks, [taskId]: nextTask } },
    result: { task: nextTask },
    summary: `marked task ${taskId} ready`,
  };
}

export function startTask(state, agent, taskId, now) {
  if (agent.activeTask) throw operationalError(`Agent '${agent.id}' already has active task '${agent.activeTask}'.`, "AGENT_BUSY");
  const task = requireTask(state, taskId);
  if (task.status !== "READY") throw operationalError(`Task '${taskId}' is ${task.status}, not READY.`, "INVALID_TRANSITION");
  const nextTask = { ...task, status: "ACTIVE", assignees: [agent.id], updatedAt: now };
  const nextState = updateAgent(
    { ...state, tasks: { ...state.tasks, [taskId]: nextTask } },
    agent.id,
    { activeTask: taskId },
    now,
  );
  return { state: nextState, result: { task: nextTask }, summary: `started task ${taskId}` };
}

export function joinTask(state, agent, taskId, now) {
  if (agent.activeTask) throw operationalError(`Agent '${agent.id}' already has active task '${agent.activeTask}'.`, "AGENT_BUSY");
  const task = requireTask(state, taskId);
  if (task.status !== "ACTIVE") throw operationalError(`Task '${taskId}' is ${task.status}, not ACTIVE.`, "INVALID_TRANSITION");
  const nextTask = { ...task, assignees: [...new Set([...task.assignees, agent.id])], updatedAt: now };
  const nextState = updateAgent(
    { ...state, tasks: { ...state.tasks, [taskId]: nextTask } },
    agent.id,
    { activeTask: taskId },
    now,
  );
  return { state: nextState, result: { task: nextTask }, summary: `joined task ${taskId}` };
}

export function completeTask(state, agent, taskId, now) {
  const task = requireTask(state, taskId);
  if (task.status !== "ACTIVE" || (!task.assignees.includes(agent.id) && agent.role !== "admin")) {
    throw operationalError(`Agent '${agent.id}' cannot complete task '${taskId}'.`, "INVALID_TRANSITION");
  }
  const held = state.claims.filter((claim) => claim.taskId === taskId);
  if (held.length) throw operationalError(`Task '${taskId}' still has ${held.length} claim(s).`, "CLAIMS_REMAIN");
  const nextTask = { ...task, status: "DONE", completedAt: now, updatedAt: now };
  const agents = Object.fromEntries(Object.entries(state.agents).map(([id, entry]) => [id,
    entry.activeTask === taskId ? { ...entry, activeTask: null, updatedAt: now } : entry,
  ]));
  return {
    state: { ...state, agents, tasks: { ...state.tasks, [taskId]: nextTask } },
    result: { task: nextTask },
    summary: `completed task ${taskId}`,
  };
}

export function setAgentIntent(state, agent, wantedPaths, now) {
  const next = [...new Set([...agent.next, ...wantedPaths])];
  return {
    state: updateAgent(state, agent.id, { next }, now),
    result: { next },
    summary: `updated next intent for ${agent.id}`,
  };
}

export function claimPaths(state, agent, wantedPaths, staleMs, now) {
  if (!agent.activeTask) throw operationalError(`Agent '${agent.id}' needs an active task before claiming paths.`, "NO_ACTIVE_TASK");
  const task = requireTask(state, agent.activeTask);
  for (const path of wantedPaths) {
    if (!isOwnedPath(path, task.ownerPaths)) {
      throw operationalError(`Path '${path}' is outside task '${task.id}' owner boundary.`, "OWNER_BOUNDARY");
    }
    const conflict = state.claims.find((claim) => pathsOverlap(path, claim.path));
    if (conflict) {
      const holder = state.agents[conflict.agentId];
      const staleLabel = isAgentStale(holder, staleMs, Date.parse(now)) ? "stale" : "active";
      throw operationalError(
        `Path '${path}' conflicts with '${conflict.path}' held by '${conflict.agentId}' (${staleLabel}); explicit reclaim is required when stale.`,
        "CLAIM_CONFLICT",
      );
    }
  }
  const additions = wantedPaths.map((path) => ({
    path,
    agentId: agent.id,
    taskId: task.id,
    leaseEpoch: agent.sessionEpoch,
    claimedAt: now,
  }));
  const nextState = updateAgent(
    { ...state, claims: [...state.claims, ...additions] },
    agent.id,
    { next: agent.next.filter((path) => !wantedPaths.includes(path)) },
    now,
  );
  return { state: nextState, result: { claims: additions }, summary: `claimed ${wantedPaths.join(", ")}` };
}

export function releasePaths(state, agent, wantedPaths, now, action = "released") {
  const owned = state.claims.filter((claim) => claim.agentId === agent.id && claim.leaseEpoch === agent.sessionEpoch);
  const missing = wantedPaths.filter((path) => !owned.some((claim) => claim.path === path));
  if (missing.length) throw operationalError(`Agent '${agent.id}' does not hold: ${missing.join(", ")}.`, "CLAIM_NOT_HELD");
  const wanted = new Set(wantedPaths);
  const nextState = updateAgent(
    { ...state, claims: state.claims.filter((claim) => !(claim.agentId === agent.id && wanted.has(claim.path))) },
    agent.id,
    {},
    now,
  );
  return { state: nextState, result: { paths: wantedPaths }, summary: `${action} ${wantedPaths.join(", ")}` };
}

export function dropIntent(state, agent, wantedPaths, now) {
  const wanted = new Set(wantedPaths);
  const existing = new Set(agent.next);
  const missing = wantedPaths.filter((path) => !existing.has(path));
  if (missing.length) throw operationalError(`Agent '${agent.id}' has no next intent for: ${missing.join(", ")}.`, "INTENT_NOT_FOUND");
  const next = agent.next.filter((path) => !wanted.has(path));
  return {
    state: updateAgent(state, agent.id, { next }, now),
    result: { paths: wantedPaths },
    summary: `dropped intent ${wantedPaths.join(", ")}`,
  };
}

export function reclaimAgent(state, admin, targetId, expectedRevision, staleMs, now) {
  requireAdmin(admin);
  if (state.revision !== expectedRevision) {
    throw operationalError(`Revision changed: expected ${expectedRevision}, current ${state.revision}.`, "REVISION_CONFLICT");
  }
  const target = state.agents[targetId];
  if (!target) throw operationalError(`Unknown agent '${targetId}'.`, "UNKNOWN_AGENT");
  if (!isAgentStale(target, staleMs, Date.parse(now))) {
    throw operationalError(`Agent '${targetId}' is still active; refusing reclaim.`, "AGENT_ACTIVE");
  }
  const remainingClaims = state.claims.filter((claim) => claim.agentId !== targetId);
  const reclaimed = {
    ...target,
    status: "RECLAIMED",
    sessionEpoch: target.sessionEpoch + 1,
    tokenHash: null,
    activeTask: null,
    next: [],
    updatedAt: now,
  };
  const tasks = Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => {
    if (!task.assignees.includes(targetId)) return [id, task];
    const assignees = task.assignees.filter((entry) => entry !== targetId);
    const status = task.status === "ACTIVE" && assignees.length === 0 ? "READY" : task.status;
    return [id, { ...task, assignees, status, updatedAt: now }];
  }));
  return {
    state: { ...state, agents: { ...state.agents, [targetId]: reclaimed }, tasks, claims: remainingClaims },
    result: { targetId, releasedClaims: state.claims.length - remainingClaims.length },
    summary: `reclaimed stale agent ${targetId}`,
  };
}

export function requireTask(state, taskId) {
  const task = state.tasks[taskId];
  if (!task) throw operationalError(`Unknown task '${taskId}'.`, "UNKNOWN_TASK");
  return task;
}
