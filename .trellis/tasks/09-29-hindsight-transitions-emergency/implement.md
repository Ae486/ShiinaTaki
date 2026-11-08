# Stage 4 execution and validation plan

Status: W0-W8 implementation and approved isolated automated acceptance complete on 2026-10-06. The owner approved
implementation on 2026-09-29. Preserve all evidence and real-data boundaries; do not repeat completed journeys.
The final [W8 independent check](research/w8-independent-check.md) and [execution status](research/execution-status.md)
record the delivered scope. Manual/original-environment acceptance remains open. The owner subsequently authorized
the local commit batch recorded in `research/commit-checkpoint-2026-10-06.md`; no push or archive is included.
Owner steering on 2026-10-06: prioritize functional completion and correctness over additional performance margin.
Keep performance-aware implementation, but fix performance only when it blocks the real flow or violates its
functional contract; do not delay completion for benchmark improvement or speculative optimization.
The owner also authorizes the leader to batch checks by coherent functional milestone and adjust their frequency
to risk/complexity, rather than dispatching a separate check after every implementation slice. The leader selects
review dimensions from the actual changes and plan; final integrated verification remains required. Record
non-blocking performance work for later. Line-count lint may be accepted as a documented exception or modestly
adjusted when the file/function remains cohesive; this does not excuse unrelated responsibilities accumulated
in one file or other lint/type failures.
Follow [PRD](prd.md), [design](design.md), [source mapping](research/stage-4-prerequisites.md), and
[acceptance disposition](research/recovery-2026-09-29.md).

## 1. Recovery and planning checklist

2026-10-07 current next step: W9 implementation and [independent review](research/w9-independent-check.md) are complete
and accepted. The [W9 amendment](research/stage4-w9-lease-plan-2026-10-07.md) records the correction and accurately
disclosed complete-Core/scoped-timeout-recovery gate. Lease duration is unchanged. The former B7 Stage 5 planning
continuation is superseded by the 2026-10-29 routing note below.

2026-10-29 routing note: the parent [execution plan](../08-09-memory-operations-ui/implement.md) now schedules the
connected exercise of these delivered producers on isolated data as its section 2, after the first usable path and
before managed installation; the delivery map carries the same row. That journey exercise is where this task's
delivered W0-W9 scope next gets used. No new source, runtime or acceptance work is authorized by this note.
W0-W8 below remain historical completed work; original/manual acceptance and Git/lifecycle boundaries remain.

- [x] Restore source-session direction, current workspace/HEAD, task identity and planning-only scope.
- [x] Read related Stage 1/2/3 archives and the two independent current-HEAD acceptance reports.
- [x] Recover original typecheck/lint command exit codes; distinguish preserved evidence from new execution.
- [x] Assign the two reproduced defects and Local inventory caveat to prerequisite remediation.
- [x] Draft proposed transition, queue, common-baseline, runtime and emergency contracts.
- [x] Complete source prerequisite report and resolve material conflicts with the proposed design.
- [x] Curate/validate context manifests and check artifact links, encoding and required-case coverage.
- [x] Present the complete planning result for scope-specific review before `task.py start`.

The recovery/planning phase did not change production code. Owner-approved implementation subsequently completed;
see `research/execution-status.md` for final wave checks and remaining acceptance boundaries. Stage 1/2's
406 passing tests and Stage 3's 205 passing/1 skipped tests overlap and must not be added as unique coverage.
Those historical passes and archive completion do not establish Stage 4 behavior or owner/manual acceptance.
W0 separately repaired and independently checked the two defects.

## 2. Execution discipline and ownership

Run one sub-agent at a time, one implementer per whole wave. Do not dispatch smaller competing fragments. The leader
owns requirements, the source-backed protocol review, cross-repository dependencies, shared migration allocation,
integrated acceptance and owner communication. Each implementer owns the listed wave paths only. The leader
confirms each dependency's actual readiness before the next wave; independent reviews may cover multiple
coherent implementation slices under the owner's 2026-10-06 cadence. Run focused verification at critical
data-migration, authority/permission, state-commit and process-cleanup boundaries. A reviewer must not silently
expand scope or repeat already sufficient checks without a changed path, failure or unresolved concern.

Before each wave, verify cwd/branch/HEAD, worktree list, task pointer and current migration head. Taki work stays in
`H:/TakiAgent`; native work, if authorized for execution, uses an explicit separate `H:/hindsight` ownership brief.
Preserve all pre-existing native patch changes. Never treat T4 or scratch-worktree results as evidence for this task.

Production implementation uses `trellis-before-dev`/injected specs, then `trellis-implement`, meaningful
validation, appropriately batched independent `trellis-check` and spec synchronization. Changes to Shared schemas precede consumers.
Allocate migrations once, extend immutable evidence without rewriting prior migrations/receipts, and update touched
source folder indexes and module contracts. No new dependency is currently planned.

