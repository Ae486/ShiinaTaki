# C4 formal scoped review — 2026-09-28

## Scope and source boundary

Reviewed in `H:/TakiAgent-worktrees/t4` on `task/t4-skills-mcp-productization`. The read-only resolver with
`TRELLIS_CONTEXT_ID=codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167` returned this C4 task. The legacy global
`.trellis/.current-task` still names archived Avatar Lab work; it was not changed. The child PRD/design/implementation
plan, curated check context, parent normative design and Memory integration reports were read.

Primary scope: Core Wake production files, `initiative-runtime.ts`, `pattern-composition.ts`, captured Run snapshot,
backoff RPC and finite-window config. The integration owner expanded scope to the Intention lifecycle fix below.
Cross-layer inspection included the actual Main wiring, Shared contracts, governed tool assembly, selected Memory
recall/source lifetime and Desktop backoff subscriptions. Existing concurrent work was preserved. This review made
no commit, push, reset, rebase, archive, paid request or native/full-suite run.

## Findings fixed

### 1. Completed expression left its Intention claimed

- File: `packages/core/src/initiative/intentions/intention-lifecycle.ts`.
- Issue: the canonical DeliveryCoordinator completes an expression's executable continuation and Run, but there is
  no speech publication for that outcome. Its delivery row remains `staged`. The Intention reconciler interpreted
  every completed non-silent staged row as pending speech, retaining the claim/purpose until expiry.
- Fix: read the canonical continuation and consume `express` when both the Run and presentation continuation are
  completed. Staged/held speech still retains its original currentness fence while waiting for publication.
- Regression: real Run/Delivery repositories demonstrate staged + completed-continuation + completed-Run, terminal
  expression disposition, removed prospective purpose, restart stability and no replay from the same primary source.
  Existing silence/held speech regression remains green. The new assertion failed as `claimed` before this fix.

### 2. New backoff reasons broke the old strict Monitor decoder

- File: `packages/core/src/initiative/wake/wake-policy-repo.ts`.
- Issue: adding `backoff-spacing` and `backoff-daily` to today's Shared enum does not update a C3 client's strict
  `observability.initiative-policy` decoder. The unchanged RPC emitted those new values in recent rows and counters.
- Fix: retain detailed durable reasons, but project this existing RPC through `model-cadence`/`model-budget`.
  Preserve every recent row, order and cursor; sum counters that map to the same compatible reason. The separate
  backoff RPC still exposes the exact current stage and refusal. No canonical event or stored diagnostic is rewritten.
- Regression: `wake-policy-compatibility.test.ts` freezes the C3 decoder vocabulary independently of today's superset,
  checks successful decoding, all five diagnostic rows, merged 3/2 counts, identical restart reads and unchanged stored
  details. Before the fix it failed on the new reason values.

### 3. New admission did not invalidate the separate backoff view

- File: `packages/core/src/initiative/pattern-composition.ts`.
- Issue: Desktop's backoff controller subscribes only to `observability.initiative-backoff-changed`. The previous
  composition notified feedback/reset changes but not admission, leaving an open view's daily usage and eligibility
  stale after a silent or otherwise newly admitted judgment.
- Fix: consume the actual committed `run.admitted` producer, verify its canonical Run is Heartbeat/Class B, and send
  the separate bounded Character invalidation. An admission notification does not request another Wake. Feedback
  still comes only from `delivery.feedback_settled`.
- Verification boundary: lint/type compatibility and producer/consumer paths were inspected. The integration owner
  assigned the actual automatic-admission notification assertion to the process/E2E gate; this report does not label
  that pending process assertion passed.

### 4. Executable documentation still described an empty C4 source

- Files: `.trellis/spec/backend/interaction-patterns.md`, `initiative-intentions.md`, `initiative-backoff.md`, and
  affected Wake/Intention directory indexes.
- Fix: document actual standalone finite Intention adaptation, expression consumption, compatible old policy
  projection and separate admission-driven backoff invalidation. Remove the stale claim that the source is empty.

## Verified contracts and additional regressions

- Standalone due plans become Intention candidates without inserting Patterns. Their claim and canonical key are
  linked before model work. Own claimed source projections remain current during held speech; unrelated claims do not.
- Exact source/deadline checks apply after context preparation and before model intent/decision/publication. Proven
  withdrawal closes a source; temporary unavailability suppresses work while preserving the original finite window.
