# Research: Independent cutover evidence after G1

- Query: What minimum producer evidence and fencing can satisfy the independent B4/ADR cutover gate while preserving native maintenance and routine G1?
- Scope: internal; H:/hindsight producer and known Taki cutover contracts. Research only.
- Date: 2026-09-08
- Baseline: Hindsight package 0.9.0, leader-verified baseline 7eca2056. MemoryEngine is changing during the separate G1 implementation; use cited symbols as well as numeric anchors.
- Status: Completed source research and proposed contract; not implementation, acceptance, or a change to the accepted routine G1 design.

## Findings

### 1. Accepted requirement and recommendation

Use an explicit cutover run: freeze a finite candidate manifest, obtain actual native source/scope and model-input/outcome evidence, revalidate optimistically, and perform the final authority fence. Reuse the cursor-bound logical snapshot, canonical serializers, journal and task executor. Keep protocol/state in the compatibility module, with narrow hooks where only the native producer can supply proof.

The certificate means: the required native maintenance considered the selected input boundary, its actual outcomes are known, and corresponding logical state was published and reconciled. It does not prove semantic correctness of model prose, reconstruct every historical sentence, force every eligible fact into an LLM context, or establish a fixed point of mutually referring models.

| Accepted obligation | Required evidence / owner |
| --- | --- |
| G1 routine write | Exact native result and real local factual checkpoint; existing G1 implementation. No new derived wait. |
| Initial Local -> Hindsight | Complete current Local epoch manifest, immutable import/result mappings, required maintenance, verified target snapshot, final Local source revalidation and atomic promotion. B4. |
| Healthy Hindsight -> Local | Accepted work drained, required maintenance, final synchronization/reconciliation, zero Pending Memory, short fence and retirement of old authority. ADR 0009 planned-switch implementation; outside B4's stated scope. |
| Working Local destination | Complete canonical storage, retrieval, tools, maintenance, retention and projection, selected by authority. B6. |
| Real activation | Explicit live approval and separate live/manual acceptance. No activation occurred here. |

Sources: current task design section 7 (166-175), grill G1/remaining-review sections; B4 PRD 19-32, 62-77 and design 93-108; ADR 0009 paragraphs 47 and 51. Older B4 wording describes polling the import operation for derived completion. Bind this explicit cutover certificate there; G1's factual result is not that predicate.

### 2. Files found and source-backed gaps

Hindsight paths below are relative to hindsight-api-slim/hindsight_api. Consolidator/replication anchors describe the inspected baseline; MemoryEngine anchors are from the 2026-09-08 read.

