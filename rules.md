# Repository rules

Binding on every agent and contributor working in this repository. These are not
style preferences; they encode failures this project has already paid for.

## 1. No comments in source code

Do not write comments in source files. This includes `//`, `/* */`, JSDoc blocks,
JSX `{/* */}`, HTML `<!-- -->`, and `#` comments in shell and config.

The reason is specific to how this codebase is built. It is written and modified
mostly by AI agents. An agent that changes code and leaves the comment beside it
untouched produces a file that states two different things, and the next agent
reads the comment as fact. A wrong comment is worse than no comment: it is a
confident, authoritative lie sitting next to the code it describes.

Consequences of this rule:

- Names carry the meaning. If a line needs explaining, extract it into a function
  whose name is the explanation, or a well-named constant.
- Intent that cannot live in a name belongs in a test. A test asserting the
  behaviour cannot silently drift from the code the way a comment can — it fails.
- Rationale for a decision belongs in the commit message or in `release_manager/docs/`,
  not next to the code.

Existing comments are not being removed in bulk. The rule is applied on contact:
**any file you touch, you leave without comments.** Do not strip comments from
files you are not otherwise changing — that produces large diffs with no
behavioural content and buries the real change.

Documentation and API comments will be added deliberately at the end, once the
system is built and stable. Until then, none.

## 2. No claiming verification you did not perform

A passing test suite is not proof that a feature works. This repository has
shipped, with a green suite:

- a button whose handler prop was never passed
- an optimistic-concurrency precondition sent from a stale snapshot
- mail recorded as `sent` by a transport that discarded it
- a chunk-splitting change that made the app die on launch with a temporal-dead-zone
  `ReferenceError`, blank screen, zero failing tests (v0.9.0)

State what was checked and by what means. If something needs a device, an
emulator, or the VPS to prove, say so and hand over the exact command instead of
implying it was confirmed.

## 3. Financial writes are never replayed automatically

Idempotent reads (GET) may be retried. A write is never retried by the app: it
cannot know whether the first attempt landed, and a duplicated payment,
redemption or mandate costs real money. Writes carry an `Idempotency-Key` so a
*user* can retry deliberately.

## 4. A failed read is never rendered as "there is nothing here"

An outage, a timeout and an empty collection must be visually distinct. `.catch(() => setItems([]))`
is forbidden — it tells someone their money, tickets or transactions do not exist.
Render an explicit error state with a retry.

## 5. Optimisation does not outrank booting

Bundle, byte and chunk optimisation is only worth doing when it cannot affect
correctness. Do not split a package into multiple chunks without proving the
chunk graph is acyclic — a cycle across a chunk boundary is a launch crash, and
it is invisible to unit tests. Bytes on the admin console are never worth a boot
risk on the app that holds customer money.

## 6. Local machine is for development and tests only

Typecheck, lint, one-shot builds, `vitest run` and read-only inspection are free.
Long-running processes, deployment, and anything touching the VPS require
explicit permission. Emulator and Gradle runs are permitted when the maintainer
asks for them; clean up everything started in the same session.
