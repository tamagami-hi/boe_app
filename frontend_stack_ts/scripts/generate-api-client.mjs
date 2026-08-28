import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const CONTRACTS_ENTRY = new URL("../../packages/contracts/dist/index.js", import.meta.url)
const OUTPUT = new URL("../src/api/generated/operations.ts", import.meta.url)

const isOperationDescriptor = (value) =>
  typeof value === "object" &&
  value !== null &&
  typeof value.operationId === "string" &&
  typeof value.method === "string" &&
  typeof value.path === "string" &&
  typeof value.request === "object" &&
  typeof value.success === "object" &&
  Array.isArray(value.errorCodes)

const main = async () => {
  let contracts
  try {
    contracts = await import(CONTRACTS_ENTRY.href)
  } catch (cause) {
    throw new Error(
      `Cannot import @beonedge/contracts from ${fileURLToPath(CONTRACTS_ENTRY)}. ` +
        "Run 'npm run build' in packages/contracts first.",
      { cause },
    )
  }

  const discovered = Object.entries(contracts)
    .filter(([, value]) => isOperationDescriptor(value))
    .map(([exportName, value]) => ({ exportName, operationId: value.operationId }))
    .sort((left, right) => left.exportName.localeCompare(right.exportName))

  if (discovered.length === 0) {
    throw new Error("No operation descriptors were discovered in @beonedge/contracts.")
  }

  const duplicates = discovered
    .map((entry) => entry.operationId)
    .filter((id, index, all) => all.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate operationId values in the contract: ${duplicates.join(", ")}`)
  }

  const importList = discovered.map((entry) => `  ${entry.exportName},`).join("\n")
  const registryList = [...discovered]
    .sort((left, right) => left.operationId.localeCompare(right.operationId))
    .map((entry) => {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(entry.operationId)
        ? entry.operationId
        : JSON.stringify(entry.operationId)
      return `  ${key}: ${entry.exportName},`
    })
    .join("\n")
  const reexportList = discovered.map((entry) => `  ${entry.exportName},`).join("\n")

  const contents = `import {
${importList}
} from "@beonedge/contracts"

export {
${reexportList}
}

export const OPERATIONS = {
${registryList}
} as const

export type OperationId = keyof typeof OPERATIONS

export const OPERATION_IDS = Object.keys(OPERATIONS) as readonly OperationId[]
`

  await writeFile(OUTPUT, contents, "utf8")
  process.stdout.write(
    `generate-api-client: emitted ${String(discovered.length)} operations to src/api/generated/operations.ts\n`,
  )
}

await main()