## 3. Ordered waves

| Wave | Ownership / deliverable | Dependency and exit gate |
| --- | --- | --- |
| W0 — trustworthy prerequisites | Existing replica scheduler request/claim/outcome repositories and `memory-operation-kind-replica.ts`; backup status/schema/emergency/Home projection; rollback runner/hold paths; narrow the Local fence spec. | Reproduce R1/R2 before repair. Exact attribution, same/incompatible-history intervals, D93 seed/page rollback and R3 inventory cases pass. Existing Stage 1/3 behavior remains covered. |
| W1 — transition protocol and durable owner | `packages/shared/src` transition request/status/intent schemas; Core `db` transition evidence/intent repositories and migrations; `memory/operations` family and registry. | Freeze wire names, record formats, admission/cutoff, lease/recovery and terminal meanings before W2-W6. Real SQLite concurrency/reopen/CAS tests, strict schema tests and exclusive-family tests pass. No UI action advertised yet. |
| W2 — native final boundary and reusable transfer | Existing native Bank writer/finite-maintenance/current-state-transfer foundations in `H:/hindsight`; versioned compatible extension contracts and Core native client. Exact files from source mapping. | Native owner/worker barriers, post-fence final proof, lost replies, stale lease, crash/unknown COMMIT and baseline-guarded delta semantics pass against owned PostgreSQL. All supported writer surfaces are enumerated. No interface-only readiness claim. |
| W3 — Core candidate and transition proofs | Core memory transition service, complete logical manifests/mapping, canonical Local reconstruction, common-baseline evidence, D86 scope identities; existing B4/B5 adapters remain explicit. | Multi-Bank candidates preserve agreed state. No fake B2 receipt, first-activation guard weakening, mandatory new Bank or silent whole-bank overwrite. Stale/missing/foreign baseline and every incomplete proof refuse. |
| W4 — runtime handoff and intent execution | Core runtime selector/composition, both bindings and lifetime guards, primary custody, transition intent executor, boot/shutdown and composition wiring. | Atomic receipt/epoch/custody COMMIT, old-reference refusal, fresh target execution and effect recovery survive reopen. Foreground sync/hydration and background writers obey the same ownership boundary. |
| W5 — healthy return and re-entry integration | Transition operation handlers/services over W1-W4; real producer progress and historical recovery; complete C07 journey fixtures. | Local→Hindsight→Local→Hindsight with intervening mutations and all Banks; exact final proof, queue disposition, lost replies and pre/post-COMMIT crash matrix pass. |
| W6 — emergency integration and recovery procedure | Transition emergency handler, Stage 3 offline seal adapter, replica/Pending/custody disposition, foreign-history guard; reviewed D91 recovery runbook and fixtures. | Provider permanently unavailable: no native backup prerequisite, valid incident-before-COMMIT ordering, honest uncertainty, Local recovery and old-provider isolation. Recovery runbook proved on isolated copies. |
| W7 — minimal usable Home | Shared operator client/routes and Desktop Operations components/controllers/indexes. Reuse the existing operation service and push channel. | One normal confirmation; separate emergency confirmation; loading/conflict/unknown/runtime-unavailable cases; lost response/closed initiating Home/second observer/retired client tests and Desktop build pass. |
| W8 — integrated review and specification | Leader plus one independent checker: all changed packages/native scope, executable memory specs, current task evidence and final source identity. | Required deterministic tests, native integration, current isolated restore, boot/build and scenario coverage pass or have explicit blocking disposition. No owner/manual result inferred. |

Shared-file ownership is serial: W1 owns schema/registry/migration admission; W2 owns native transport contracts;
W3-W6 own their transition modules, with runtime composition changed only in W4 and necessary reviewed integration
points afterward; W7 owns Desktop consumers. The leader checks integration patches between waves rather than
allowing simultaneous edits to `main.ts`, runtime composition, operation unions or migration registries.

W2 must settle native field names, extension versioning, fence-retirement recovery and target delta application
against the actual native implementation before callers are implemented. If that cannot uphold the accepted
guarantees, revise the engineering plan and report the concrete limitation; do not lower the preservation contract.

Required integration details from the completed source review: W4 separates epoch retirement from permanent binding shutdown and excludes manual sync admission during final transition ownership. W6 persists incident identity before sealing and recovers the same seal after reply loss; add a crash-after-seal-before-ACK assertion to T15. Read both source prerequisite report parts.

## 4. Regression and acceptance matrix

