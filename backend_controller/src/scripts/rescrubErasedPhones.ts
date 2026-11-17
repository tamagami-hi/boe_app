import { pathToFileURL } from "node:url"

import { parseDatabaseConfig } from "../db/config.js"
import { createDatabase } from "../db/database.js"
import { createPool } from "../db/pool.js"
import { runErasedPhoneRescrub } from "../domain/admin/erasedPhoneRescrub.js"
import { createClientErasureInspectRepository } from "../repositories/clientErasureInspectRepository.js"
import { createClientErasureWriteRepository } from "../repositories/clientErasureWriteRepository.js"
import { createErasedClientRepository } from "../repositories/erasedClientRepository.js"

export const APPLY_FLAG = "--apply"
export const ALLOW_PRODUCTION_FLAG = "--allow-production"

const KNOWN_FLAGS: ReadonlySet<string> = new Set([APPLY_FLAG, ALLOW_PRODUCTION_FLAG])
const REFUSED_EXIT_CODE = 2

export type RescrubInvocation =
  | Readonly<{ kind: "run"; apply: boolean }>
  | Readonly<{ kind: "refused"; message: string }>

export const resolveRescrubInvocation = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): RescrubInvocation => {
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg))
  if (unknown.length > 0) {
    return {
      kind: "refused",
      message: `Unknown argument ${unknown.join(" ")}. Only ${APPLY_FLAG} and ${ALLOW_PRODUCTION_FLAG} are accepted.`,
    }
  }
  if (env.NODE_ENV === "production" && !argv.includes(ALLOW_PRODUCTION_FLAG)) {
    return {
      kind: "refused",
      message: `NODE_ENV is production. Pass ${ALLOW_PRODUCTION_FLAG} to run against this database; nothing was read or changed.`,
    }
  }
  return { kind: "run", apply: argv.includes(APPLY_FLAG) }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const invocation = resolveRescrubInvocation(process.argv.slice(2), process.env)
  if (invocation.kind === "refused") {
    process.stderr.write(`${invocation.message}\n`)
    process.exitCode = REFUSED_EXIT_CODE
  } else {
    const pool = createPool(parseDatabaseConfig(process.env))
    try {
      const report = await runErasedPhoneRescrub(
        createDatabase(pool),
        {
          erasedClientRepository: createErasedClientRepository(),
          erasureInspectRepository: createClientErasureInspectRepository(),
          erasureWriteRepository: createClientErasureWriteRepository(),
        },
        { apply: invocation.apply },
      )
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } finally {
      await pool.end()
    }
  }
}
