# S2/S3 recovered implementation

Date: 2026-10-23. Owner: `delegation_execution_recovery`. Scope: finish the existing Runtime S2/S3 after restart,
preserving the delivered S1 and concurrent Source/Desktop work. No commit, push, reset, clean, archive, migration-lineage
integration, production release or real-user data change was performed.

## Workspace and recovery boundary

- Verified `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, and the real Git worktree list.
  Bound this native child session to the existing Runtime task with `task.py start`; `task.py current --source` resolves
  the session binding. The intentionally stale global `.trellis/.current-task` was not edited.
- Read original parent requirements, Runtime design/implementation, S1 review and the joint contract. Existing SDK and
  persistence research/gates were reused; they were not repeated as a substitute for execution work.
- Captured 227 current file preimages before recovery edits in `s2-recovery/preimages/`; hashes are in
  `s2-recovery/preimages-manifest.json`. `s2-recovery/recovery-owned-files.json` lists 39 actual recovery-owned
  production/test paths and their frozen hashes. The later explicitly transferred `workspace/read-file-tool.ts` was
  outside that initial backup batch; its reviewed Git diff contains only the source-sidecar import and unchanged-result
  wrapper (3 insertions, 1 deletion). No unrelated content was reverted.
- Recovered S2 already contained the private WorkContext/message store, child execution/service, addressed tools, targeted
  registry/queue changes, snapshot Memory projection, schemas and query methods. The older `s2/vertical-tests.json`
  contains 24 passes. It remains a historical partial checkpoint, not the final implementation gate.

## Completed behavior

1. Shared execution/private context: the same ChatAgent/ToolLoopAgent executes child work and main continuation with
   trusted WorkContext. Selected snapshot/material context, private replay and addressed work input are preserved.
   Actual model Effect intent writes input receipts. Completed native tool/error output and uncovered partial text are
   retained independently from the final structural result.
2. Child lifecycle: children use disjoint keys/controllers in the existing owners. Parent cancellation never reaches a
   child. User stop latches durably; parent interruption and trusted owner yield have distinct continuation rules.
   Explicit idle `expectedRunId: null` is supported and CAS checked on send/stop/continue. Work B does not change A's
   watermark. Failed capture does not spin on its own lane-release event.
3. Completion: a bounded durable pending/deferred scan admits one fresh parent Run under the stable completion key.
   `record_only` admits none. Parent inference has normal main Memory authority, current relationship replay plus the
   exact child report, a private transcript, and a retained explicit internal/no-action/reply decision. Plain text is
   not speech. Terminal parent runs are never automatically rerun.
4. Delayed direct-request reply: actual primary delegation captures the original committed request/witness and creates
   its own held accepted report root. Cancelling the original parent immediately after independent acceptance preserves
   that request. The explicit canonical reply uses existing PreparedPublication/Delivery and a stable result candidate;
   the root survives staged/held delivery. Duplicate publication after root closure remains an idempotent read.
5. Source integration: exact post-commit child result/control callbacks and current-work checks are released to the
   Co-Watching owner. Typed domain failure proposals remain failed terminal results. Actual successful `read_file`
   output carries non-serialized producer-known path metadata. Explicit MaterialRef arrays select current completed
   tool output or retained private input/tool/result evidence; complete original output/error/status is copied rather
   than replaced with source labels. Only selected source facts reach the child/parent result.
6. Executable tools/Memory: immutable final allow/inherit/exclude lookup enforces child read-only Memory. Empty bags
   remain empty, capability digests/flags stay unchanged, and main continuation retains its allowed Memory writes.
   Final selection travels through captured execution options so excluded MCP/Skill/Host aliases cannot bypass it via
   `extension_call`. Existing governance remains the decision owner.
7. Recovery/API/root wiring: linked RunRepo participation is installed before the production recovery barrier. Linked
   recovery records cancelled/unknown/deadline truth instead of inferring whole-work success from a last completed
   model Effect. Generic explicit continuation captures a fresh Run; unknown non-model Effects require reconciliation;
   lost domain/publication handles are never reconstructed from stored labels. Production main composes the service,
   report adapter, Co-Watching port, public methods and shutdown. RPCs and subscriptions require the actual current
   authenticated operator connection; copied, retired, Node and unauthenticated connections refuse.

## Files and released ownership

Exact recovery paths/hashes are in `s2-recovery/recovery-owned-files.json`. The main groups are:

- `agents/`: extracted `agent-tool-assembly.ts`; ChatAgent/private-message integration; actual tool material metadata;
  delegation/message material selection; existing child and parent result collectors retained.
- `harness/`: child service/state/execution/material/query/subscription follow-ups; new completion, parent execution,
  composition and linked recovery modules; currentness and typed domain-failure ports.
- `delivery/direct-request-report.ts`: accepted original-request root, exact canonical reply staging and final closure.
- `extensions/extension-registry.ts`, `extension-sources.ts`, and `governance/executable-tool-selection.ts`: immutable
  selection propagation and sealed indirect alias checks.
- `db/subagent-input-repo.ts`: exact nullable Run target checks for message/continue. The verified S1 transaction
  participant/schema lineage remains intact; no new migration was introduced in recovery.
- `harness/run-snapshot-capture.ts`, `harness/run-service.ts`, and `testing/subagent-fixture.ts`: exact process-local fixed
  Memory exclusions, preserved snapshot evidence and injectable actual snapshot-capture regression seam.
- `server/methods/subagent-methods.ts`, `main.ts`: live authenticated RPC registration, durable recovery/install order,
  child/report composition, correct Character lane hooks and bounded cleanup.
- Shared `subagent-schema.ts`, `subagent-api-schema.ts`, `subagent-tool-schema.ts`, and package barrel: nullable idle
  target, selected material inputs and exported Desktop parameter/result types.
- On-touch folder indexes and `.trellis/spec/backend/shared-agent-delegation.md` plus backend index.

Released stable ports:

- `turn-mapping.ts` ownership was explicitly released to Source after its structural input signature narrowing. Source
  owns all later source rendering/projection changes; Runtime imports its common renderer.
- `SubagentWorkBinding`: `prepareExecution(execution)`, `validateAndPropose(execution)`,
  `onCommittedResult(completionId)`, `onControlChanged(subagentId)`, `checkCurrent(token, phase)` and source/scheduling metadata.
  `OwnedSubagentExecution` exposes exact Run, current Attempt/token, signal, captured context and material sink.
- `SubagentService`: `submitOwnedWork`, `yieldOwnedWork`, `resumeOwnedWork`, `isWorkCurrent`, `released`,
  `authorityChanged`, plus authenticated-facing read/control service methods. Source owns the adapter policy and source
  truth; Runtime owns Run/controller/private transcript/receipt/result authority.
- Public `subagent.list/history/result/send/stop/continue/subscribe/changed` and Shared schemas/types are released to
  Desktop. Targets use `expectedRunId`, including explicit null; inputs expose actual consumption receipt, result
  projections expose child/parent/publication and joined canonical delivery state.

## Verification

All automated cases below use synthetic isolated data. Scripted SDK checks are not real-model semantic acceptance.

| Evidence | Result |
| --- | --- |
| `s2-recovery/final-scoped-tests.json` | 74/74 across 14 actual Core test files; shared Agent/disclosure/extension/snapshot/file-read regressions plus Runtime lifecycle/material/report/API cases |
| `s2-recovery/shared-schema-tests.json` | 3/3 Shared delegation schema cases |
| `s2-recovery/recovery-api-tests.json` | 3/3 additional orphan-Run and authenticated public-method cases; included in the 74 total above |
| `s2-recovery/direct-report-tests.json` | 2/2 actual SDK + SQLite + existing Delivery reply/no-action cases after immediate original-parent cancellation; included above |
| `s2-recovery/r3-captured-selection-regression.json` | 15/15 focused cases after the live R3 projection-order fix, including actual createRunSnapshotCapture + SDK + SQLite with permitted recall, legitimate mutation names and metadata alias |
| `s2-recovery/scripted-projection-green.json` | Parent-maintained real-main/WS mutation-selection regression: 1 matched pass, 2 intentionally filtered skips; exact scenario reports sourceUnchanged true, no cleanup/deadline failure |
| `s2-recovery/r3-source-regression.json` | Captured-selection and Source actual-SDK primary-source retention regressions passed after the narrow onStepEnd wire |
| `s2-recovery/continuation-guard-tests.json` | 14/14 targeted lifecycle/recovery/API cases, including expired/retired-source refusal preserving the user latch, control version, inputs and model call count |
| Scoped ESLint over recovery Runtime/Shared paths and main | Exit 0 after extracting shared tool assembly and cohesive lifecycle helpers; no new rule disable |
| Core typecheck | Latest Runtime-owned full Core typecheck after the R3 and primary source-metadata corrections exited 0; the earlier Source fixture `CompanionFixture.timeline` failure was fixed rather than suppressed |
| `git diff --check` | Exit 0; unrelated existing EOL advisories did not indicate whitespace errors |
| Parent production-main + authenticated WS scripted gate | Passed 2 cases, `record_only` and `request_parent`; actual HTTP SDK path, retained input receipt/new Run/private result, no implicit delivery. Parent-owned `../10-21-agent-context-acceptance/research/recovery-20261023/scripted-rpc.json` and `scripted-rpc/` |

Representative commands:

```text
pnpm --filter @taki/core exec vitest run src/harness/subagent-service.test.ts src/harness/subagent-completion.test.ts src/harness/subagent-recovery.test.ts src/harness/subagent-materials.test.ts src/harness/delegation-tools.test.ts src/delivery/direct-request-report.test.ts src/server/methods/subagent-methods.test.ts src/agents/chat-agent.test.ts src/agents/tool-disclosure.test.ts src/harness/run-snapshot-capture.test.ts src/harness/recovery-coordinator.test.ts src/extensions/extension-registry.test.ts src/extensions/extension-run-context.test.ts src/workspace/read-file-tool.test.ts
pnpm --filter @taki/shared exec vitest run src/subagent-schema.test.ts
pnpm --filter @taki/core typecheck
git diff --check
```

The full-worktree final gate belongs to the coordinator; other Runtime/Source/Desktop files were concurrently changing
outside the explicitly frozen checkpoints. No repeated full-suite result is claimed here.

## Live-found correction

The first real R3 campaign (`live-r1-r3-20261023-100158/r3-child-read-main-write-VMK51r`) revealed a real composition defect:
the parent selected `[recall, complete_subagent, retain, update_memory, invalidate_memory, restore_memory]`, snapshot
projection removed the writes, and the later tool allow-list validator then rejected the legitimate removed names before
the child's first model Effect. The failed evidence is retained; the scenario was not weakened.

The corrected responsibility boundary keeps fixed `memoryToolExclusions` from trusted snapshot capture in process-local
Run context. The validator still requires parent membership, accepts only actually captured fixed exclusions among absent
tools, and excludes them from execution. Arbitrary missing names still refuse. This also works for producer-metadata aliases
whose names are not in the canonical vocabulary, and does not alter provider capabilities/digests. The actual-snapshot
regression proves permitted recall executes and writes do not; the maintained real-main/WS failure now passes.

Source additionally demonstrated that SDK response conversion loses raw-result symbol metadata. ChatAgent now passes
actual `event.toolResults` and response messages through Source's `retainStepToolSources` before primary recording.
Private WorkContext continues to use its own result attachment. This preserves producer facts at the actual SDK seam;
the complete native tool output/status stays unchanged.

The unchanged real R3 scenario subsequently passed under coordinator execution:
`../10-21-agent-context-acceptance/research/live-r3-repaired-20261023-101357/`, six successful real provider requests with
stable source hashes. The child actually recalled the synthetic marker, received no mutation tools, made no Memory write,
and left the original Memory row unchanged; the main role's actual retain succeeded. This is a bounded semantic sample,
not an unrestricted reliability or manual-acceptance claim.

A final continuation review found that source/expiry rejection previously occurred only after Continue acceptance.
The service now validates existing WorkCurrentness first, and the repository independently rejects expired lifetime before
clearing a user latch. The targeted regression proves expiry and retired source preserve the latch, exact control version,
input/execution counts and model call count. Expired queued work is displayed as deferred rather than executable queued work.

## Limits and follow-ups

- This T4 migration lineage remains incompatible with main from 049 onward. No main integration or rollback-by-reset is implied.
- Exactly-once means retained completion identity and at most one automatically admitted parent Run. It does not mean
  exactly-once external effects or transport. Unknown effects/refused authority are retained, not automatically replayed.
- Current primary ephemeral material references require the original live execution. Retained child sources/results remain
  inspectable after restart; stored source/acceptance JSON cannot restore a missing publisher or domain authority.
- Restricted work refuses an indirect extension with no mapped selected executable alias. No provider capability metadata
  is changed to hide this refusal; the result remains explicit and inspectable.
- Private replay remains bounded with an older-history notice and readable history tools. A hard process loss cannot
  guarantee persistence of an incomplete current text chunk that had not reached the existing commit seam.
- Actual Source/Co-Watching/Desktop integration and final whole-tree gates remain coordinator-owned. No manual AC was
  marked passed. The parent reports real R1 passing (7 successful provider requests) and repaired R3 passing (6 successful
  requests). The first two-request R3 failure remains retained with its production root cause and regression above.
