# C2 formal integration review — 2026-09-28

## Scope and authority

- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- Effective task: `09-11-initiative-presence-feedback`, explicitly assigned by the root agent and confirmed through its native session binding. The stale global `.current-task` remains untouched.
- Authority: current C2 PRD/design/implementation plan; parent design and domain/presence research; effective decision register; backend/frontend executable specs. Historical source line references are orientation aids, not current implementation evidence.
- The supplied `H:/TakiAgent-worktrees/T4-heartbeat-child1-findings-2026-09-25.md` was read as a fallible reference only. No other worktree implementation was inspected or copied. Its migration numbers and old test totals were not treated as current facts.
- This review distinguishes C2 additions from the pre-existing integrated dirty tree. It does not re-review or claim ownership of the entire Git diff.
- No commit, push, task closure, archive, or manual acceptance was performed.

## Cross-layer review

| Boundary | Evidence and assessment |
| --- | --- |
| Authenticated source ownership | Shared reports are closed and bounded. `presence-methods.ts` requires a live operator connection and retires the malformed caller. `presence-sources.ts` binds the source to the actual connection/authentication object and device, with source/surface/sequence/age validation. Home, Chat and Pet have independent socket owners. |
| Input and sampling | Direct input retains an input sequence and elapsed age. Visibility, focus, renewal, restart and reconnect do not create input. Accepted native evidence retains nullable idle, consent epoch and actual routed Host provenance; it cannot establish an invented Node/operator-device association. |
| Committed content | `validMessage` requires existing nonblank assistant Timeline content for the exact Character/sequence. C1 delivery publication provides that ordinary row. Chat reports beneath resolved Markdown content; Pet consumes ordinary committed Timeline through its own presentation owner. Synthetic transport receipt is not reading evidence. |
| Response eligibility | `syncPublished` selects actually published Class B `speak` decisions with structural `responseExpectation=invitation`. Class A and non-inviting speech can be presented without receiving fabricated opportunity measurements. |
| Observed intervals | Source and exposure evidence are ephemeral; durable feedback contains bounded union intervals and a capped aggregate written together. Same-device overlap is required, cross-window overlap counts once, and unknown gaps cannot be inferred from the scheduler. The rate-limit finding below exposed a missing negative-transition boundary. |
| Durable primary reply | `main.ts` registers `observeEntry` after ordinary Timeline append. The callback only considers real user rows. The feedback repository verifies a later same-Character sequence and its stored time before the deadline. Maintenance reconciles a missed callback from the same durable rows. |
| Required event atomicity | `presence-event-bridge.ts` appends required v2 facts within the feedback transaction and publishes only the exact committed fact objects afterward. Failure does not leak a rolled-back live event. Observer failure cannot reverse a commit. |
| Monitor compatibility | The existing Run/Event ledger, bounded query service and live bus carry both v1 and v2 records. Projection emits supported semantic rows without inventing closed legacy event kinds. Inspector retains real opportunity/disposition facts and explicitly separates presentation from reading. |
| No new execution authority | Presence composition owns a bounded maintenance timer and report methods only. Reports do not admit a Run, call a model, run a Capability, alter hard initiative quotas, or replay an autonomous opportunity. |
| Timezone | Existing singleton/CAS authority and explicit connection-bound report claim are retained. Production `connect` rejects a second handshake on an authenticated socket, so direct test-only reauthentication is not an external timezone token bypass. Follow-device reporting does not imply Host availability or Presence. |
| Consent invalidation | Root's synchronous `PerceptionChanges.batch` contains activity/evidence/pause notifications after the durable consent update, then publishes the final projection once. Nested depth and deadline epochs remain bounded. No new sampling or model work is introduced. |

## Findings and changes

### F1 — Hidden evidence could survive an exhausted report allowance