| Case | Concrete stimulus and expected proof | Owner / requirement |
| --- | --- | --- |
| T01 | Earlier auto/catch-up run succeeds after manual admission; the claimed manual run then fails. Operation remains failed with its own code/action, including equal timestamps, multiple Banks and restart. | W0; R1/D84, C06/C09 |
| T02 | Same Bank ID with changed generation/lineage or unproven epoch relationship; older verified backup still listed but interval unknown. Compatible history retains truthful coordinates; unknown remote head is disclosed. | W0/W6; R2, C08/C10 |
| T03 | Capture a new Character while Local is quiesced. Final coverage detects the new Bank or safely witnesses unavailable memory; never promotes incomplete coverage. | W0/W4; R3, C03/PR03 |
| T04 | B5-only seed predecessor and native-only rollback during incremental pages. Refuse before publication, preserve both checkpoints and require explicit retry; genuine generation reset retains its supported rebuild path. | W0; D93, C06/C10 |
| T05 | Duplicate request, concurrent family owner, stale preview/config/epoch, new executor after lease loss, cancelled-before-claim. One durable identity and correct admission/refusal; no effect after cancelled claim. | W1; C09 |
| T06 | Write or native maintenance completes immediately before final fence. Final certificate/snapshot includes it; an earlier certificate cannot satisfy the gate. Repeat for Global and empty/nonempty Character Banks. | W2/W5; C07, PR01 |
| T07 | Native Control Plane/API/MCP and ordinary scheduler/worker writers race the fence; old executor completes late; fence lease is lost while Core COMMIT is unknown. No unproven final state or silent native reopening. | W2; C07, final-state clarification |
| T08 | Multi-cycle state includes additions/edits, invalidate/restore, policy/expiry/deletion, Blocks, provenance, typed/null/empty fields and native-derived records. Complete manifests match; unchanged records reuse identity/body. | W3/W5; C07, A08/A35/A36 |
| T09 | Existing migrated and newly created Local Bank IDs coexist; retry reconstruction after crash. Preserve old IDs and reuse one new scope mapping without rewriting receipt history. | W3; D86 |
| T10 | Target Bank has foreign writes, different generation, missing baseline/mapping or incomplete delete coverage. Refuse re-entry without a new-Bank/full-copy/merge fallback. | W2/W3/W5; C07 |
| T11 | Supported intents arrive before cutoff; a stale invocation arrives after COMMIT; two queued mutations expect the same revision; queue capacity is exhausted. Exact durable acknowledgements/results, ordered conflict, stale refusal, no loss. | W1/W4/W5; PR04/C07 |
| T12 | Crash after intent admission, after target effect, and before acknowledgement; close original caller. Reopen discovers the original identity and applies each factual effect once without replaying a Run/closure. | W4/W5; PR04/C09 |
| T13 | Primary append/group finalizes during drain, between COMMIT and bind, on cancellation/user-only failure and after reopen. Preserve exact membership and one eventual ingestion; incomplete/unowned sources block promotion. | W4; PR03/C03/C07 |
| T14 | Constructor/binding fails before or after COMMIT; corrupt receipt; shutdown during capture; held old Run/Effect invokes afterward. Select only proven authority, keep old references retired, no unintended scheduler restart. | W4/W5; C03/C09 |
| T15 | Native hangs permanently; no verified backup exists, or its namespace differs. Emergency seals surviving evidence without native requests and reports unknown coverage. Seal failure prevents COMMIT. | W6; C08/PR01 |
| T16 | Emergency COMMIT then crash, pending native result unknown, old provider returns. Recover new Local, preserve unresolved evidence, reject old dispatch/automatic merge and healthy re-entry on the foreign branch. | W6; C08/C09 |
| T17 | Native/Core pair mismatch, missing credential, older native checkpoint and valid restored pair with an unfinished native effect. Worker startup gated; valid pair recovers without another effect. | W6/W8; D91, C10/PR01/PR02 |
| T18 | Initiating Home loses reply/closes; second authenticated client observes; stale connection emits late status; user selects normal versus emergency action. Same operation, truthful state, no write replay, distinct confirmations. | W7/W8; C09 |

The exact desired assertions in the review-only defect probes should become colocated regression tests during W0;
do not move a probe that asserts buggy behavior into the passing production suite unchanged. Test real scheduler and
SQLite state for attribution, not a mock that already fabricates the expected terminal result.

## 5. Coverage and preserved boundaries

