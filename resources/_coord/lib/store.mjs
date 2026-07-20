import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { createInitialState, validateState } from "./model.mjs";
import { operationalError } from "./errors.mjs";

const LOCK_POLL_MS = 20;
const LOCK_OWNER_FILE = "owner.json";

function sleepSync(milliseconds) {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, milliseconds);
}

function nowIso() {
  return new Date().toISOString();
}

function assertRegularFile(path, label) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw operationalError(`${label} '${path}' must be a regular file, not a symlink or special file.`, "UNSAFE_STATE_PATH");
  }
  return stats;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw operationalError(`${label} '${path}' contains corrupt or invalid JSON: ${error.message}`, "CORRUPT_STATE");
  }
}

function ensureCoordHome(config) {
  mkdirSync(config.coordHome, { recursive: true, mode: 0o700 });
  const stats = lstatSync(config.coordHome);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw operationalError(`Coordinator home '${config.coordHome}' must be a real directory.`, "UNSAFE_STATE_PATH");
  }
}

function recoverStaleLock(config) {
  const stats = lstatSync(config.lockPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw operationalError(`Coordinator lock '${config.lockPath}' is not a safe directory.`, "UNSAFE_LOCK");
  }
  if (Date.now() - stats.mtimeMs <= config.lockStaleMs) return false;
  const stalePath = `${config.lockPath}.stale.${process.pid}.${randomUUID()}`;
  try {
    renameSync(config.lockPath, stalePath);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw operationalError(`Unable to fence stale coordinator lock: ${error.message}`, "LOCK_RECOVERY_FAILED");
  }
  rmSync(stalePath, { recursive: true, force: true });
  return true;
}

function acquireLock(config) {
  ensureCoordHome(config);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= config.lockTimeoutMs) {
    const token = randomUUID();
    try {
      mkdirSync(config.lockPath, { mode: 0o700 });
      const ownerPath = join(config.lockPath, LOCK_OWNER_FILE);
      const descriptor = openSync(
        ownerPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(descriptor, `${JSON.stringify({ token, pid: process.pid, acquiredAt: nowIso() })}\n`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return { token, ownerPath };
    } catch (error) {
      if (error.code !== "EEXIST") {
        try {
          rmSync(config.lockPath, { recursive: true, force: true });
        } catch {
          // The original error is more actionable.
        }
        throw operationalError(`Unable to acquire coordinator lock: ${error.message}`, "LOCK_FAILED");
      }
      if (existsSync(config.lockPath)) recoverStaleLock(config);
      sleepSync(LOCK_POLL_MS);
    }
  }
  throw operationalError(`Timed out waiting for central coordinator lock after ${config.lockTimeoutMs}ms.`, "LOCK_TIMEOUT");
}

function assertLockOwned(lock, config) {
  if (!existsSync(lock.ownerPath)) {
    throw operationalError("Coordinator lock ownership was lost before state commit.", "LOCK_FENCED");
  }
  assertRegularFile(lock.ownerPath, "Coordinator lock owner file");
  const owner = readJson(lock.ownerPath, "Coordinator lock owner file");
  if (owner.token !== lock.token) {
    throw operationalError("Coordinator lock was fenced by another process.", "LOCK_FENCED");
  }
}

function releaseLock(lock, config) {
  assertLockOwned(lock, config);
  unlinkSync(lock.ownerPath);
  try {
    rmdirSync(config.lockPath);
  } catch (error) {
    throw operationalError(`Unable to release coordinator lock: ${error.message}`, "LOCK_RELEASE_FAILED");
  }
}

function readState(config) {
  if (!existsSync(config.statePath)) return createInitialState(nowIso());
  const stats = assertRegularFile(config.statePath, "Coordinator state");
  if (stats.size > config.stateMaxBytes) {
    throw operationalError(
      `Coordinator state is ${stats.size} bytes, above the ${config.stateMaxBytes}-byte limit.`,
      "STATE_TOO_LARGE",
    );
  }
  return validateState(readJson(config.statePath, "Coordinator state"));
}

function persistState(config, state, lock) {
  assertLockOwned(lock, config);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > config.stateMaxBytes) {
    throw operationalError("Coordinator mutation would exceed the configured state size limit.", "STATE_TOO_LARGE");
  }
  const temporaryPath = `${config.statePath}.tmp.${process.pid}.${randomUUID()}`;
  const descriptor = openSync(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  assertLockOwned(lock, config);
  renameSync(temporaryPath, config.statePath);
  const directoryDescriptor = openSync(dirname(config.statePath), constants.O_RDONLY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function appendEvent(state, event, historyLimit) {
  const events = [...state.events, event];
  return events.length > historyLimit ? events.slice(events.length - historyLimit) : events;
}

export class CentralStore {
  constructor(config) {
    this.config = config;
  }

  read() {
    ensureCoordHome(this.config);
    return readState(this.config);
  }

  mutate({ actor, action, reducer }) {
    const lock = acquireLock(this.config);
    try {
      const current = readState(this.config);
      const mutation = reducer(current);
      if (!mutation || !mutation.state || !mutation.result) {
        throw operationalError(`Mutation '${action}' returned an invalid result.`, "INVALID_MUTATION");
      }
      validateState(mutation.state);
      const revision = current.revision + 1;
      const at = nowIso();
      const event = {
        revision,
        at,
        actor,
        action,
        summary: String(mutation.summary || action).slice(0, 500),
      };
      const next = validateState({
        ...mutation.state,
        revision,
        updatedAt: at,
        events: appendEvent(mutation.state, event, this.config.historyLimit),
      });
      persistState(this.config, next, lock);
      return { state: next, result: mutation.result, event };
    } finally {
      if (existsSync(this.config.lockPath)) releaseLock(lock, this.config);
    }
  }
}