| File / symbol | Observed pattern and consequence |
| --- | --- |
| engine/consolidation/consolidator.py::_fetch_unconsolidated_rows (1204), _mark_consolidation_sources_with_replication (1267-1352) | Selection lacks consumed revision; marker UPDATE uses IDs. Markers do not prove which version was processed. Marking advances revision without updated_at. |
| Same file::_resolve_obs_tags_list / _resolve_write_scopes (707-769), dispatcher (1530+, 1599) | Native scope expansion is reusable. Dispatcher groups by tags but obtains passes from sub_batch[0]; heterogeneous observation_scopes must not inherit the first source's coverage. |
| Same file::_process_memory_batch (2109-2434), _execute_update_action (2512), create/delete/dedup helpers (281, 429, 2764, 2806, 3171) | Stats are not committed outcomes: per_memory_updated is set even if update returns None (2308-2327). Existence filtering lacks version comparison. Short action/journal transactions are the useful seams. |
| engine/memory_engine.py::retry_failed_consolidation (current 8376) | Retrying changes markers/revision/updated_at. Raw revision inequality is not necessarily content drift. |
| MemoryEngine::_mental_model_refresh_cutoff / _mental_model_processed_watermark (13207-13262) | Separate reads of DB time and scoped MAX(updated_at), clamped to last_refreshed_at; neither is a commit cursor or immutable input manifest. |
| MemoryEngine::_execute_mental_model_refresh (13264+, especially 13310-13437) | Preserves authored delta content; lower window comes from last_refreshed_at. Actual definition/scope/window/input versions need witnesses. |
| Same method (13478-13497, 13608-13623), refresh_mental_model (13854-13868) | Historical based_on accumulates. supporting_facts is the current reflect-used set; empty supporting_facts skips delta and may advance watermark. It does not prove an empty eligible change set. |
| engine/search/retrieval.py (265-271, 350-354, 571-577) | Actual time predicates filter updated_at with strict bounds, despite created_after/before names. Watermark uses <= cutoff. Test equality and commit-straddling cases. |
| engine/reflect/prompts.py::STRUCTURED_DELTA_SYSTEM_PROMPT (581), build_structured_delta_prompt (728) | Native delta preserves earlier content; absence from new facts alone is not a reason to delete it. Deleted source evidence must not become a fabricated factual contradiction. |
| engine/replication.py::lock_replication_bank_state (376-402), append_logical_changes (1020-1099) | Existing Bank commit serialization and exact logical batch boundary. No durable cutover/retirement guard at these inspected seams. |
| engine/logical_snapshot.py::_load_snapshot_source (317-370), LogicalSnapshotService.create_snapshot (400+) | Cursor/canonical reads share one repeatable-read view and materialize immutable pages. Reuse them; transfer ZIPs do not preserve replica identity. |
| MemoryEngine::_submit_async_operation, submit_async_retain, _handle_file_convert_retain | Direct async admission owners, including conversion handoff. Their INSERTs need the same fence; guarding tracked G1 requests alone is insufficient. |
| extensions/builtin/taki_memory.py; engine/taki_compatibility.py::_probe_static_support (192-240) | Existing routing/module boundary and authenticated PostgreSQL SQL-row capability negotiation. Add an independent cutover capability. |
| extensions/bank_tables.py; engine/transfer/export.py::_OPERATIONAL_TABLES (78+) | Evidence/fence lifetime needs physical-backup, Bank-lifecycle and transfer classification. Portable transfer excludes replication lineage/cursors/receipts. |

Post-hooks, webhooks, task status, queue count, consolidated_at or model timestamps cannot close these gaps. Actual native producers must publish the missing evidence.

### 3. Finite manifests and proof records

Producer-enumerate the required set for every participating Bank. An arbitrary caller subset cannot certify a whole Bank. Initial import also binds the frozen current Local manifest and exact G1 import mappings. Source exclusions remain explicit authorized migration policy.

These names are proposals, not existing APIs:

| Typed artifact | Required fields / meaning |
| --- | --- |
| CutoverIdentity | Contract/hash version, run UUID, direction, authenticated coordinator, expected predecessor, candidate generation and CAS revision; provider lineage and ordered Bank/generation vector. Cursors are per Bank. |
| CandidateManifest | Full canonical snapshot reference/digest/counts, cursor vector, required-source/model-set digests, allowlisted effective-policy digest, explicit exclusions/not-required decisions. |
| SourceScopeInput | Source ID, captured native revision, versioned material-input digest, concrete resolved scope, lifecycle/survivor role and native policy. Cover source text/type/times/tags/scopes/provenance/entity inputs actually consumed. |
| SourceScopeOutcome | Input key, attempt/claim identity, actual actions/touched-object versions, journal boundaries, complete/no-op/failed/changed state and closed reason. Every declared scope must settle. |
| ModelInputBoundary | Model identity, definition/scope digest, authored baseline digest, requested/effective mode, actual filter/window, eligible manifest, retrieved/used witnesses, lifecycle delta manifest and reusable prior-proof reference. |
| CutoverCertificate | Sealed required outcomes, final full snapshot/reconciliation digest and cursor vector, policy/model/source manifest digests, plus source-fence receipt where required. Evidence identity and fence identity are distinct. |

Keep two hashes. The full canonical hash includes every logical replica field for lossless reconciliation. The material-input hash excludes only a versioned, explicit set of processing bookkeeping fields to classify maintenance input drift. Do not remove revision from replication, or broadly ignore updated_at: some paths change it with meaningful lifecycle work.

Capture source/model witnesses on a protected SQL view. Preserve observed revisions/material hashes and journal coverage through verification. Audit intervening changes to distinguish marker-only transitions from edits, delete/recreate and hash ABA. Equal endpoint hashes alone are insufficient. Missing/pruned interval means a fresh candidate/proof, not reconstructed history. Nonjournaled external policy needs a stable pin/version or an explicit unsupported result.

