# Research: Operation-scoped logical derived completion

- Query: What is the smallest durable Hindsight producer contract that can prove the logical derived work caused by one retained request or conditional mutation has settled?
- Scope: internal; H:/hindsight producer and H:/TakiAgent B5 consumer; no live service or semantic execution.
- Date: 2026-09-07
- Source baseline: leader-verified Hindsight `7eca2056dae5d70a682b755abfff8a107f6b08a0`; Taki `c3f8bc4` plus the preserved reviewed Wave 3 working tree. References below are current file reads, not historical acceptance claims.

## Findings

### Recommendation and its exact boundary

Use a **versioned durable native-result receipt plus operation-to-logical-work records**, written by the existing authoritative transactions and consumed by the existing task queue. Observe and persist native source-processing and native trigger decisions; do not construct completion from task status, extraction counts, current document enumeration, or queue emptiness.

The common substrate is an evidence/receipt extension, not an alternate consolidator. For the approved requirement that later continuous Bank traffic cannot keep extending a root's completion boundary, the preferred complete design is that substrate **plus the narrow opt-in root trigger described in the decision addendum below**. Preserve source selection, scope resolution, batching, prompts, consolidation actions and native retry policy. Do not freeze the whole source cohort.

The governing distinction is in Taki `docs/adr/0009-single-memory-authority-with-local-replica.md:17,25,45`:

| Surface | B5 completion obligation |
| --- | --- |
| Source document identity/hash, source facts, lifecycle/revision, tags, entity names, provenance | Native receipt must cover the actual committed results; the second pull must contain their logical transaction prefix. |
| Observation create/update/delete, source associations, consolidation markers and survivor reconsolidation caused by the write | Required when the effective native policy requests them. A failed source or an undeclared successor cannot be counted as complete. |
| Mental-model writes actually selected by the native after-consolidation trigger | Required once selected for the operation's logical maintenance; the declaration must be durably closed, and the selected refresh must have a real persisted outcome. |
| Directive/Bank changes | Pull every committed logical change through the fence. Retain/curation do not inherently cause a new directive write; do not invent one. |
| Retain final ANN, graph adjacency top-up, orphan entity/cooccurrence sweeps, embedding indexes, worker statistics, webhook delivery, trace attachment | Producer-private execution/quality/operations. They are not logical replica objects and must not be expanded into a requirement for global index perfection. Keep truthful native status/diagnostics, but do not make private index repair a new B5 logical-completion gate. |
| Later cron refresh, unrelated manual consolidation/refresh, future native writes | Not part of this operation's finite identity set. Their logical writes still arrive via ordinary journal synchronization. |

`engine/replication.py:21-30,47-119` confirms the complete journal-kind set is Bank/document/memory_unit/mental_model/directive. It contains public entity names and observation source IDs, not `memory_links`, ANN results, queue rows, or entity statistics. `retain/orchestrator.py:2882-2888` explicitly identifies deferred entity-stat flush as retrieval-unaffected; `engine/memories/pg/graph.py:451-711` mutates private graph/queue tables. Do not use the discovery of swallowed ANN failures as justification to redesign those subsystems in this task.

### Files found and live call chain

