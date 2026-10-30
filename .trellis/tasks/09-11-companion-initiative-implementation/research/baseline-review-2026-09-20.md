# Formal review: pinned main / T4 baseline integration

Date: 2026-09-20. Reviewer scope: the interrupted baseline-integration quality gate only.

## Decision

The bounded automated baseline gate may pass after the root records the final source/preservation checkpoint.
The reviewed Memory/Run/Timeline/migration/Operations seams retain both branches' contracts. Two related
Operations recovery defects were fixed, with five added regression cases in existing test files. No remaining
blocking semantic finding was identified within this integration scope.

This decision does not certify an implemented Heartbeat child, subjective owner acceptance, a packaged native
UI trial, Hindsight first activation, or complete derived-memory freshness. No acceptance boxes, task pointers,
Git history/index, other worktrees, or runtime user data were changed by this reviewer.

## Scope and provenance

- Workspace/branch verified: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`, HEAD `06a8090`.
  Reviewed pin: `516e151ad1cbd298d07b95e7b4460833e55442f6`. The native parent binding governs this work.
- Inspected `baseline-snapshot-2026-09-19/manifest.json`, `preservation-check.json`, explicit hunk/semantic/
  compatibility/regression helpers and `check-*.json`: 634 incoming entries, 627 applied/seven protected metadata.
  Current source was then reviewed directly; the integration was not repeated and mutable main was not imported.
- Avatar outcome/renderer/Pet work remains independent and unchanged by this reviewer. Main has later independent
  dirty source/planning files; its complete working tree is not claimed unchanged. Root owns final preservation
  evidence, source fingerprints and the isolated Core boot check.

## Findings (fixed)

### 1. Subscription acknowledgement could be bypassed by the retained page

- File: `apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts:54`.
- Issue: only the initial subscription continuation waited for acknowledgement. The changed-push handler,
  deliberate refresh and newly integrated hide/show path called the status reader directly. An incoming push
  or re-entry while setup was pending therefore produced status reads before accepted membership. Setup errors
  also used `mutationSettled`, which could clear the presentation of an unrelated pending submit/cancel.
- Attribution: the incoming controller already permitted push/manual-read bypass and used mutation feedback for
  setup failure; the T4 retained-page adaptation introduced another reachable bypass through visibility re-entry.
  This is a compatibility defect in the combined reactive contract, not a new Memory authority requirement.
- Fix: all reads now pass through the same subscription-aware flight. Hints before acknowledgement are covered
  by one subsequent baseline; hints during the read retain one trailing obligation. Visibility/client generations
  still reject retired reads. Setup failure uses the read-error channel and waits for another demand, preserving
  the mutation lock/outcome. No poll, mutation replay or autonomous retry loop was added.
- Regression: `memory-operations-controller.test.ts:158` combines pending ACK, pushes, explicit refresh and
  hide/show; `:176` verifies failed setup causes no read or spontaneous retry, leaves a pending mutation alone,
  and recovers on deliberate refresh. Both tests failed against the pre-fix controller and now pass.

### 2. A failed Memory subscription permanently poisoned the same client

- File: `apps/desktop/src/lib/ws-client-memory-operations.ts:49`.
- Issue: rejected, malformed-ACK and timed-out `memory.operations.subscribe` promises remained cached forever.
  A page retry on the same socket returned the same rejection and could never restore live invalidations.
- Attribution: inherited from the pinned Stage 1 RPC wrapper. Unlike the T4 config/read-subscription wrappers,
  it had no failed-attempt eviction, making the imported family incompatible with same-client explicit recovery.
- Fix: keep sharing pending/accepted membership, but clear only the matching failed attempt before rethrowing.
  The existing native RPC timeout and request identity remain authoritative; a late old reply cannot replace
  the current attempt. Submission/cancellation and Avatar outcomes are untouched.
- Regression: existing actual `WsClient` transport tests now cover both config and Memory for refused ACK,
  malformed ACK (`ws-client.test.ts:748`) and lost ACK/late response (`:813`). They verify no spontaneous retry,
  one new request on explicit demand, and sharing of the accepted membership.

Specifications and inventories synchronized: `.trellis/spec/backend/memory-operations.md` Contracts, Error Matrix
and Tests Required sections,
`apps/desktop/src/lib/index.md`, and `apps/desktop/src/windows/home/pages/operations/index.md`.

## Semantic paths verified

| Contract | Current source and concrete coverage |
| --- | --- |
| Immutable provider/capability/epoch capture plus T4 names | `harness/run-snapshot-capture.ts:47` captures Memory once and freezes the same snapshot, tools, prompt, assembly and recall ports while retaining detached tool-display names. `run-snapshot-capture.test.ts` checks source mutation cannot replace them and private prompt content is absent from the persisted manifest. |
| Run duplicate/restoration authority | `harness/run-service.ts:124` keeps original executable context for a live duplicate, disposes unused captures, and compares provider/lineage/epoch/contract/capability digest plus capabilities on restoration. `run-service-memory-restore.test.ts` covers each drift refusal, matching restore and terminal idempotency. |
| Exact primary source with atomic foreground presentation | `agents/turn-recording.ts:34` returns the actual atomic writer rows; `chat-agent.ts:246` witnesses the exact user row plus that batch after commit, including exceptional/iterator-close partials. It excludes retracted and non-primary inputs. `chat-agent-baseline-integration.test.ts` interleaves an unrelated autonomous row, changes a live tool label, exercises later provider failure and iterator close, and verifies exact sequence/row identity, stable activity labels and presentation metadata. |
| Primary-only ephemeral recall | `chat-agent.ts:426` suppresses automatic recall for non-primary work. `chat-agent-memory-recall.test.ts` proves recall precedes measurement, is reused for overflow retry, and is absent from replay, ingestion, persistent tool records and maintenance source. Non-primary tests retain no conversational Timeline/image write or auto-memory callback. Thin initiative context itself remains child-1 work. |
| Supported migration histories | Registry `db/migrations/index-list.ts` has one ordered version through 048, canonical forward Pending 035, existing 036 and 040 convergence, and unchanged historical T4 035. The real-file reopen matrix preserves Timeline/presentation raw bytes, Pending JSON, sequence watermarks, old receipts, replica records/checkpoints/leases and authority markers. Fresh, 034, main-035, T4-035 and both-shapes histories reach 048 and reopen without further migration. |
| Unsupported migration refusal | `036-memory-timeline-convergence.test.ts` rejects incompatible presentation columns atomically. `040-hindsight-cutover-convergence.test.ts` covers exact known schemas, nonempty unmappable early imports, unknown/partial/weakened shapes and SQL/receipt/COMMIT failure rollback. No migration or initiative version was added by the reviewer. |
| Durable Memory operation ownership | `memory/operations/memory-operation-service.ts`, kind handlers and repo own single-flight admission/CAS, detached producer execution, cancellation and foreign-boot unknown settlement. `memory-operation-kind-replica.ts` keeps the existing scheduler and queued-request same-millisecond guard. Current operations/service/status/method tests verify producer settlement, refusal, cancellation, restart, unknown/null projections, operator roles and fan-out/close cleanup. |
| Live administrative status versus captured Run context | `memory/runtime-composition.ts` exposes separate `operations()` and `captureRun()` ports. The composite status remains administrative; `derivedFreshness` stays `unknown` and unavailable replica/Pending evidence stays null. No operation state was promoted to an Agent Run or readiness proof. |
| Composition, shutdown and WS coexistence | `main.ts:254,344,385,470` retains operation methods, captured Memory admission, exact primary ingestion, existing activity/Timeline and Avatar outcome registration. At `:548`, the runtime stops producer work before operation-owner drain. `ws-client-routes.ts:127` retires all current handler sets including Memory, activity and committed batches. New Memory wrappers coexist with command disclosure and Avatar reports under existing request deadlines. |
| Retained Operations UI | Existing hidden-read/mutation and render fixtures plus the added ACK/recovery cases retain prior content, suppress hidden reads/publication, preserve one mutation outcome, and keep operation/Bank/epoch IDs out of the added labels/tooltips. No new authority cache or polling source was introduced. |

Public Shared exports, registry composition and directory inventories were inspected with the changed seams and
verified by the full workspace typecheck and root lint. This integration changes no platform template, native
capability manifest or platform detection path, so no template synchronization was required.

## Verification

All commands ran from `H:/TakiAgent-worktrees/t4`. Reproducible command arrays, start times, durations and full logs
are under `research/baseline-snapshot-2026-09-19/`. Checks recorded here use the current combined source.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm -r typecheck` | PASS, all five workspace projects | `check-review-typecheck-final.json`, `logs/review-typecheck-final.log`; 2026-09-20 11:21:26 UTC |
| `pnpm lint` | PASS, root ESLint | `check-review-lint-final.json`, `logs/review-lint-final.log`; 2026-09-20 11:21:26 UTC |
| Desktop focused Vitest | PASS, 103 tests / 10 files | `check-review-desktop-final.json`, `logs/review-desktop-final.log` |
| Core focused Vitest | PASS, 106 tests / 16 files | `check-review-core.json`, `logs/review-core.log` |
| `pnpm --filter @taki/desktop build` | PASS after production fixes | `check-review-desktop-build.json`, `logs/review-desktop-build.log`; existing large-chunk/plugin-timing notices only |
| `git -c core.safecrlf=false diff --check` | PASS | Exit 0 with no output; the option only suppresses line-ending conversion warnings for this read-only invocation |
| Fresh isolated Core boot | PASS, root-owned check | `check-continuation-boot.json`; Legacy and Canonical Local, migrations 1-48, clean registered SIGINT shutdown, no provider calls |
| Rust/native build | Not rerun | No Rust source, Tauri capability or native build config changed in this bounded integration/review |

