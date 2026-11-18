import {
  checkContract,
  diffConfig,
  fieldProblems,
  versionsAboveRelease,
  type ConfigChange,
  type ConfigPayload,
  type FieldProblems,
  type JsonRecord,
  type VersionAbove,
} from "./configDraft"

export type DraftChecks = Readonly<{
  problems: FieldProblems
  refusals: readonly string[]
  changes: readonly ConfigChange[]
  above: readonly VersionAbove[]
  payload: ConfigPayload | null
  isPublishable: boolean
}>

const NO_CHECKS: DraftChecks = { problems: {}, refusals: [], changes: [], above: [], payload: null, isPublishable: false }

export const checkDraft = (draft: JsonRecord | null, basis: JsonRecord | null, release: string): DraftChecks => {
  if (draft === null) return NO_CHECKS
  const problems = fieldProblems(draft)
  const contract = checkContract(draft)
  const changes = diffConfig(basis, draft)
  const payload = contract.kind === "valid" ? contract.payload : null
  return {
    problems,
    refusals: contract.kind === "refused" ? contract.problems : [],
    changes,
    above: versionsAboveRelease(draft, release),
    payload,
    isPublishable: payload !== null && Object.keys(problems).length === 0 && changes.length > 0,
  }
}