Native processing may include extra batch inputs, but each required source/scope needs proof. Later unrelated cron work is not attached forever. Relevant new sources/edits before seal cause catch-up or a new candidate, not a silent extension of an immutable certificate. The guarantee is safe bounded attempts, not completion under endless conflicting writes.

### 4. Source/scope proof through native maintenance

An old stamp is coverage_unproven. Reuse matching durable proof when available; otherwise explicitly verify selected current inputs using native _process_memory_batch/action helpers. Do not clear observations or reset every source merely to create evidence: clear_observations_for_memory deletes observations and resets co-sources.

The optional cutover proof context must:

1. Capture actual source and relevant recalled/target versions. Reuse native scope resolution, batching, prompts, dedup, caps and actions. Group the verifier by resolved scope specification as well as tags; the first-item shortcut cannot certify heterogeneous scopes.
2. Compare consumed source/target witnesses under the existing Bank lock in every relevant action transaction. A raced source or target prevents sealing. Record the actual writer outcome rather than aggregate counters.
3. Persist action outcome and actual journal boundary atomically with canonical writes. Legitimate no-op carries a reason and verified input boundary; it does not fabricate an empty logical batch.
4. Seal source/scope proof only after all required native branches/retries are accounted for. Missing input/target, failed or partial work stays explicit. Task completed does not discharge it.
5. Bind outcomes to attempt/claim identity. Persist enough typed plan/checkpoint data to recognize committed action replay after lost ACK. An interrupted pass may be reverified as a new native attempt, preserving earlier canonical commits and marking old evidence incomplete.

Native no-action, observation cap and security rejection can be known native decisions; they differ from SQL silently finding a vanished source/target. Observations disabled is not_required only under actual accepted policy captured for the candidate. Do not auto-enable features or turn errors into exclusions.

Observation create/update/delete, associations and survivor reconsolidation required by selected lifecycle work belong in the gate. Private ANN repair, graph quality, orphan sweeps, trace delivery and worker counters do not become logical-completeness requirements; keep their diagnostics truthful.

This is a verifier over native work, not a replacement consolidator or routine dependency graph. Verification can produce real native maintenance writes. Aborting migration preserves those valid writes rather than pretending verification was read-only.

### 5. Model proof and the one-time delta verification window

After source verification, freeze the relevant model set and inputs over the resulting logical boundary. Include actual query/definition, tags/match/groups, fact types, exclusions, authored baseline, mode and native limits. Capture directives/model references actually used. Do not impose a global fixed point or disable native model recall.

Distinguish eligible inputs, retrieved facts and used facts. Native relevance selection need not use every eligible fact. Prove the correct bounded domain and lifecycle signals were available to intended native processing and its actual result is known; counts alone cannot do this.

Timestamp bounds are insufficient for optimistic proof. Capture logical view/consumed versions, then validate relevant journal history and definition/baseline before publication. Material drift during multi-query refresh invalidates proof unless an explicitly consistent supported view covers it. Compare the target model in its update/journal transaction and write the outcome receipt there.

| Situation | Cutover disposition |
| --- | --- |
| Matching prior proof; no relevant input/definition/lifecycle change | Reuse with exact linkage; avoid unnecessary refresh. |
| Actual selected inputs, valid native output and persisted update | Complete, bound to final model hash/version and journal boundary. |
| Proven empty relevant change set with matching prior coverage | Native preserved/no-change may complete. |
| Empty supporting_facts but eligible work, missing baseline proof or unresolved lifecycle input | coverage_unproven; the no-new-facts branch cannot complete alone. |
| LLM/structured-output failure, all operations skipped, or required selected edits dropped | Failed/partial, retaining actual native evidence. |
| Definition/scope/baseline changed, model removed or facts edited during execution | Changed/stale candidate; rebuild boundary before retry. |
| Native mode fallback | Record requested/effective mode and reason; do not certify an unapproved different mode. |

For old authored delta content without usable coverage history, specify an explicit one-time cutover window over the selected current input boundary. Expand/remove only the lower bound as needed; preserve authored content, configured delta mode, native query, prompts and updater. Do not silently convert to full refresh or change automatic trigger timing. This creates current-input proof, not retroactive provenance for old prose.