- Severity: correctness blocker for C2 response-opportunity evidence until fixed.
- Files: `packages/core/src/presence/presence-service.ts`, `presence-sources.ts`; RPC regression in `packages/core/src/server/methods/presence-methods.test.ts`.
- Reproduction: open a source, report fresh input and exposed committed text, consume its 128-report burst, report the text hidden at the same observed instant, then show it five seconds later while the old lease remains valid.
- Confirmed result before correction: the RPC regression expected `opportunity_ms=0`, but SQLite stored `5000`. Rate limiting had rejected the negative report without ending the old exposure; the later positive report confirmed the hidden interval.
- Ownership: the reviewer added the real method-registry/composition regression; the assigned Core owner is correcting authenticated negative-transition handling without weakening identity/sequence/age checks or letting a hidden report add fresh input.
- Correction: valid closure of an existing exposure, a visible-to-hidden source transition, and retirement may bypass the positive-report token bucket only after authentication/source/sequence/observation-age validation. The quota exception discards attached input instead of admitting new presence evidence.
- Status: corrected by the Core owner; the reviewer's original RPC reproduction now passes. Subsequent independent failure isolation is tracked in F4.

### F2 — React lifecycle replay conflicted with one source per connection

- Files: `apps/desktop/src/features/presence/use-surface-presence.ts` and its lifecycle owner.
- Confirmed from actual entrypoints: Home and Pet mount under `StrictMode`. The original effect cleanup sent `retired`; repeated setup created a different source on the same `WsClient`. Core correctly refused it because one connection cannot acquire a replacement source lifetime.
- Ownership: coordinated with the Desktop owner. The correction retains a client-owned source across effect detach/reattach, immediately closes detached visibility/exposure, and reserves terminal source retirement for actual client/page lifetime retirement.
- Correction: `surface-presence-lifetime.ts` stores one owner in a `WsClient`-keyed `WeakMap`. Reference-counted detach stops local listeners/renewals and closes visibility without retiring the source. Reattachment first publishes unknown self-window state, then activates the same source. Client close/page retirement is terminal.
- Status: corrected by the Desktop owner and inspected by the reviewer; framework-free lifetime tests cover setup/cleanup/setup, later remount, multiple owners and closed-client refusal. Actual native StrictMode evidence remains a separate gate. No Core contract relaxation was made.

### F3 — Missing production maintenance regression for failed primary feedback writes

- File: `packages/core/src/server/methods/presence-methods.test.ts`.
- Fix: added an integration test using the real SQLite repositories, method registry, presence composition, required-event bridge, live bus and production maintenance timer.
- The test rejects `delivery.feedback_settled` through a SQLite trigger, proves the durable user append remains intact and the callback does not throw, verifies state/event rollback with no phantom live fact, removes the fault, and advances the actual 15-second timer. Maintenance recovers exactly one `engaged` fact without replaying the append or callback.
- Result: passed. This closes a coverage gap; the reviewed production catch/reconciliation behavior was already correct.

### F4 — Durable maintenance failure could prevent ephemeral exposure closure

- Severity: correctness blocker for C2 response-opportunity evidence until fixed.
- Files: `packages/core/src/presence/presence-service.ts`; RPC regression in `packages/core/src/server/methods/presence-methods.test.ts`.
- Reproduction: expose an existing invitation, publish a second invitation, and use a SQLite trigger to reject that second invitation's pending feedback insert. The first invitation's valid hidden report then fails inside `state.settle()` before its old exposure is deleted. Remove the trigger and show the first invitation five seconds later.
- Confirmed result before correction: the RPC regression expected `opportunity_ms=0`, but SQLite again stored `5000`; unrelated durable maintenance failure had preserved a bridge across a real hidden interval.
- Correction: the Core owner moved valid source/exposure closure and sequence advancement before `settle`/`confirm`. Durable failures still propagate, but cannot retain a hidden exposure. Negative source transitions discard attached input independently of its freshness; authentication, source, report sequence and observed age still gate the closure.
- Related boundary: an invalid attached input must not override an otherwise current, authenticated hide/retire envelope; it cannot establish fresh input, while stale/reordered envelope facts must not retire newer truth.
- Status: corrected and independently rechecked; the trigger-backed RPC regression passes, as do the service-level surface hide/retire and same-device evidence cases.

