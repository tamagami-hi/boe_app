import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { operationalError } from "./errors.mjs";

const DEFAULT_COORD_HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPO_ROOT = resolve(DEFAULT_COORD_HOME, "..", "..");
const AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REQUIRED_KEYS = [
  "schemaVersion",
  "staleMs",
  "lockTimeoutMs",
  "lockStaleMs",
  "historyLimit",
  "stateMaxBytes",
  "protectedPaths",
  "packetRoots",
  "adminAgents",
];

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw operationalError(
      `Invalid project config '${name}': expected integer ${minimum}..${maximum}.`,
      "INVALID_CONFIG",
    );
  }
  return value;
}

function requireStringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw operationalError(`Invalid project config '${name}': expected non-empty strings.`, "INVALID_CONFIG");
  }
  return [...new Set(value.map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")))];
}

export function validateAgentId(value, label = "agent id") {
  if (typeof value !== "string" || !AGENT_ID_PATTERN.test(value) || value.length > 80) {
    throw operationalError(
      `Invalid ${label} '${String(value)}'. Use lowercase letters, digits, and single hyphen-separated segments.`,
      "INVALID_AGENT_ID",
    );
  }
  return value;
}

export function loadRuntimeConfig(environment = process.env) {
  const coordHome = resolve(environment.COORD_HOME || DEFAULT_COORD_HOME);
  const repoRoot = resolve(environment.COORD_REPO_ROOT || DEFAULT_REPO_ROOT);
  const configPath = resolve(coordHome, "project.json");
  if (!existsSync(configPath)) {
    throw operationalError(`Missing coordinator project config: ${configPath}`, "MISSING_CONFIG");
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw operationalError(`Invalid coordinator project config '${configPath}': ${error.message}`, "INVALID_CONFIG");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw operationalError(`Invalid coordinator project config '${configPath}': expected object.`, "INVALID_CONFIG");
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in parsed)) {
      throw operationalError(`Invalid coordinator project config: missing '${key}'.`, "INVALID_CONFIG");
    }
  }
  if (parsed.schemaVersion !== 1) {
    throw operationalError(`Unsupported coordinator config schema version '${parsed.schemaVersion}'.`, "INVALID_CONFIG");
  }

  const adminAgents = requireStringArray(parsed.adminAgents, "adminAgents").map((id) => validateAgentId(id, "admin agent id"));
  return Object.freeze({
    schemaVersion: 1,
    coordHome,
    repoRoot,
    statePath: resolve(coordHome, "state.json"),
    lockPath: resolve(coordHome, "state.lock"),
    staleMs: requireInteger(parsed.staleMs, "staleMs", 5_000, 24 * 60 * 60 * 1_000),
    lockTimeoutMs: requireInteger(parsed.lockTimeoutMs, "lockTimeoutMs", 100, 60_000),
    lockStaleMs: requireInteger(parsed.lockStaleMs, "lockStaleMs", 2_000, 5 * 60_000),
    historyLimit: requireInteger(parsed.historyLimit, "historyLimit", 20, 10_000),
    stateMaxBytes: requireInteger(parsed.stateMaxBytes, "stateMaxBytes", 10_000, 20_000_000),
    protectedPaths: requireStringArray(parsed.protectedPaths, "protectedPaths"),
    packetRoots: requireStringArray(parsed.packetRoots, "packetRoots"),
    adminAgents,
  });
}