- Known no-Run refusal releases the Intention and Wake claims without changing their original window. Lost admission
  callbacks repair against the canonical key. Terminal silence/failure and restart do not create replacement Runs.
- Event-only future due work uses the common finite Wake timer. The integration owner added and passed the separate
  unavailable-to-current timer case without another source notification; this reviewer inspected its actual assertions.
- Backoff gates only pre-admission work; it is absent from a Run's continuing source/currentness and delivery gate.
  `onAdmitted` runs only for `reused=false`. Added C1 tests verify pre-Run refusal, released unused reservation,
  linkage failure before any model Effect, and a reused Run retaining unknown admission timezone without callback.
- Qualified feedback is read from C2's durable `weak_non_engagement` producer. Actual same-Character persisted user
  rows and explicit operator reset fence old invitations without resetting hard budgets or modifying Memory.
- Actual C2 producer and event bridge preserve distinct presentation and opportunity/feedback facts. A successful
  transport callback, frontend report or test stub is not evidence of reading or real-world matter resolution.

## Narrowed Memory cross-layer review

The completed Memory report is `memory-integration-implementation.md`; its author owns the provider/source tests.
This reviewer verified the following actual consumer/provider seams, without re-running that author's entire matrix:

- Main passes `memoryRuntime.sourceState` to the finite Intention service. The read adapter validates the original
  SQL-row digest, exact primary commit/span proof and selected authority. Proven receipt/source/unit/policy changes
  withdraw use; unavailable evidence cannot create a new provider or source. A legitimate pre-ingestion user row
  remains distinct from confirmed associated Memory.
- The selected builder requests only chosen global/current-Character fragments and candidate-derived topic. Its
  original assembly capture participates in `contextIsCurrent`; selected Persona/Blocks/index changes retire it.
- `run-snapshot-capture.ts` constructs one recall wrapper for the immutable Run context. The existing ChatAgent
  governance wrapper and restrictive initiative profile remain in the executable path. Model input exposes scope
  only; query and Banks remain captured. No reflect/automatic recall/extra extraction pass is introduced.
- The wrapper counts one attempt per selected Bank before dispatch, including failure; retries reuse the captured
  object. It limits four records and the final fenced model projection to the existing 512-token estimator budget.
  Unconfirmed/unsupported records are not relabeled as facts; partial/degraded/unavailable states remain explicit.
- Provider selection captures original receipt/source/unit/policy evidence before asynchronous returns. The Run
  authority closure combines exact evidence checks with source/target/primary/timezone/deadline fences and survives
  held delivery without replacement authority, Bank recapture or semantic re-query.
- No additional confirmed defect was found in these narrowed Memory consumer seams. Undetected remote changes
  during complete disconnection, estimator-versus-provider tokenization, and D81 opaque derived-source closure are
  explicit existing limitations, not claimed solved by this review.

## Verification evidence

Commands executed from the T4 root:

```text
pnpm --filter @taki/core test -- src/initiative/intentions/intention-service.test.ts src/initiative/wake/wake-policy-compatibility.test.ts
# Final: 2 files / 27 tests passed after both concrete defects were reproduced.

pnpm --filter @taki/core test -- src/initiative/wake src/initiative/initiative-runtime.test.ts src/harness/run-snapshot-capture.test.ts src/initiative/backoff src/initiative/intentions/intention-service.test.ts
# Final: 8 files / 111 tests passed, Vitest 4.1.10, 2026-09-28 21:03:52 local start.

pnpm --filter @taki/core typecheck
# Passed, including the final rerun after the admission-notification change.

pnpm exec eslint packages/core/src/initiative/wake packages/core/src/initiative/initiative-runtime.ts packages/core/src/initiative/initiative-runtime.test.ts packages/core/src/initiative/pattern-composition.ts packages/core/src/harness/run-snapshot-capture.ts packages/core/src/server/methods/initiative-backoff-methods.ts packages/core/src/config/initiative-intention-config.ts packages/core/src/initiative/intentions/intention-lifecycle.ts packages/core/src/initiative/intentions/intention-service.test.ts
# Passed. Final composition admission-notification edit also passed a separate scoped lint rerun.

git diff --check -- packages/core/src/initiative packages/core/src/harness/run-snapshot-capture.ts packages/core/src/server/methods/initiative-backoff-methods.ts packages/core/src/config/initiative-intention-config.ts .trellis/spec/backend/initiative-intentions.md .trellis/spec/backend/initiative-backoff.md .trellis/spec/backend/interaction-patterns.md
# Passed; Git emitted its ordinary CRLF-normalization notice for run-snapshot-capture.ts.

python .trellis/scripts/task.py validate .trellis/tasks/09-11-initiative-intentions-acceptance
# Passed: 12 implement-context entries and 13 check-context entries.
```

