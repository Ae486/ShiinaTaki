# Real-model memory harness review — 2026-11-06

## Findings (fixed)

- File: `research/first-use-runtime/real-model-memory.mjs`, `smoke-native.mjs`
- Issue: The first live attempt exposed Windows proxy discovery in Native; earlier source review also found that the owned root was not printed before boot, failed stage evidence could be lost, and an admission stop could interfere with already admitted work.
- Fix: Current source prints the owned root before startup, preserves failed operation/turn timing and error codes, applies limits only before a new scenario, gives live boot/shutdown their approved observation budgets, and supplies model-host/loopback `NO_PROXY` while retaining the socket guard. These fixes were made by the owning implementer/root, not by this read-only reviewer.

## Findings at review time (subsequently repaired)

Root resolution: current source was read back after the implementer corrections. `pendingDrained` now requires
nonempty projections, records each summary and separately refuses failed/unknown outcomes. Actual new retain
requests are joined to completed receipts and Native child documents. `nativeReturnedModels` is separate from
the explicitly unknown Core returned identity. Syntax/self-checks pass; complete real Hindsight execution is
still unverified because the later network path failed. The findings below preserve their original rationale.

### P1 — failed or unknown Pending rows can be reported as drained

- File: `research/first-use-runtime/real-model-memory.mjs:226`
- Issue: `pendingDrained()` checks only `summary.pendingCount` and `parentWritesPending`. The public summary also has `failedCount` and `unknownCount`, and the production recovery gate treats all three as unresolved. A Hindsight retain can therefore finish as failed/unknown while the harness proceeds. The study recall can still find the earlier Local source after activation, so that case can conceal failure of the later Hindsight study retain.
- Smallest repair: Require a non-empty Hindsight Bank projection and zero `pendingCount`, `failedCount`, `unknownCount`, and `parentWritesPending` for every Bank. Preserve the final observed summaries in content-free stage evidence. For an already-running attempt, independently verify these fields before accepting its result.

### P2 — `model.returned` is not a truthful cross-role returned identity

- File: `research/first-use-runtime/real-model-memory.mjs:364`
- Issue: Core's transparent stream observer never records a returned model identity, while Native's consumed JSON response does. The aggregate `model.returned` therefore contains Native identities but can be read as covering main and utility too.
- Smallest repair: Report role-specific requested identities, rename the current set to `nativeReturnedModels`, and state that Core main/utility returned identity is unknown because their streams were intentionally not parsed or buffered.

## Acceptance limits

- The actual Core entrypoint, Native launcher, owned PostgreSQL, registered operations and production `openai` adapter are used. Source success requires real Core main/utility HTTP completion, Native extraction HTTP completion plus completed work, and real local embedding/reranker initialization and inference; no mock fallback was found.
- Private dialogue is read only from the authorized fixture, injected only as quoted historical evidence, and omitted from result/stage evidence. Keys stay in process environment. Cleanup deletion is restricted to exact harness-owned PostgreSQL paths.
- The 60-minute value is an admission threshold, not a hard total wall-clock deadline: already admitted work may settle for its remaining 900-second observation allowance, followed by bounded shutdown. Report actual `durationMs`; do not describe `outerObservationMs` as a hard runtime cap.
- Core timing preserves request start, headers, first chunk and complete consumed-stream time. Native OpenAI-compatible calls are non-streaming in the production adapter, so their HTTP duration is a complete response duration. Overlapping spans must be unioned per stage; the remainder is only time outside observed upstream spans, not memory CPU time.
- This six-turn stage does not test fault/restart recovery, Native consolidation, vision, UI, original-data activation or semantic quality beyond the stated source/fact predicates. Those are not inferred from a pass.

## Verification

- Lint: not run — root explicitly reserved the live slot and requested read-only review.
- TypeCheck: not run — task-only JavaScript/Python harness review only.
- Tests: not run — no services/tests/models were authorized for this reviewer.
- Static review: completed against the plan, PRD/check context, production timeline/pending contracts, and the current four harness files.