Two additional seams are necessary:

- A None lower bound must not accidentally enter failed-delta fallback that writes a whole candidate. MemoryEngine::_execute_mental_model_refresh (current 13738-13777) refuses only when use_delta and not delta_applied and created_after is not None; otherwise the candidate can become content_written. Cutover verification must preserve the authored baseline on any failed delta, including the expanded window.
- Expansion sees live retrievable rows, not deleted/inactivated/out-of-scope predecessors. Compare scoped manifests and retained journal/tombstones; include events whose before OR after state intersects the relevant scope and affected historical grounding IDs. Historical based_on remains audit evidence, not proof the fact is still live.

Where lifecycle changes require model maintenance, pass typed lifecycle evidence through the native updater's input assembly and record that it was considered. This is an explicit cutover-only input extension, not an existing API. A tombstone is not a fabricated MemoryFact, a semantic contradiction or an instruction to erase authored prose. Preserve native edit policy and historical provenance. Empty supporting_facts must not bypass required lifecycle input. If a required lifecycle case cannot be represented/handled by the supported native updater, return lifecycle_coverage_unavailable and block the gate. A wider recall window alone does not solve it.

Deterministic tests prove input/window forwarding, version checks, actual persisted outcomes and refusal. They do not prove semantic prose correctness. No real-LLM acceptance is claimed here.

### 6. Durable producer fence and direction-specific boundary

A remote optimistic read cannot protect the network gap before Local SQLite promotion. Healthy Hindsight -> Local needs a durable producer fence, not only Taki's in-process queue.

Reuse replication_bank_state's per-Bank identity/lock for active / fenced / retired state, owning cutover ID and monotonic token. Fence state must survive task pruning and Bank-row deletion. Ordinary revive/import must not reopen a retired authority. Authorization is administrative and Bank-scoped.

Two guard sites are required:

- Admission: in the same transaction as native parent/child/full-payload admission, including untracked retain, consolidation, refresh, conversion handoff and other canonical-producing tasks. Do not acknowledge accepted work after fencing only to reject it later.
- Publication: every canonical writer, including already-running sync/async work, maintenance, curation, document/Bank/directive/model writes, import/restore and generation changes. Extend existing Bank-lock guards and audit bypasses; a router-only fence is insufficient.

No blanket background-worker bypass token. Evidence reads, private indexes and diagnostics can continue; new canonical work is refused/deferred with typed reasons. Already accepted unresolved work must settle before ready, not disappear. Future scheduled maintenance is deferred while fenced and cannot revive a retired branch.

Prepare expensive native work/manifests and most reconciliation before fencing. A bounded try-seal transaction locks Banks in deterministic order, compares expected lineage/generation/cursor vector and candidate/proof revisions, verifies required outcomes and accepted-work drain, then installs every source fence plus stable certificate atomically.

No LLM, network call, full hashing or long queue wait inside that transaction. Drift, new admission, busy writer or incomplete proof returns retry/busy with no partial fence. Queue emptiness is a quiescence check, not maintenance proof. An in-flight synchronous computation without a queue row can finish computing, but the commit guard blocks publication after sealing.

Initial support can be limited to Banks in one provider/tenant transaction. Cross-provider or cross-schema atomic sealing is unsupported until explicitly designed; sequential independent fences are not atomic. Retired Banks remain historical. Re-enabling Hindsight is a fresh migration with explicit identity/generation handling.

| Direction | Preparation and final boundary |
| --- | --- |
| Local -> Hindsight (B4) | Freeze current Local epoch; idempotently import current revisions; obtain mapping/maintenance proof; stage target cursor-bound snapshot and reconcile. Under final Local writer fence, recheck epoch/source fence/digest and persisted gates, then promote in one SQLite transaction. Drift restarts catch-up/verification. |
| Hindsight -> Local (planned switch) | Verify identity/health/drain; obtain maintenance proof; synchronize/reconcile and stage Local. Queue new Taki writes; try-seal all source Banks; match staged manifests/checkpoints to sealed vector; promote atomically in SQLite. Acknowledge/retire source fences and replay queued mutations once against Local. |

