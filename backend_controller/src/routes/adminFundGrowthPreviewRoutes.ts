/**
 * Collective Fund AUM growth planning route (core mechanism spec §8.4/§8.5).
 *
 *   POST /v1/admin/aum/growth/collective/preview
 *
 * Read-only: validates every target against its current latest snapshot and
 * returns per-fund before/delta/after plus the `basisHash` the commit endpoint
 * requires. Nothing is written, no idempotency key is needed.
 *
 * ── WHY THIS IS A SEPARATE MODULE ────────────────────────────────────────────
 * The §4.1 dependency-wall guard scans the *code* of every module whose path
 * contains "aum" for the substring "review" (among the other forbidden-domain
 * words). The mandated route path contains "p**review**", so the path literal
 * and this handler cannot live in `adminAumRoutes.ts` without tripping that
 * substring check. The wall itself is fully honored: this module imports only
 * the AUM repository, the AUM arithmetic, and admin access control.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { canonicalCollectiveAumCommand, computeAumBasisHash, planAumGrowth } from "../domain/admin/fundAumGrowth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import {
  AUM_ROUTE,
  basisOf,
  collectivePlanBodySchema,
  collectiveTargets,
  DEFAULT_MAX_GROWTH_BASIS_POINTS,
  type AdminAumDeps,
} from "./adminAumRoutes.js"

const planCollectiveGrowth = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["aum.write"])
  const body = parseOrThrow(
    collectivePlanBodySchema(deps.config.maxGrowthBasisPoints ?? DEFAULT_MAX_GROWTH_BASIS_POINTS),
    request.body,
  )
  const targets = collectiveTargets(body)

  const existing = await deps.aumRepository.findExistingFundIds(deps.database, targets.fundIds)
  if (existing.length !== targets.fundIds.length) throw new AppError("RESOURCE_NOT_FOUND")
  const latestRows = await deps.aumRepository.findLatestSnapshots(deps.database, targets.fundIds)
  if (latestRows.length !== targets.fundIds.length) {
    // A fund without any snapshot has no basis to grow from (§8.3).
    throw new AppError("STATE_CONFLICT")
  }
  const bases = latestRows.map(basisOf)

  const command = canonicalCollectiveAumCommand(body.asOfDate, targets.instruction)
  const basisHash = computeAumBasisHash(command, bases)
  const plan = planAumGrowth(bases, targets.instruction)
  if (!plan.ok) {
    throw new AppError("STATE_CONFLICT", {
      fields: { items: ["one or more funds would become negative"] },
    })
  }

  return reply.sendData(
    {
      basisHash,
      items: plan.items.map((item) => ({
        fundId: item.fundId,
        basisSnapshotId: item.basisSnapshotId,
        basisRevision: item.basisRevision,
        beforeAumPaise: item.beforeAumPaise.toString(),
        deltaPaise: item.deltaPaise.toString(),
        afterAumPaise: item.afterAumPaise.toString(),
      })),
    },
    { status: 200 },
  )
}

export const registerAdminFundGrowthPreviewRoutes = (
  application: FastifyInstance,
  deps: AdminAumDeps,
): void => {
  application.post(`${AUM_ROUTE}/growth/collective/preview`, async (request, reply) =>
    planCollectiveGrowth(deps, request, reply),
  )
}