| Ledger | Stage 4 responsibility | Separate evidence / boundary |
| --- | --- | --- |
| C07 / A08/A35/A36/A38 | Repeated healthy transitions, complete current-Local changes, final proof, durable intents, runtime recovery. | New Stage 4 journey; reconstruction and archived first activation alone are insufficient. |
| C08 / A37 | Offline emergency seal, explicit takeover, uncertainty, new epoch and foreign old authority. | No original-data takeover or subjective manual acceptance here. |
| C03 / PR03 | Regression of first activation plus generalized custody and repeated handoff. | Preserve archived S2 scope; do not relabel new Stage 4 coverage as an old test. |
| C09 / A34/A44/A45 | Operation identity, same-Core multi-client observation, cancellation/unknown outcomes and UI recovery. | Remote Core selection/independent Core merge stay D23. |
| C10 / PR01/PR02 | Consume verified pair/custody and prove current isolated recovery before real-data release; emergency has no fresh native backup prerequisite. | Stage 3 native/restore history remains separately dated. D90 cleanup and staged upgrade remain Stage 5. |
| PR04 | Admission/cutoff, immutable intent, mapping/revision proof, replay identity and original-caller outcomes. | No generic Run/Effect replay or implicit authority rebinding. |
| PR05 / C01 | Existing Local onboarding reused and regression protected. | No new onboarding redesign. |
| C02/C11/C12/C16 | Preserve compatible setup, secret ownership and existing templates; verify changed integration only. | Managed provisioning, full overlay/model lifecycle, upgrade and full supported-environment/manual matrix remain Stage 5/6. |
| C13-C15 | Truthful optional/deferred capability and topology disclosure. | D79-D83 and D81's known failure remain open; no new basic-use prerequisites. |

## 6. Verification commands and evidence

The2026-10-01 owner amendment requires real-data reuse at W3, W5 and W6/W8 as detailed in
`research/real-data-reuse-plan.md`. Necessary real LLM calls are authorized for these scoped tests. Do not repeat the
historical corpus's Local-to-Hindsight conversion/extraction; preserve original data and reuse existing native outputs.

Inspect package scripts before executing. Focused commands select the new colocated tests plus changed existing
families; use at most two Vitest workers. These final gates passed in W8; exact results and retained first-run
failures are in `research/w8-independent-check.md`. This command list is a reference, not a request to rerun them:

```powershell
# cwd H:/TakiAgent
pnpm typecheck
pnpm lint
pnpm --filter @taki/shared exec vitest run --maxWorkers=2
pnpm --filter @taki/core exec vitest run --maxWorkers=2
pnpm --filter @taki/desktop exec vitest run --maxWorkers=2
pnpm --filter @taki/desktop build
git diff --check
python ./.trellis/scripts/task.py validate 09-29-hindsight-transitions-emergency
```

Use existing headless journey fixtures and native smoke/restore harnesses as the basis for the Stage 4 integration
harness. Update archived-path
references in a new task-owned harness; do not edit immutable archive evidence. Record exact commands, source HEADs
and native dirty-file hashes, compatible build, schema head, owned data/ports, steps, native request counts, outcomes
and teardown. Use independent Core boot on a non-default port/data directory, verify registered kinds/status and a
clean shutdown without unintended native/model calls. Run Rust checks only if Shell/native Rust code changes.

Current native fence/transfer behavior must be tested against owned PostgreSQL and the real native writer paths;
transport doubles support failure scheduling but cannot certify that boundary. A current isolated backup/restore
and takeover journey is a release gate before any separately authorized real-data authority replacement.
Do not claim Windows UI/custody/real-model quality from deterministic fixtures. Those remain owner-confirmed D89.

## 7. Rollout and rollback

- Before activation, review this complete artifact set and the supported native contract. Keep task `planning`
  until the scope-specific gate is satisfied; then call `task.py start` once.
- Ship native capability/version support before enabling the corresponding Core action. Missing capability fails
  closed; do not infer support from an API key or old build metadata.
- Additive migrations preserve old receipts and operation history. Rehearse upgrade from the actual current head;
  do not allocate a historical migration number or rewrite an already recorded migration.
- Before authority COMMIT, a failed candidate stays unselected; reconcile remote effects and resolve admitted
  intents before restoring source writability. Unknown effects/fences may keep the runtime unavailable.
- After COMMIT, recover the selected new epoch. Use the validated recovery procedure for actual restoration;
  changing config, reopening old runtimes or downgrading schemas is not rollback.
- Retain backups, incident artifacts and old history. No automatic deletion, cleanup, push or task archival follows
  preparation. Record actual verification and remaining limitations before any later delivery/finish decision.

## 8. Material readiness questions

The owner has no known unanswered product decision within this scope. W1-W6 and consolidated W8 proved the native
writer/fence boundary, complete delta/reentry contract, Local receipt/binding and unknown emergency-write handling
against their assigned fixtures and retained actual-data evidence. No unresolved in-scope engineering blocker remains.
Parent verification matched the final 23-file source overlay and all 28 evidence pins. Spec review confirms the
publication contract retains the complete synchronous-evidence rules and the frontend contract records Core-owned
permission, original-operation recovery, controlled browser ordering and bounded RPC behavior; no duplicate spec
change is needed. Original-environment/manual acceptance and performance improvement remain separate.