Initial activation uses historical provider proof through its stated cursor; it does not claim Hindsight was unchanged after capture. Hindsight is the destination and must not be retired. Exact destination equality at the later promotion instant would need a separately defined destination staging guard; the Local fence alone cannot promise it. Discovered generation/identity/relevant-state drift before activation invalidates B4 staging. Subsequent valid target-authority writes follow normal synchronization.

### 7. Minimum protocol, persistence and recovery

Proposed administrative extension methods share existing authentication, typed engine delegation and bounded responses:

- prepare_cutover: strict UUID/fingerprint, direction/predecessor/Bank vector and contract version; producer creates immutable candidate manifests.
- verify_cutover: resume under candidate/attempt CAS; pending / ready / blocked / stale with closed reasons and proof references.
- read_cutover plus paged evidence: immutable hashes/counts/order and stable replay; no memory text or credentials in status.
- try_seal_cutover: Hindsight-source only, expected candidate/cursor vector, atomically all fences or none.
- acknowledge_promotion / abort_cutover: idempotent expected-token transitions from the authenticated coordinator's durable decision. Provider records the acknowledgement; a supplied Local epoch string is not independent proof of SQLite commit.

Keep three persistence responsibilities: run/coordinator and candidate identity; typed source/scope/model/action outcomes with paged input manifests; durable Bank fence/retirement. Reuse logical snapshot pages when they are the exact artifact. Physical table packing is an implementation decision. Do not hide unbounded manifests in one status JSON. Negotiate measured caps before shipping and reject oversized envelopes rather than truncating.

Hindsight-source progression: preparing -> verifying -> ready -> fenced -> retired. Drift creates a new candidate version; partial/failed evidence remains inspectable. Local-source import uses ready plus activation acknowledgement without retiring destination Banks. Verification cancellation ends a candidate, not previously committed canonical work.

Taki durably binds run, predecessor epoch, fenced mutation queue, manifest/checkpoint vector, token and activation decision. One SQLite transaction writes new selection, predecessor closure, staged canonical snapshot/checkpoint and activation receipt. No network/filesystem/async operation occurs within it.

| Crash / race | Required recovery |
| --- | --- |
| Before remote seal commits | Ordinary authority remains; resume/rebuild candidate. |
| Seal committed, response lost | Read/replay same run/token; no unrelated replacement fence. |
| One Bank check fails | Entire supported seal transaction rolls back. |
| Fenced; Local promotion proved uncommitted; predecessor still selected | Persist local abort to exclude late promotion, then explicitly abort/unfence matching provider token. |
| Local promotion committed; retirement ACK lost | Startup selects Local from atomic receipt; retry retirement. Source stays fenced meanwhile. |
| Local outcome unknown, storage unavailable or evidence inconsistent | Stay fenced/reconciliation-required; no authority choice from timeout. |
| Abort races stale promoter/coordinator | Local CAS/terminal decision prevents both; provider token rejects stale transition. |
| Worker resumes after retirement | Reject canonical admission/publication despite old claim/request UUID; preserve diagnostics. |

TTL, heartbeat loss, restart or lease replacement must not reopen a possibly retired source. Page/snapshot expiry is separate from fence lifetime: retain recovery artifacts or rebuild from the still-fenced source. Physical backup preserves fence/evidence consistently. Portable transfer creates fresh identity and carries no operational proof. Independently restoring an old unfenced DB or direct SQL writes is outside this API fence guarantee.

### 8. Minimum implementation footprint and proposed checks

| Responsibility / seam | Minimum change |
| --- | --- |
| extensions/builtin/taki_memory.py + engine/taki_compatibility.py | Independent versioned capability/routes, strict bounds/authentication, engine delegation. |
| Focused cutover module + additive migration | Typed manifests/outcomes/CAS/resume/certificates, durable fence state; register backup/lifecycle/transfer and generated schema/client coverage. |
| consolidation/consolidator.py | Optional proof context at input selection, scope grouping, action/dedup transactions and source receipt seal; actual outcomes/version checks. |
| MemoryEngine model refresh/update + input assembly | Definition/baseline/window/input witnesses; explicit cutover window/lifecycle support; publication CAS/outcome receipt. Ordinary refresh unchanged. |
| replication.py + native admission owners | Durable guard at Bank lock/admission, all-or-none multi-Bank seal; audit Bank revival/deletion and all logical writers. |
| Existing logical_snapshot.py / journal | Reuse fixed-view pages/batches; modify only where connection reuse or evidence lifetime needs support. |
| B4 / planned-switch Core repositories; B6 integration | Persist exact consumer proof, atomic promotion and durable queued-write replay. Runtime readiness remains B6-owned. |

