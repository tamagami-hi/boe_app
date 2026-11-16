import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { Nominee, NomineeHolder, UserNomineeRepository } from "../../repositories/userNomineeRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export const NOMINEE_CLIENT_ONLY_MESSAGE = "A nominee can only be recorded for a client account."
export const NOMINEE_CLOSED_MESSAGE =
  "This account is closed or its personal data was erased, so its nominee cannot be changed."
export const NOMINEE_STALE_MESSAGE = "The nominee changed since you opened it. Reload it and try again."

const MASK_MARKER = "***"

export interface NomineeDeps {
  readonly userNomineeRepository: UserNomineeRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface AdminNomineeDeps extends NomineeDeps {
  readonly userRepository: Pick<UserWriteRepository, "findActiveRolesAndPermissions">
}

export interface NomineeChange {
  readonly status: "changed" | "unchanged"
  readonly holder: NomineeHolder
}

interface ChangeInput {
  readonly holder: NomineeHolder
  readonly nominee: Nominee | null
  readonly actorType: "user" | "admin"
  readonly actorUserId: string
  readonly requestId: string
}

const conflict = (message: string): AppError => new AppError("STATE_CONFLICT", { message })

export const sameNominee = (left: Nominee | null, right: Nominee | null): boolean =>
  left === null || right === null ? left === right : left.name === right.name && left.relation === right.relation

export const maskNomineeName = (name: string): string => `${[...name][0] ?? ""}${MASK_MARKER}`

const changeKind = (previous: Nominee | null, next: Nominee | null): "added" | "removed" | "updated" => {
  if (previous === null) return "added"
  return next === null ? "removed" : "updated"
}

const auditMetadata = (previous: Nominee | null, updated: NomineeHolder): Record<string, unknown> => {
  const next = updated.nominee
  return {
    change: changeKind(previous, next),
    nameChanged: previous?.name !== next?.name,
    relationChanged: previous?.relation !== next?.relation,
    previousName: previous === null ? null : maskNomineeName(previous.name),
    currentName: next === null ? null : maskNomineeName(next.name),
    nomineeVersion: updated.version,
  }
}

const applyChange = async (tx: Transaction, deps: NomineeDeps, input: ChangeInput): Promise<NomineeChange> => {
  const { holder } = input
  if (sameNominee(holder.nominee, input.nominee)) return { status: "unchanged", holder }

  const updated = await deps.userNomineeRepository.replace(tx, {
    userId: holder.userId,
    nominee: input.nominee,
    expectedVersion: holder.version,
    now: deps.clock(),
  })
  if (updated === null) throw conflict(NOMINEE_STALE_MESSAGE)

  await deps.auditRepository.append(tx, {
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    command: "user.nominee_changed",
    entityType: "user",
    entityId: holder.userId,
    requestId: input.requestId,
    entityVersion: updated.userVersion,
    metadata: auditMetadata(holder.nominee, updated),
  })
  return { status: "changed", holder: updated }
}

export const readNominee = async (
  tx: Transaction,
  deps: Pick<NomineeDeps, "userNomineeRepository">,
  userId: string,
): Promise<NomineeHolder> => {
  const holder = await deps.userNomineeRepository.find(tx, userId)
  if (holder === null) throw new AppError("RESOURCE_NOT_FOUND")
  return holder
}

const holdsRoles = async (
  tx: Transaction,
  deps: Pick<AdminNomineeDeps, "userRepository">,
  userId: string,
): Promise<boolean> => (await deps.userRepository.findActiveRolesAndPermissions(tx, userId as UserId)).roles.length > 0

export const readClientNominee = async (
  tx: Transaction,
  deps: Pick<AdminNomineeDeps, "userNomineeRepository" | "userRepository">,
  userId: string,
): Promise<NomineeHolder> => {
  const holder = await readNominee(tx, deps, userId)
  if (await holdsRoles(tx, deps, userId)) throw new AppError("RESOURCE_NOT_FOUND")
  return holder
}

export const changeClientNominee = async (
  tx: Transaction,
  deps: AdminNomineeDeps,
  input: Readonly<{
    userId: string
    nominee: Nominee | null
    expectedVersion: number
    actorUserId: string
    requestId: string
  }>,
): Promise<NomineeChange> => {
  const holder = await deps.userNomineeRepository.lock(tx, input.userId)
  if (holder === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (await holdsRoles(tx, deps, input.userId)) throw conflict(NOMINEE_CLIENT_ONLY_MESSAGE)
  if (holder.accountState === "closed" || holder.tombstoned) throw conflict(NOMINEE_CLOSED_MESSAGE)
  if (holder.version !== input.expectedVersion) throw conflict(NOMINEE_STALE_MESSAGE)
  return applyChange(tx, deps, {
    holder,
    nominee: input.nominee,
    actorType: "admin",
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })
}