All paths in this table are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/` unless stated otherwise.

| File and code location | Observed role and consequence |
| --- | --- |
| `api/http.py:732-780,850-883,7746` | Public retain input, optional async UUID, acceptance response, and real handler. `operation_id` is ignored by synchronous retain; the response does not contain a full result mapping. |
| `engine/memory_engine.py:16435-16518,16537-16707` | Authenticate/validate; UUID replay checks Bank/type only; create a payload-less parent and executable children. Child contents stay together by document because sibling workers do not serialize a shared document. Parent/children/full payloads are admitted in one transaction. |
| `engine/memory_engine.py:1954-2002,3995-4373` | Worker child calls native retain, preserving tenant attribution. Large items can commit several sequential sub-batches. Outcome metadata is separate from native writes; post-insert maintenance runs after retain. |
| `engine/retain/orchestrator.py:479-625,1721-1804,1861-2024,2642-2865,2927-2981` | Canonical document/fact/provenance writes and logical publication already have short transactions with the Bank-state lock first. Streaming, zero-fact, delta, and metadata-only paths all need evidence coverage. |
| `engine/memory_engine.py:2588-2677` | Existing retain webhook outbox uses `conn` supplied by the writer. The factory captures one operation UUID across groups, and can count the full current document on the same connection. This is a useful transaction seam, not yet a result contract. |
| `engine/retain/orchestrator.py:2007-2020,2237-2250` | Callback currently runs before logical publication, only for the last facts-bearing batch, with a separate-transaction fallback for exact batch boundaries/zero-fact/all-skipped paths. It cannot alone prove every prior batch or a final result. |
| `engine/memory_engine.py:4375-4404` | Retain/import resolves native Bank config; only `enable_observations && enable_auto_consolidation` submits consolidation. Graph submission is separate and best-effort. IDs are discarded. |
| `engine/memories/conditional_mutation.py:14-65,165-249` | Typed normalized mutation fingerprint, unique claim, and immutable original result. Claim, mutation and completion share one transaction; receipt replay survives source deletion. |
| `engine/memory_engine.py:8599-8628,8802-9057,9076-9095` | Mutation replay is receipt-first. Phase 2 changes source/observation records and writes the receipt/journal before post-commit consolidation/graph submission. Enqueue failure leaves native success intact. |
| `engine/memory_engine.py:16238-16427,16822-17012` | Existing queue insertion includes full payload in the INSERT; pending Bank-level dedup uses a Bank row lock. Processing jobs are not dedup targets for consolidation. Scoped consolidation bypasses that dedup; cron MM dedup is per model and includes processing. |
| `engine/task_backend.py:95-146,189-238` | Sync backend executes on notification; broker/worker backends rely on the durable `async_operations` row. Never execute a Sync backend notification while the authoritative transaction is open. |
| `worker/poller.py:516-575,786-870,882-970` | Existing claim, execution, retry/defer, completion backstop and restart recovery. Task completion records only executor termination; it is not proof of logical semantic outcome. |
| `engine/consolidation/consolidator.py:1204-1239,1267-1352,1419-1528,1576-1723` | Native source selection, disabled/no-new branches, per-scope processing, partial source failures and transactional marker/journal publication. Source markers increment revision; unchanged input revision must be distinguished from the post-processing revision. |
| `engine/consolidation/consolidator.py:1912-1929,1965-2104` | Round-limit continuation, final-round-only trigger evaluation, scope/staleness filtering, and best-effort MM submission. Both continuation identity and MM submission identity are currently dropped. |
| `engine/memory_engine.py:12921-13087,13494-13650,14771-14829` | Refresh already has DB-time cutoff/processed watermark and explicit preserved/failed outcomes. `update_mental_model` publishes canonical state. Native scope/staleness helpers should be reused. |
| `engine/maintenance.py:398-504` | Cron refresh is a separate native policy with its own in-flight dedup. It must not extend an operation's recovery obligation forever. |
| `engine/replication.py:376-404,1020-1099` | Commit-visible Bank cursor serialization; `append_logical_changes` returns typed `AppendedLogicalBatch`. An empty/no-op must not fabricate a journal batch. |

### Finite work identity, without changing native processing

Capture **effects, not a snapshot of the whole Bank queue**. At a tracked native transaction, retain a fixed set of affected source versions and co-source versions whose consolidation state that transaction resets. Use the writer's actual live/archive rows and `PendingLogicalChange` accumulation. An invalidated/deleted source is not a live consolidation candidate; survivor reset is a distinct obligation. Unchanged append facts are part of its result mapping but do not automatically require re-extraction or re-consolidation.

The native policy decision must be recorded, not reconstructed later from a different config:

- Retain uses `memory_engine.py:4394-4398`; curation uses `:8638-8639,8944-8945,8969-8970,9010-9011,9076-9082`. The latter tests auto-consolidation, and the consolidator later tests observations. The `provider == "none"` skip is explicit at `:2224-2227`. Record legitimate `not_required` reasons from these branches; never auto-enable a flag.
- Config defaults are source facts only: `config.py:1170,1177-1178` enables stored document text, observations and auto-consolidation by default. No live Bank/tenant overrides were read.
- Native scope expansion is `_resolve_obs_tags_list` / `_resolve_write_scopes` in `consolidator.py:707-769`. Every native scope pass for a required source must settle; an observation cap or deliberate no-action can be a successful native processing outcome, while `consolidation_failed_at` is a failure.
- Capture only the public policy values/digest needed by this receipt. Do not persist provider credentials or copy the whole resolved config into an evidence record.
- MM dependency declaration uses native `refresh_after_consolidation`, resolved scope and actual staleness (`consolidator.py:2038-2074`, `memory_engine.py:14771-14829`). Taki's shipped template has no trigger override (`packages/core/src/memory/hindsight/taki-bank-template-v1.ts:52-58`); Hindsight's create default is false (`memory_engine.py:12857-12880`). This does not prove a user-configured Bank lacks automatic models.

An observational implementation needs a **declaration/seal state**, not just `children=[]`: a native branch that has not yet evaluated its trigger cannot be represented as a completed empty set. When a native final trigger does select models, persist the complete selected set and its operation associations atomically before reporting declaration complete. When native policy genuinely selects none, persist that decision and its native reason.

Record source processing under the original requirement IDs even if an existing shared native task performs it. Unrelated task success must never discharge a required source. A later write to the same source is not evidence that the old version was processed. It needs a source-version comparison and an explicit superseded/blocked result; do not mark it succeeded by reading the newer `consolidated_at`.

**Liveness limit that must remain visible:** native `_run_consolidation_job` is not a fixed-watermark loop. `consolidator.py:1462-1470` explicitly says later fetches include new concurrent writes; `:1512-1528` keeps fetching; round-limit continuation requeues at `:1912-1929`; MM evaluation is delayed to the native final round. The operation's required source identities and selected MM identities can be finite without promising a fixed completion time under infinite concurrent input. If a required native trigger remains deferred, evidence stays pending. Do not close it by pretending the last source stamp evaluated the trigger, and do not attach every unrelated future cron task.

If acceptance demands guaranteed termination independently of a never-quiescent Bank **including a deferred automatic-MM phase**, an observational patch alone cannot establish that promise from current code. A bounded native cohort/continuation or a different trigger timing policy must be explicitly selected. This is a scheduling/product decision, not a reason to weaken the accepted derived-completion guarantee.

### Minimum durable producer mechanics (proposed, not present today)

1. **Admit a versioned tracked operation.** Require explicit native UUID plus expected provider lineage/Bank generation. Persist the normalized request fingerprint before returning acceptance, in the same transaction as native parent/child admission. Conditional mutation reuses its existing fingerprint/claim and adds the common receipt linkage. The append companion report specifies per-input preparation and result snapshots.
2. **Write native result and logical obligations at the native commit seam.** Add a typed commit hook/context after canonical journal publication, or a direct engine-owned helper at that same site. It receives the exact `conn`, root/child/input identity, source/result witnesses, effective native maintenance decision, and `AppendedLogicalBatch | None`. It must cover every committed streaming batch plus delta/zero/no-op paths; a final-only webhook callback is insufficient.
3. **Make derived submission durable.** Prepare a typed native task spec outside the write transaction as necessary for authentication/validation; insert the full `async_operations.task_payload` and the work association inside the caller's transaction. Factor the insertion portion of `_submit_async_operation` into a connection-taking helper instead of calling the public submit method on another connection. Alternatively persist a typed pending-submission intent in that transaction and let the existing maintenance loop repair it. The first option avoids an extra periodic repair path when the full payload is already known.
4. **Reuse native dedup safely.** A root may reference a shared pending task only if its exact requirements are durably attached before the task's claim/coverage boundary. Lock the same task row used by the worker claim; otherwise a claimed task may have already read its candidates. A processing consolidation cannot absorb an unproved new requirement. Bank equality and `deduplicated=true` are not coverage proofs. On retry suppression (`memory_engine.py:2509-2525`), retain/reassign unresolved requirements to the actual successor atomically; do not lose them when the failed task is superseded by another pending Bank job.
5. **Persist real logical outcomes.** At source marker/journal commit, record the native source versions actually consumed, completed scopes, action status and committed cursor. A per-source failure cannot inherit the enclosing task's `completed`. Native selected MM refreshes persist their result/cursor at `update_mental_model` publication; an empty/failed delta keeps the dependency failed/pending. Native no-new-content preservation can be success only with the real processed watermark and matching required source boundary.
6. **Close branch declarations durably.** Continuations and native MM selections are part of the source processing contract where applicable. Register successor task/dependencies before the preceding required work can be declared closed. Recovery after a crash must resume a persisted unsealed declaration, not rerun the original memory write. A final trigger selected before a crash must not be duplicated on replay.
7. **Finalize one completion receipt.** Under the existing replication Bank-state lock, verify the unchanged lineage/generation, a complete native result, all required logical work outcomes and sealed declarations. Read the commit-visible `current_cursor` and store it as `through_cursor` with the stable provider `native_receipt_hash` and separate `completion_id`/`completion_hash`. It must cover every contributing committed logical batch. Unrelated earlier commits may make this prefix larger; they never prove dependency completion. No fake logical object kind or empty journal batch is needed.

Use fixed-purpose typed records, not a general graph/workflow DSL. A small operation receipt table plus a logical-work association/outcome table is a defensible minimum; child/input preparation may require normalized rows rather than a giant mutable JSON blob (append report). Neither table should depend on terminal `async_operations` retention for identity or outcome survival.

Suggested internal types/signatures, deliberately proposals:

```python
class NativeOperationIdentity(BaseModel):
    kind: Literal["retain", "conditional_mutation"]
    operation_id: UUID
    bank_id: str
    provider_lineage: UUID
    bank_generation: UUID
    request_hash: str