These are responsibilities, not proof that moving files into extensions removes fork maintenance. A sidecar cannot produce native commit/version evidence or stop native publication. No routine per-write derived graph, root-triggered MM refresh, scheduler replacement or atomic full-retain constraint is needed here.

Tests proposed, not run:

1. Source/version races: edit during LLM, marker-only revision, hash ABA, delete/recreate, target update race. No stale receipt seals.
2. Scope/outcomes: same tags/different observation_scopes, all native scope modes, partial LLM/action failure, missing target and real no-op/cap/disabled policy. Stats cannot manufacture completion.
3. Commit/restart: stop before/after canonical action, journal and receipt commit; lost ACK, repeated verify, stale attempt and task pruning. Preserve writes and prevent duplicate committed action replay.
4. Models: unproved delta baseline, zero-used versus zero-eligible, expanded window, strict time equality/straddling commit, definition/scope drift, failed expanded-window delta preserves authored content.
5. Lifecycle: deletion-only, invalidation/restore, scope entry/exit, historical based_on and relevant directives/model references. Missing lifecycle capability blocks; required skipped output remains partial.
6. Revalidation: bookkeeping versus material journal changes, pruned interval, missing/reordered/duplicate pages, tampered hash/count and bounds. No timestamp or endpoint-hash shortcut.
7. Fence coverage: tracked/untracked admission, conversion handoff, sync/worker publication, curation/import/Bank/model/directive writes. No post-fence canonical commit.
8. Multi-Bank/recovery: lock order, busy timeout, admission race, atomic seal, lost reply, Local pre/post-commit crash, abort/promotion race and unavailable Local DB. No TTL reopening or split authority.
9. B4: current-Local changes since B2, deterministic catch-up, final digest drift, zero/one/many mappings, stale predecessor/rollback. B2 evidence stays immutable.
10. Capability/lifetime/privacy: unsupported dialect/store/topology/policy pin, restore/generation change, fence survival, operator authorization, safe diagnostics and SDK/OpenAPI parity. Verify B6 runtime separately.

Use isolated PostgreSQL at actual native transactions and transport-faithful Core-to-SQLite tests with controlled LLM/embedding fixtures. These prove mechanisms, not model-quality acceptance. No current user database, real LLM or protected migration backup is needed.

## Related Specs and External References

- Current task: design.md section 7, implement.md, grill.md; frozen research/g1-native-result-protocol.md. Earlier strict per-operation proposals are historical, not selected G1.
- B4: .trellis/tasks/08-09-hindsight-initial-cutover/{prd,design,implement}.md, especially current Local coverage.
- docs/adr/0009-single-memory-authority-with-local-replica.md:47,51.
- .trellis/spec/backend/index.md, database-guidelines.md (short promotion/CAS), memory-replica-sync.md (G1 amendment/factual checkpoint), .trellis/spec/guides/source-grounding-guide.md.
- Hindsight AGENTS.md / CLAUDE.md: typed engine-owned boundaries, migration shape and generated clients. Current replication support is authenticated PostgreSQL SQL-row authority, not Oracle/alternative stores.
- External references: none needed; local source supplies version/behavior evidence. Historical memory was used only for context location/live-verification boundaries, not proof of this proposed contract.

## Caveats / Not Found

- No complete existing cutover certificate, consumed-source-version proof, lifecycle-aware model proof or durable all-writer source fence was found at the inspected seams.
- Verification window/lifecycle input and source fence are proposed behavior, requiring separate implementation/review. This does not pass B4, B6, planned-switch or live acceptance.
- Snapshot-prefix proof is not exact destination equality at later network-separated promotion. Unsupported lifecycle/history/policy/topology cases remain blocked.
- Ordinary G1 remains native-result plus factual-checkpoint confirmation, with asynchronous native maintenance, and belongs to the separate implementer.
- Only this report was written. No source/test/spec edits, Git operations, installs, services, live API/LLM calls, current user-data reads or protected backup access occurred.
