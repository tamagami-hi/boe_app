import { formatDateTime } from "~/domain/dates"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_SM } from "~/ui/recipes/layout"

import type { ErasureCheck, ErasureOutcome, ErasurePath } from "./erasureQueries"

type KeptBecause = ErasureCheck["keptBecause"]

const KEPT_TEXT =
  "The account and its money history stay as a record. Their name, every email address and phone number, including the contact history, and the nominee are removed from every record. The account is closed, every session and link stops working, and queued emails are cancelled. The email and phone can then be used for a new sign-up or a new client."

const DELETED_TEXT =
  "Every record of the client is deleted in one step: the account, its contacts and contact history, invites and links, verification codes, sessions, notifications, support tickets, reviews, emails and the audit entries about them. One audit entry of the erasure itself stays, with the administrator and the time and no personal details."

export const pathTitle = (path: ErasurePath): string =>
  path === "deleted" ? "Deleted completely" : "Kept as a record without contact details"

const reasonText = (path: ErasurePath, keptBecause: KeptBecause): string => {
  if (path === "deleted") return "This client never completed email verification and has no money records."
  if (keptBecause === "money_records") {
    return "This client never completed email verification, but money was recorded for them. Money records are never deleted, so the account is kept as a record."
  }
  return "This client completed email verification, so the account is kept as a record."
}

const PathOutcome = ({
  title,
  applies,
  text,
}: Readonly<{ title: string; applies: boolean; text: string }>): React.ReactElement => (
  <p className={PROSE_SM}>
    <strong>{applies ? `${title} (applies).` : `${title}.`}</strong> {text}
  </p>
)

export const ErasurePathExplainer = ({
  path,
  keptBecause,
}: Readonly<{ path: ErasurePath; keptBecause: KeptBecause }>): React.ReactElement => (
  <div className={STACK_SM}>
    <p className={PROSE_SM}>{`${reasonText(path, keptBecause)} Erasing it means: ${pathTitle(path).toLowerCase()}.`}</p>
    <PathOutcome title="Kept as a record" applies={path === "kept_as_record"} text={KEPT_TEXT} />
    <PathOutcome title="Deleted completely" applies={path === "deleted"} text={DELETED_TEXT} />
    <p className={PROSE_SM}>This cannot be undone.</p>
  </div>
)

export const ErasureBlockers = ({ blockers }: Readonly<{ blockers: ErasureCheck["blockers"] }>): React.ReactElement => (
  <Alert tone="warning" title="This client cannot be erased yet">
    <ul className={STACK_SM}>
      {blockers.map((blocker) => (
        <li key={blocker.code} className={PROSE_SM}>
          {blocker.message}
        </li>
      ))}
    </ul>
  </Alert>
)

const nextLinks = (userId: string, path: ErasurePath): React.ReactElement => (
  <span className={ACTION_ROW}>
    {path === "kept_as_record" ? (
      <ButtonLink to={`/users/${userId}`} tone="secondary" size="sm">
        Open the kept record
      </ButtonLink>
    ) : null}
    <ButtonLink to="/users" tone="secondary" size="sm">
      Back to users
    </ButtonLink>
  </span>
)

export const ErasureResult = ({ outcome }: Readonly<{ outcome: ErasureOutcome }>): React.ReactElement => (
  <Alert
    tone={outcome.outcome === "erased" ? "success" : "info"}
    title={outcome.outcome === "erased" ? `Client erased: ${pathTitle(outcome.path).toLowerCase()}` : "This client was already erased"}
    action={nextLinks(outcome.userId, outcome.path)}
  >
    {`${reasonText(outcome.path, outcome.keptBecause)} ${pathTitle(outcome.path)} on ${formatDateTime(outcome.erasedAt)}.`}
  </Alert>
)

export const AlreadyErased = ({ check }: Readonly<{ check: ErasureCheck }>): React.ReactElement => (
  <Alert tone="info" title="This client was already erased" action={nextLinks(check.userId, check.path)}>
    {`${pathTitle(check.path)}${check.erasedAt === null ? "" : ` on ${formatDateTime(check.erasedAt)}`}. Nothing more to do.`}
  </Alert>
)