class SourceWorkRef(BaseModel):
    memory_id: UUID
    input_revision: int
    input_payload_hash: str
    # Native scope data is typed and copied from the actual source/decision.

class LogicalWorkOutcome(BaseModel):
    work_id: UUID
    kind: Literal["source_consolidation", "mental_model_refresh"]
    status: Literal["pending", "succeeded", "not_required", "failed", "cancelled", "superseded"]
    native_operation_id: UUID | None
    through_cursor: int | None
    reason: ClosedLogicalWorkReason | None

async def record_native_commit(*, conn, identity, result_part,
                               maintenance_plan, journal_batch) -> NativeCommitRecord: ...
async def enqueue_native_work_with_conn(*, conn, task, associations) -> NativeTaskAdmission: ...
async def record_logical_work_outcome(*, conn, claim, outcome) -> None: ...
async def read_operation_evidence(*, bank_id, operation_id,
                                  expected_lineage, expected_generation,
                                  request_context) -> OperationEvidence: ...
```

Concrete constraints for the implementer:

- Engine methods authenticate and invoke the same Bank/operation validation hooks as native methods. The extension router only parses, delegates, and maps typed errors.
- Preserve lock order: replication Bank state before canonical document/source locks; task/receipt association locks must be documented and tested against native submit/claim/delete. No advisory locks; no LLM call inside the authoritative receipt transaction.
- A stale worker must not overwrite a newer attempt's work outcome. Bind work publication to a durable attempt/claim token; inspect the current native claim rather than assuming `execute_task` cannot outlive retry/cancellation. Existing `claimed_at`, `worker_id`, and retry state are available, but are not currently carried as a typed producer-proof token (`poller.py:540-557`).
- Operation failure/cancellation can coexist with already committed input parts. Preserve those receipts; never translate this into "the write was not applied."
- Source deletion, Bank replacement, policy changes and unsupported old rows are explicit outcomes, not `not_required` by absence. No automatic replay of an old untracked/pruned operation.

### Alternatives and rejected shortcuts

| Approach | Can prove | Cost / reason |
| --- | --- | --- |
| Client-only polling: read native operation, enumerate document/facts, call consolidate, poll all Bank jobs | Some currently visible native results in a serialized/quiescent deployment; receipt-first curation replay already proves native mutation result | Cannot close native-commit/enqueue crash window, missing/pruned identity, partial source failures, continuation/MM declaration, or operation causality. Explicitly insufficient for B5. |
| Durable observational receipts on existing native commits and queue/trigger branches | Stable native result, required-source outcome, actual selected refresh outcome, and journal fence; truthful pending/failed/deferred cases | Recommended baseline. No prompt/algorithm/source-selection rewrite. Requires durable associations and branch closure; under perpetual native deferral it remains pending. |
| Freeze a bounded source cohort and continue only that cohort on the existing queue | Can add stronger liveness independent of later Bank writes and seal MM selection at a cohort boundary | Changes batching/selection/trigger timing relative to the current native loop. It may change which facts share an LLM batch and when an automatic model is refreshed. Separate reviewed scheduling change; do not smuggle it into an evidence patch. |

Not acceptable: treating best-effort webhook delivery as a receipt; querying `consolidated_at` without source-version provenance; calling a private ANN repair to make a logical fence look stronger; declaring round-limit or no-new branches successful without recording what was actually evaluated; guessing task TTL; acknowledging a current-generation task against an old-generation native write.

### Meaningful RED/GREEN matrix

These are proposed deterministic tests, not executed results. Exercise real engine/transaction/worker seams with controlled extraction/consolidation responses; a mocked completion endpoint cannot prove the producer contract.

| RED scenario | Required GREEN evidence |
| --- | --- |
| Crash after native fact/curation journal commit but before post-commit notification | Durable result and task payload/repair intent already exist; restart enqueues/resumes only missing derived work, never reapplies native append/mutation. |
| Crash/rollback before native commit | No committed result, no work association, no cursor advance. |
| Shared pending consolidation and unrelated same-Bank writes | Exact affected source requirements link to the task; unrelated successes cannot discharge them. New writes do not enlarge a sealed operation's required identity set. |
| Dedup races task claim; transient retry suppressed by another pending job | No lost requirements; either attachment precedes coverage or a successor owns the outstanding work. |
| One source scope fails, other sources succeed, worker reports normal return | Only successful source obligations settle; failed source remains explicit. Independent roots can complete. |
| Round cap/continuation, interrupted trigger declaration, MM enqueue fails | Declaration remains unsealed/pending or failure is explicit; root cannot complete with an empty child list. Retry carries identities and does not repeat already committed logical work. |
| MM disabled, provider-none, zero eligible sources, no-action consolidation, automatic MM disabled | Record the actual native reason. No forced extra consolidation/refresh. Cron and private index work do not become recovery dependencies. |
| Concurrent source edit/invalidation/deletion during consolidation | Input version/payload mismatch cannot be credited as the required version's success; committed native receipt stays intact. |
| Worker dies after logical commit, before task completion; stale callback after a new claim | Stored outcome survives; exact claim/outcome CAS prevents false completion or overwriting current execution. |
| Native root/child operation rows are pruned or manually deleted | Stable result/work outcome remains readable; unresolved work is not inferred complete. |
| Completion fence races other Bank writes or Bank deletion/recreation | Fence is commit-visible and generation-bound; subsequent Taki publication still enforces Authority/Bank transaction guards. |
| Provider evidence says complete@C but second pull does not reach C | Taki stays awaiting pull; canonical data/FTS/checkpoint stay within the existing transactional publication contract. |

### Decision addendum: preferred finite root boundary

The leader clarified that finiteness in the presence of continual later Bank writes is already required. Therefore the observational-only alternative above is useful plumbing but **is not sufficient as the final delivered design** when automatic models are applicable.

Prefer **root-completion-triggered native MM declaration** over a bounded source cohort:

1. Register this root's exact native source/survivor requirements at their authoritative commits. Seal this source set only after every original input part has a terminal native result, so a later sub-batch of the same retain cannot introduce an untracked source. An unmodified source already consolidated before the write is not new work. Native processing still fetches, orders, groups and batches all eligible Bank sources exactly as today.
2. Native source-processing transactions record which input versions/scopes actually succeeded. When **all** sealed requirements for this root succeed (or have a native, explicitly allowed `not_required` decision), atomically persist `sources_complete@C_s` and enqueue a fixed-purpose root-finalization task/intention on the existing `async_operations` queue. The empty-set branch is explicit and follows the native disabled/no-new rules; it must not create an automatic model refresh that no native policy calls for.
3. At that root boundary, once only, evaluate eligible automatic models with the existing `refresh_after_consolidation` and native scope/staleness helpers. Use the root's actual processed-source tag/scope evidence, not caller-supplied tags. Persist the complete selected model IDs, model definition/scope hashes, required input boundary `C_s`, and a selection digest. Do this atomically with the native MM task associations and the declaration seal. Subsequent model creation or later unrelated source writes cannot expand the set.
4. Execute selected models through the unchanged `submit_async_refresh_mental_model` / `refresh_mental_model` / `_execute_mental_model_refresh` implementation. All enabled flags, filters, full/delta decisions and no-new-content/failure behavior remain native. Ordinary consolidation rounds and later scheduled work continue independently; the root does not wait for a Bank-wide final round or empty queue.
5. Coalesce model work only with proof: a pending compatible task can accept the root under the task-row/claim lock before its input cutoff is selected. A processing/completed task is reusable only if its **durably captured input journal boundary** is at least `C_s`, its lineage/generation and model definition/scope match, and its actual persisted outcome succeeds. A timestamp, model ID, `processing`, `deduplicated=true`, or `last_refreshed_at` alone is insufficient. Otherwise queue one successor for this root/definition requirement. Capture `input_through_cursor` in the same source-cutoff preparation as the native refresh; retain native `processed_watermark` as a separate semantic value.
6. On the last required model outcome, finalize `through_cursor >= C_s` under the Bank-state lock. If none was selected, the sealed empty-model decision permits completion at/after `C_s`. Later unrelated writes may advance the prefix, but never add dependencies. A selected model definition change, deletion, failure or cancellation is a typed unresolved outcome; it cannot be credited from a different model generation.

This yields a finite identity set:

`W(root) = sealed source-version/scope requirements + one sealed native-eligible model set`.

It does **not** mean a bounded wall-clock SLA through outages or repeated changes to the very same required source/model. Those remain real failure/retry/supersession cases. Continual later writes to other sources and recurring cron jobs are irrelevant to the closed set. No task-parent traversal or Bank-empty condition is used as the completion predicate.

Implementation can use one narrowly scoped typed finalizer task (or a durable intent handled by the existing maintenance loop); it performs only result/eligibility/queue bookkeeping, never an alternate semantic pipeline. Persist the wake/intention in the last-source transaction so a worker crash cannot strand a ready root. Prepare operation validation outside long write locks, then revalidate the selected model definitions and insert full task payloads plus associations in one short transaction. The existing queue owns retry/defer/worker execution. Automatic final-round MM submission can share this proof-aware coalescing helper; explicit manual refresh requests must retain their current on-demand behavior.

| Feasible implementation | Selection / timing impact | Decision |
| --- | --- | --- |
| Observational receipts only | No native timing change; root may wait for a never-reached final Bank round | Insufficient for the clarified finite-root requirement. Keep its durable receipt mechanisms. |
| Root-completion MM trigger on existing tasks | **Changes timing and potentially call frequency of automatic MM refresh for explicitly tracked operations**; does not change extraction or consolidation source fetch/batching/scopes | **Preferred smallest complete path.** Record and approve this scheduling effect in the design/patch ledger before dispatch. |
| Freeze source cohort / restrict native continuation fetch | Changes source cohort, batching opportunities and automatic refresh boundary; requires selector/store/continuation rewiring | Larger semantic/maintenance cost; not justified when the root trigger satisfies finiteness. |

Required additional RED/GREEN cases: continuously append unrelated Bank facts while the tracked root's own sources settle; show the ordinary consolidator still processes them while the root seals and completes its finite model set. Race two roots selecting the same model before claim, after an older cutoff, and after a sufficient cutoff; assert one covered invocation is reused and insufficient coverage receives a successor. Crash at `sources_complete` and between model selection and enqueue; prove the durable finalizer repairs declaration without native replay. Disable automatic MM policy and prove the root does not enable it or invoke a forced refresh.

The material choice remaining for the leader is explicit acceptance of this **opt-in trigger timing/call-frequency change**. Pure observation cannot both preserve the present final-round-only trigger timing and guarantee this stronger boundary under continual unrelated traffic. No prompt or semantic extraction/consolidation algorithm change is required by the preferred path.

## Related Specs and External References

- Taki `docs/adr/0009-single-memory-authority-with-local-replica.md:17,25,37,45`.
- Taki `.trellis/spec/backend/memory-replica-sync.md:215-342`, `database-guidelines.md:15-20,439-444`, `error-handling.md:14-29`, `quality-guidelines.md:75-121`.
- Taki `.trellis/spec/guides/source-grounding-guide.md` and `.trellis/workflow.md:345-379`.
- Hindsight `CLAUDE.md` and `.claude/skills/code-review/SKILL.md`: typed models, engine-owned auth/persistence, no advisory locks, migrations, backup and generated-client parity.
- No generic framework survey or online API reference was needed; native code is the source of the proposed seams. Public-contract, upgrade and offline-tooling details are in `implementation-footprint-and-upgrade.md`.

## Caveats / Not Found

- This report does not claim the proposed contract exists or has passed tests. No service, LLM, API request, user-data access, installation, Git operation, or production edit was performed.
- The source proves no stable operation-scoped logical completion API today. Existing CAS tests deliberately disable automatic consolidation (`tests/test_taki_conditional_curation.py:18-21`).
- Native scope/trigger fidelity is mandatory. Pure observation cannot preserve final-round-only MM timing and meet finite root completion under continual unrelated input. The decision addendum recommends the narrower opt-in root trigger, with its material timing/call-frequency change explicitly identified for design approval.
- B5's predicate must not be broadened to private index perfection, nor narrowed to source stamps while an applicable native logical trigger remains undeclared.
- `jbcontext search` was attempted once and returned a remote 404 / no results. Known-path reads and exact symbol searches supplied the cited evidence.