## Verification at this checkpoint

| Command / evidence | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/server/methods/presence-methods.test.ts src/observability/observability-query-service.test.ts src/initiative/initiative-composition.test.ts src/server/method-registry.test.ts` | 3 existing test files, 23 tests passed before F1 was added. The supplied initiative-composition path matched no test file and is not counted as coverage. |
| `pnpm --filter @taki/core exec vitest run src/server/methods/presence-methods.test.ts` after F1 | The original F1 reproduction failed with actual 5000 vs expected 0, then passed after the Core correction. |
| The same RPC file after adding F4 | Before correction: 6 tests, 5 passed; F4 failed with actual 5000 vs expected 0. The final rerun below is green. |
| `pnpm --filter @taki/core exec vitest run src/server/methods/presence-methods.test.ts src/presence/presence-service.test.ts src/db/migrations/051-initiative-feedback.test.ts src/initiative/initiative-composition.test.ts src/server/method-registry.test.ts` | Final: 4 existing files, 46 tests passed (RPC 6, service 28, migration 4, registry 8). The absent initiative-composition path is not coverage. |
| `pnpm --filter @taki/shared exec vitest run src/initiative-feedback-event.test.ts src/presence-schema.test.ts` | 2 files, 13 tests passed. |
| `pnpm --filter @taki/desktop exec vitest run src/features/presence/surface-presence-lifetime.test.ts src/features/presence/surface-presence.test.ts` | 2 files, 8 tests passed after the lifetime correction. |
| `pnpm --filter @taki/core typecheck` | Passed again after F1/F4 corrections. |
| `pnpm --filter @taki/shared typecheck` | Passed. |
| Targeted ESLint over presence composition, event bridge/projection/inspector, presence methods/test, initiative event schema/test and initiative runtime E2E | Passed after all three reviewer test additions. |
| Final ESLint over presence methods/test, presence service/sources and Desktop source-lifetime/hook files | Passed. |
| `git diff --check` | Passed, with existing line-ending conversion warnings. This command does not inspect untracked files. |

The root agent owns final whole-workspace Shared/Core/Desktop suites, root lint, build, real-process E2E and task validation. Reported earlier totals are not substituted for their final results after all concurrent fixes.

## Remaining evidence and release limits

- No unresolved production code finding remains in the reviewed scope after F1/F2/F4 corrections. The root's subsequent final integrated checks and native evidence are recorded in the addendum below; they do not constitute owner release acceptance.
- Native/WebView2 visibility, minimize/focus, actual text exposure, reading anchors, Pet gates and StrictMode behavior have separately recorded fixture evidence. The explicit fixture opener and absent Live2D model remain limitations; scripted RPC/provider and DOM tests alone do not prove native rendering or human reading.
- No C2 manual acceptance checkbox or parent completion criterion is marked passed by this report.
- This review did not use real user data, an external model provider, or another worktree's source.

## Final integration addendum — successor session

Root resumed the existing task and verified every source/configuration hash in the pre-final checkpoint before
running the full Core suite serially: 428 files, 3460 passed, one existing skip. Five-package typecheck passed.
The Desktop closeout recovered original 1104-test and native command records, preserved eleven actual WebView2
scenario groups plus four screenshots, and reran the production build after the final source edits.

The locked Rust gate found one directly related stale test expectation: its exact Home ACL array omitted C2's
three self-window read permissions. The checker added only those expected strings. The full 205-test gate and
Clippy with `-D warnings` then passed without changing permission enforcement or weakening assertions.

The final [implementation evidence](implementation-evidence-2026-09-28.md) and
[Desktop evidence](desktop-evidence-2026-09-28.md) contain commands, retained failures, source timing and limits.
Root lint still fails only on the independent QQMM smoke script's existing size violation; its dependency-lock
mismatch also remains. These are explicit whole-workspace limits, not unresolved C2 production findings.
The final source checkpoint and task status preserve pending owner acceptance and do not activate C3.