One initial added admission test incorrectly expected unused reservations to be deleted. Inspection confirmed the
existing owner intentionally retains a `released`, unlinked, uncharged reservation; the assertion was corrected.
This was a test expectation issue, not an additional production defect. The final scoped run above was all green.
Untracked files are not covered by `git diff --check`; the new regression/report were reviewed directly.
An explicit byte/text check over the reviewer's changed code and report also passed: no UTF-8 BOM or trailing whitespace.

## Findings not fixed / acceptance boundary

No known remaining verified code defect is left within this review's assigned scope. The integration owner still
owns the admission-notification process assertion, complete workspace regression/build gate, actual process recovery,
real-provider calls and native multi-window evidence. Source inspection and these scoped tests do not mark any owner
AC passed. Product quality and actual human reading cannot be inferred from protocol ACKs or mocked presentation.

The Memory author's report records a separate historical test-fixture incident: an earlier whole-write restart test
created and cleaned its owned temporary directory under `H:/TakiAgent/.trellis/.runtime`. That fixture was corrected
to the isolated system temp directory with resolved-parent/prefix cleanup checks. This reviewer did not run the
affected test. The combined delivery must retain that disclosure and must not claim every prior test wrote only in T4.

## Follow-up: actual provider batch exposed premature unknown disposition

The integration owner's subsequent first real-provider batch exposed an additional definite issue after the scoped
review above. In both `validation/real-llm-round1-2026-09-28/finite-1.json` and `finite-2.json`, the exact finite plan
was created, one Heartbeat Run completed and its speech delivery reached `sent`, but the Intention had already
closed as `unknown`. The assertions were retained; this report's earlier no-known-defect statement described the
earlier review snapshot, not successful complete acceptance.

- File: `packages/core/src/initiative/intentions/intention-lifecycle.ts`.
- Cause: production's committed-event observer runs at `delivery.dispatch_committed`, before the asynchronous
  transport result. The reconciler treated that intermediate live state like an acknowledgement lost on restart,
  permanently closing the Intention before the later `delivery.sent` event. Earlier tests checked final state
  without this live callback ordering, so they missed the premature transition.
- Fix: normal in-process reconciliation retains the original claim for `dispatch_committed`. The existing sender's
  final `sent`/`unknown` fact settles it. Explicit restart reconciliation still closes an unresolved dispatch as
  `unknown`, and canonical publication/charge remain immutable. No Run, utterance or source opportunity is reopened.
- Regression: `intention-delivery-events.test.ts` uses actual Run and Delivery repositories, their live committed
  event bus, DeliveryCoordinator and TimelineSubscriptions. A deferred observed-transport result establishes the
  intermediate callback order. The old code failed all three new cases by closing at commitment. After the fix,
  accepted send consumes `speak`, actual uncertain send consumes `unknown`, and a lost acknowledgement on restart
  stays unknown with the same Run/Attempt/Timeline/charge and no publication replay or refund.
- This is transport disposition evidence, not proof of rendering or reading.

```text
pnpm --filter @taki/core test -- src/initiative/intentions/intention-delivery-events.test.ts src/initiative/intentions/intention-service.test.ts src/harness/initiative-recovery.test.ts src/initiative/wake/wake-intention.integration.test.ts
# Passed: 4 files / 52 tests; 2026-09-28 21:51:01 local start.

pnpm exec eslint packages/core/src/initiative/intentions/intention-lifecycle.ts packages/core/src/initiative/intentions/intention-delivery-events.test.ts
# Passed.

pnpm --filter @taki/core typecheck
# Passed after the follow-up production fix.
```

The production fix was handed back as stable for the integration owner's real-provider rerun. That rerun and its
actual results remain separate evidence; this follow-up does not turn the failed first batch into a pass.
