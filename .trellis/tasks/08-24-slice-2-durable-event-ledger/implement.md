# Slice 2 Durable Event Ledger Implementation Plan

This plan is executable only after the Slice 2 child is reviewed and explicitly activated. It does not authorize
production implementation while the task remains in `planning`.

## 1. Preparation and Context

1. Recheck `H:/TakiAgent-worktrees/t4`, branch, parent/child task binding, current HEAD, migration registry, and dirty
   files. Do not touch `H:/TakiAgent` or `H:/hindsight`.
2. Read this child PRD/design, the archived Slice 1 implementation evidence, parent Phase C/D/G research,
   `docs/ARCHITECTURE-ROADMAP.md`, `docs/T4-HANDOFF.md`, and the backend database/error/logging specs.
3. Confirm the event taxonomy and migration number against the live registry immediately before editing. Never reserve a
   migration number only in this document.
4. Use existing PI/DSH research as the source of architecture decisions. If a concrete code location is unknown, use
   one focused `jbcontext search` from this worktree, then direct reads and exact `rg`; YCE is disabled.

## 2. Implementation Order

### Step 1 - Freeze shared event contracts

- Add bounded Zod schemas/types for event category/kind, envelope, cursor, query/replay result, and the minimal live
  subscription payload if a WS seam is required.
- Implement payloads as a closed discriminated union keyed by event kind; do not expose an arbitrary
  `Record<string, unknown>` payload escape hatch.
- Add a narrow projection contract for readable trajectory summaries and an explicit developer-inspector detail result;
  ordinary summaries must not expose opaque IDs, hashes, digests, generations, or revisions.
- Add schema/projection tests for sequence bounds, identity containment, timestamps, payload limits, unknown kinds,
  secret/raw payload refusal, `current`/`shadowed`/`log-only` classification, and mode-dependent detail availability.

### Step 2 - Allocate migration and event repository

- Recheck all known migration histories and allocate the next free version after Slice 1.
- Add an additive `run_events` table with immutable event columns, `UNIQUE(run_id, seq)`, indexes for `(run_id, seq)` and
  authorized lineage filters, and bounded payload storage.
- Add one typed repository for append/read-by-cursor/replay. Rows are zod-parsed at the boundary and never updated or
  deleted by normal lifecycle code.
- Add fresh, historical, reopen/no-op, and migration-failure tests.

### Step 3 - Couple Run transitions to durable events

- Refactor the Slice 1 Run transition boundary so admission, start, retry, cancel request, and settlement write their
  event facts inside the same synchronous SQLite transaction as the current-state mutation.
- Follow the exact event mapping in `design.md`: new admission emits `run.admitted` + `attempt.prepared`; start emits
  `run.started` + `attempt.started`; retry emits old `attempt.settled` + replacement `attempt.started`; cancellation
  emits `run.cancel_requested`; terminal settlement emits `attempt.settled` + `run.settled`.
- Preserve idempotent admission, CAS state versions, terminal settlement guards, stale callback behavior, Receipt
  semantics, and current Run recovery authority.
- Ensure duplicate idempotent admission does not append duplicate evidence, and event-write failure rolls back state.
- Add transition-to-event mapping tests and exact sequence assertions.

### Step 4 - Add post-commit live plane

- Implement a Core-owned in-process event bus with per-Run filtered subscriptions, bounded queue/lag signaling,
  exact-once disposal, and observer exception isolation.
- Publish only after the SQLite transaction commits. Do not await observers or let them write Run state.
- Add cursor/backfill handling so reconnecting consumers can read durable gaps before live delivery.
- Leave Character-lineage aggregation to a later projection/query task that defines a multi-Run cursor and ordering
  contract; do not merge independent per-Run cursors here.
- If a WS method is necessary for the narrow projection seam, keep it operator-only, redacted, bounded, and UI-neutral.
  The default client surface has no monitor page; a future monitor must consume presentation summaries rather than raw
  event/database columns.

### Step 5 - Add replay/projection rebuild anchor

- Implement deterministic event replay and a small lifecycle projection used only by tests/future projection code.
- Prove replay from zero and replay after a cursor produce the same state; prove a process restart does not require live
  delivery for correctness.
- Keep the existing `run_receipts` projection and Run status query compatible; do not introduce a second receipt store.

### Step 6 - Documentation and integration closure

- Update `packages/core/src/db/index.md`, `packages/shared/src/index.md`, and any touched server/harness index files.
- Update backend executable specs only if implementation evidence changes a contract; record any new deferral in
  `docs/deferred-decisions.md` with a trigger.
- Update the parent roadmap/HANDOFF only when implementation evidence changes the adopted sequence, authority, privacy,
  or future-slice seam.

## 3. Verification Gates

### Focused gates

- Shared event schema tests and Core event repository tests.
- Migration fresh/historical/reopen lineage tests, including the synchronized Hindsight baseline.
- Atomic transition tests: state/event commit together; injected event failure rolls back both.
- Sequence uniqueness/contiguity, duplicate/late callback, stale-version, terminal settlement, and idempotency tests.
- Redaction/privacy tests covering prompts, credentials, raw effect payloads, sensor/media, and provider exceptions.
- Layering and projection tests covering ledger availability with detail tracing disabled, `FEEDBACK_ONLY`/`FULL_LOCAL`
  behavior, readable summaries, inspector-only technical metadata, and DSH-like surface classification.
- Live bus tests for post-commit ordering, cursor backfill, observer failure, queue overflow, unsubscribe, and restart.
- Replay/projection rebuild tests and existing Slice 1 primary/non-primary regression suite.

### Required package checks

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared exec vitest run
pnpm --filter @taki/core exec vitest run
pnpm lint
git diff --check
```

Before handoff, rerun the backend quality gate from the current worktree and a real isolated Core boot. Manual monitor UI
acceptance is out of scope for this child.

## 4. Delegation Contract

At most one implementation agent and one check agent may be used for this child. Every prompt must be in English, start
with `Active task: .trellis/tasks/08-24-slice-2-durable-event-ledger`, state owned files, cite the PRD/design/specs,
and report `completed`, `incomplete`, `unverified`, `extra changes`, and `residual risk`.

Every delegated prompt must include:

```text
YCE is disabled and must not be used.
Use jbcontext for semantic code search, then direct reads and rg for exact follow-up.
Do not spawn child agents.
Do not commit, push, reset, rebase, or archive.
```

Use high effort for implementation and xhigh effort for check/explore if delegation is authorized. Do not interrupt a
healthy delegated run; wait in the required ten-minute cadence.

## 5. Stop Conditions and Rollback

- Stop if migration lineage or event sequence authority is ambiguous, or if a provider-specific payload leaks into the
  shared event contract.
- Stop if a transition would require awaiting inside `db.transaction`, publishing before commit, or making live delivery
  authoritative.
- Stop if event integration changes primary Timeline/Replay, Memory, Approval, Host, or Pino ownership without an
  explicitly updated contract.
- Stop if redaction cannot be enforced before persistence or if observer failure can affect Run correctness.
- Roll back by reverting only child-owned source/schema/docs changes; preserve additive migration data and never use a
  destructive database or Git reset.

## 6. Delivery Boundary

The child is complete only when the durable event ledger, post-commit live seam, and replay anchor are proven without
claiming full monitor UI, third-party export, effect integration, recovery worker, Scheduler, Heartbeat, or Child Run
implementation.
