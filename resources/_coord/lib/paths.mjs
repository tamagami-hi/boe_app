import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { operationalError } from "./errors.mjs";

function toRepoPath(path) {
  return path.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isContained(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function nearestExistingPath(path) {
  let candidate = path;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
  return candidate;
}

export function pathsOverlap(first, second) {
  const a = toRepoPath(first);
  const b = toRepoPath(second);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function isOwnedPath(path, ownerPaths) {
  return ownerPaths.some((owner) => path === owner || path.startsWith(`${owner}/`));
}

export function resolveCoordPath(repoRootInput, cwdInput, input, protectedPaths = []) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) {
    throw operationalError("Path must be a non-empty string without NUL bytes.", "INVALID_PATH");
  }
  const repoRoot = realpathSync(resolve(repoRootInput));
  const cwd = resolve(cwdInput);
  const lexicalTarget = resolve(cwd, input);
  if (!isContained(repoRoot, lexicalTarget)) {
    throw operationalError(`Path '${input}' is outside repository '${repoRoot}'.`, "OUTSIDE_REPOSITORY");
  }

  const existingAncestor = nearestExistingPath(lexicalTarget);
  const canonicalAncestor = realpathSync(existingAncestor);
  const canonicalTarget = resolve(canonicalAncestor, relative(existingAncestor, lexicalTarget));
  if (!isContained(repoRoot, canonicalTarget)) {
    throw operationalError(`Path '${input}' resolves outside repository through a symlink.`, "OUTSIDE_REPOSITORY");
  }

  const repoPath = toRepoPath(relative(repoRoot, canonicalTarget)) || ".";
  const protectedHit = protectedPaths.find((protectedPath) => pathsOverlap(repoPath, protectedPath));
  if (protectedHit) {
    throw operationalError(
      `Path '${repoPath}' overlaps protected path '${protectedHit}'.`,
      "PROTECTED_PATH",
    );
  }
  return repoPath;
}