Focused commands (also stored verbatim as arrays in the JSON evidence):

```text
pnpm --filter @taki/desktop exec vitest run --maxWorkers=4 src/lib/ws-client.test.ts src/lib/rpc-deadline.test.ts src/windows/home/pages/operations src/windows/home/resource-state-pages.test.tsx src/windows/pet/restore-pet-connection.test.ts
pnpm --filter @taki/core exec vitest run --maxWorkers=4 src/agents/chat-agent-baseline-integration.test.ts src/agents/chat-agent-memory-recall.test.ts src/agents/chat-agent-canonical-memory.test.ts src/agents/chat-agent-non-primary.test.ts src/agents/chat-agent-tool-names.test.ts src/harness/run-snapshot-capture.test.ts src/harness/run-service-memory-restore.test.ts src/db/migrations/035-timeline-presentation.test.ts src/db/migrations/036-memory-timeline-convergence.test.ts src/db/migrations/040-hindsight-cutover-convergence.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/memory/operations src/server/methods/memory-operation-methods.test.ts src/server/methods/memory-authority-status.test.ts
```

The first review typecheck found a generic Vitest mock typing error in a newly drafted wrapper test. Those recovery
assertions were consolidated into the existing real `WsClient` transport tests instead of adding a type bypass;
the temporary test file was removed. Final typecheck, lint and focused tests all passed afterward. The failed
intermediate record is retained as `check-review-typecheck.json`, not presented as the final result.

The prior recovery run (`check-recovery-tests.json`, 2026-09-20 02:50-02:54 UTC) passed workspace tests and its
source freshness was audited by the root. It is not a post-fix full-suite rerun or owner acceptance; current
post-fix verification is the focused tests, workspace typecheck, root lint and Desktop build recorded above.

## Findings (not fixed) and remaining limits

- No unresolved blocking defect was found in the reviewed baseline reconciliation.
- Inherited main-D81 derived hidden/expiry propagation and D84 scheduler attribution/cancellation precision remain
  explicit limitations. Successful sync, zero Pending count and operation completion do not establish complete
  derived freshness or exact per-Run causality. They remain with their recorded owner; this review did not expand
  Memory transition scope.
- Real packaged WebView2 visibility/reconnect/reading continuity, live Hindsight/native-provider behavior and
  subjective owner trials were not executed here. Synthetic SDK/SQLite/client tests and a Vite build are labelled
  accordingly. The root's isolated zero-provider-call Core boot is process/lifetime evidence, not an actual model
  conversation or Hindsight activation trial.
- The final preservation/source fingerprint and baseline checklist update belong to the root. Only after that
  evidence is recorded should the existing child-1 runtime-foundation work be activated; none of its implementation
  or parent acceptance criteria is marked done by this report.
