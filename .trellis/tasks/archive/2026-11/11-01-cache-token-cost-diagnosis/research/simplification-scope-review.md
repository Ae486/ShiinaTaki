# Independent simplification scope review

Date: 2026-11-01. Scope: design and effort assessment only. No production, configuration, live-data, or paid-model changes were performed.

## Judgment

The useful simplification is a bounded cross-layer change, not a rewrite and not a two-line removal of a safety check. Preserve source truth at the Timeline owner, reuse the existing provider processing journals, and let context compaction progress independently of completed memory extraction. The primary engineering cost is compatibility and crash/cancellation validation, rather than the amount of new production logic.

Do not move the current provider callback unchanged into the chat transaction. Local recording validates the currently active authority (`db/canonical-ingestion-source-repo.ts:70-90`); Hindsight recording additionally passes `runtime.assertConnection()` (`memory/hindsight/hindsight-memory-subsystem.ts:74-76`). Those failures must not roll back otherwise valid chat. The current callback catches and logs failures, which also cannot provide atomicity if simply invoked inside an outer transaction.

## Verified seams

- User append precedes execution at `agents/chat-agent.ts:230`. Response persistence is `:296`, followed by the separate witness callback at `:303`. Cancellation can retract the input at `:291-294`; retained partial/error output still reaches source recording.
- `agents/conversation-store.ts:123-127` owns ordinary appends; `:145-148` separates autonomous delivery and primary user writes. `agents/conversation-turn-writer.ts:29-39` owns response batches. `db/timeline-repo.ts:120-138` already offers synchronous atomic batches. `db/sqlite.ts:96-123` supports nested transactions and after-commit notification frames.
- `agents/turn-recording.ts:56-75` captures only actual completed response messages and uncovered partial text. The source change must preserve its retry and partial-output behavior.
- Admission already carries `AgentRunContext.memorySnapshot` (`agents/chat-agent.ts:97-100`), plus Run/Attempt IDs. This is sufficient descriptive binding input; recording it must not perform a new provider capability/connection check.
- Autonomous speech uses `delivery/delivery-coordinator.ts:132` and `db/run-delivery-repo.ts:153-160`. It can have no `sourceContext`. `shared/context-source-schema.ts:20-26` therefore cannot serve as complete primary-origin metadata.
- Local and Hindsight have separate primary-commit tables and immutable processing journals. Hindsight explicitly checks previous Local occurrences (`db/hindsight-ingestion-source-repo.ts:73-83`). `db/primary-memory-source-read.ts:24-43` expects at most one provider binding and follows the original claimed source. Removing these tables is a separate, unnecessary migration project.
- `memory/auto-memory.ts:129-141` awaits provider maintenance, including tidy, before compaction. `agents/compaction-coordinator.ts:155-161` then forces another memory flush before summary generation. Both dependencies must change to make compaction independent.
- Summary commit writes `conversation_summary` and compaction operation state (`db/compaction-operation-repo.ts:214-246`), not Timeline deletion. Local retention targets memory records (`memory/canonical-local-retention.ts:23-30`). The current ordinary Timeline deletion path is cancel-retract.
- Provider work is already selected by absent span assignment, independently of summary coverage. Existing tests cover late positive source commits before a covered cursor (`memory/canonical-local-ingestion.test.ts:353-385`). This supports reuse rather than a new queue framework.

Paths above are relative to `packages/core/src`, except `shared/...`, which means `packages/shared/src`.

## Alternatives

| Design | Benefit | Cost / limit | Assessment |
| --- | --- | --- | --- |
| Put existing provider witness writes inside chat persistence | Few apparent call-site changes | Couples chat success to provider/epoch availability; early user witnessing conflicts with cancellation and immutable final commit boundaries; still needs crash linkage | Reject the unchanged callback approach |
| Retain provider tables, split their local source-capture logic from provider checks | Less new schema if lifecycle fields are added to each table | Duplicates lifecycle across Local/Hindsight; current tables require epoch ownership and sealed commit boundaries; changing them affects existing immutable proofs and cross-provider history | Viable but probably not the smaller maintained design |
| Add minimal provider-neutral Timeline source metadata; keep provider tables as asynchronous binding/processing records | One local source owner; no provider call in chat transaction; deterministic recovery; preserves receipt compatibility | One additive schema change and small importer/reconciliation path; both providers need the adapter | Preferred |

Provider-neutral capture does not mean provider-agnostic consumption. Store the admission-captured memory selection as descriptive metadata, and validate it when the existing provider worker binds the source. Never silently move unfinished old-epoch work into a newly selected provider.

## Smallest viable preferred contract

Use one local source lifecycle representation, not a general event/outbox/workflow framework. A practical schema is one small primary-conversation source table plus a nullable source ID on Timeline members, introduced by one additive migration. Equivalent compact storage is acceptable if it preserves the same invariants.

The source record needs a locally generated stable source/turn ID, Character, available Run/Attempt binding, admission memory selection, an open/retained/retracted disposition, and a terminal through-sequence set once. Timeline membership is recorded with the original rows, not reconstructed by a numeric range. A terminal reason can distinguish interrupted or partial retention without pretending that a complete answer exists. These are proposed storage semantics, not a finalized public protocol.

Make source identity, membership, and captured binding immutable; only the open-to-terminal transition is mutable, and only once. Continue exact row digest verification when binding or consuming. This avoids creating an editable origin label that could authorize changed content.

1. **Begin:** In one local transaction, create the open source and append/link the actual user row. No provider availability check or model call. An open source is not yet extractable, because the current cancellation contract can still retract its input.
2. **Retain:** Commit the actual response tail and seal the source in the same transaction. Include only exact committed members. Error/partial endings retain actual text; no synthetic completion or tool output. Reuse the same source identity across the supported model retry; do not derive a new occurrence from each Attempt.
3. **Retract:** If the existing no-output/no-independent-work cancellation predicate holds, delete the user row and mark the source retracted atomically. No provider source binding should have been created while it was open.
4. **Crash:** Before new dispatch, reconcile only source records left open by the previous process. A remaining linked user row is a retained interrupted input, not evidence of a model response or effect outcome. Because response append and source seal are atomic, there is no new committed response tail requiring a guessed completion boundary. Keep general Run/effect uncertainty separate from this narrow source closure.
5. **Consume:** A bounded scan finds retained, not-yet-bound sources for the selected captured authority. Reconstruct exact `TimelineEntry[]` from membership, verify identity/digest, and invoke the existing provider binding/processing path. Persist the provider witness once with its final `committedThroughSeq`. Repeated scans become exact no-ops; mismatches remain errors.
6. **Recover provider outages:** Failure to bind or process a retained source leaves the local source discoverable. Startup and later normal maintenance retry the same source identity. An explicit unavailable/old-epoch state is not a successful skip. No external queue, duplicated raw transcript, automatic model replay, or new autonomous worker platform is needed.

Only local integrity/storage errors should fail this chat transaction. Valid chat must survive memory connection, capability, model, or current-authority errors. Publish Timeline notifications only after the outer transaction commits; the existing `afterCommit` facility can support this without a new notification subsystem.

## Preserve existing evidence and remove redundant gates

- Keep old provider primary commits, source digests, claimed spans, request identities, native pending writes, and receipts unchanged. Do not rewrite old `committedThroughSeq` to accommodate incremental capture. New source metadata is the missing durable producer fact; it is not permission to edit historical proofs.
- Do not insert both a Local and Hindsight provider witness for the same occurrence. Preserve the existing completed historical occurrence check and old-epoch drain/refusal rules.
- New trusted sources should not require the post-turn, best-effort `onPrimaryCommitted` callback. Remove that callback from the production path once the source owner and asynchronous binding are wired.
- Remove the historical role-based hole scan from source selection and exact-source claim verification. Those operations should validate the selected exact source and its membership. Keep truthful coverage separate: completed selected work can coexist with an unresolved older hole; do not advance a contiguous completed-coverage watermark across that hole.
- Separate processing progress from coverage advancement in the run result. Today `runRange` calls `advanceCoverage` after draining and can throw after actual writes (`memory/canonical-local-ingestion.ts:81-85`). A later source successfully processed with an older unresolved gap must report that progress and the coverage gap, rather than reporting the entire pass as either complete coverage or an undifferentiated failure.
- Avoid concatenating evidence on both sides of an unresolved hole as if it were one continuous conversation. Prefer closed source groups and an explicit gap boundary. Any context carried across a source boundary is interpretation context, not a new claimed occurrence. This is a small extraction-input contract, not a need for one new model call per message.
- Retain baseline semantics for historical unknown rows. Do not bulk-tag all old `role=user` rows during migration. Existing positive provider witnesses remain readable through compatibility code; unproven old holes remain a separately reportable repair item.

## Compaction independence

Compaction should retain its source snapshot/digest validation, lease, summary quality checks, cancellation, and summary CAS. It should stop awaiting successful memory extraction as a precondition, because raw Timeline and independent source/processing state remain durable.

Two current pieces must be simplified together:

1. Remove the `flushRetiringSpan` dependency from canonical Local/Hindsight summary generation and its flush-only result plumbing. Preserve historical `flush_completed` operation events as history; do not generate a fake successful flush for new summaries. If the operation API needs lease renewal, name and implement it as lease renewal.
2. Trigger provider maintenance and compaction independently rather than placing compact behind the entire provider/tidy promise chain. Reuse their existing serialization and shared Utility Slot. This is independent eligibility and failure handling, not a requirement for concurrent paid calls or a second model slot. A hung provider network operation outside the Utility Slot should not withhold an otherwise eligible compaction trigger.

The summary prompt currently says permanent names/preferences/boundaries belong to long-term memory and may be dropped (`agents/compaction-pass.ts:71-73`), and says the summary is the only surviving record (`:95-96`). Those assumptions must be removed. The smallest safe prompt contract is to preserve salient durable facts and currently relevant constraints in the compact summary without asserting they have already been extracted. Do not add a new per-fact coverage service merely to avoid this limited duplication. The cost is some summary tokens; the benefit is avoiding a retrieval gap while ingestion is delayed.

Existing emergency context cuts already drop unretired text (`agents/conversation-store.ts:225-229`), so blocking compaction does not guarantee context continuity. Independent compaction is a meaningful improvement even while a historical gap remains unresolved. Raw-data deletion, if ever introduced, would need its own eligibility/retention contract and is outside this change.

Legacy Markdown still has a different processing model in `memory/auto-memory.ts` and `memory/memory-flush-port.ts`. Do not claim Legacy crash-safe processing was upgraded by this design. Prefer an explicit Legacy compatibility branch preserving its extraction behavior for this bounded change; canonical Local and Hindsight should share the new durable-source contract. Removing all Legacy flush code would widen scope unnecessarily.

## Grounded effort envelope

This is a medium change within an existing subsystem. It should not require a new dependency, service, framework, public UI, or provider protocol. The plausible complete scope is approximately **18-26 production/schema wiring files**, **10-16 focused test/fixture files**, and **3-6 existing spec/index documents**. These are review-planning ranges, not a line-count or time commitment. Do not expand edits merely to match a range.

| Area | Likely files / seams | Expected nature |
| --- | --- | --- |
| Local source persistence | `timeline-repo.ts`; one new small source repo; one additive migration; migration registration | New durable producer fact and exact membership; no transcript copy |
| Chat write ownership | `conversation-store.ts`, `conversation-turn-writer.ts`, `turn-recording.ts`, `chat-agent.ts`, `main.ts` | Pass captured identity, atomic retain/retract, after-commit publication, remove best-effort source callback |
| Narrow boot recovery | source repo plus boot/recovery composition | Close previous-process open sources without settling model/tool effects |
| Provider binding and processing | Local/Hindsight source repos and ingestion modules; both subsystem compositions; shared ingestion-source contract | Reuse existing journals/receipts, deterministic source import, remove global hole dependency from exact-source selection |
| Independent compaction | `auto-memory.ts`, `runtime-composition.ts`, `compaction-coordinator.ts`, `compaction-pass.ts`, possibly `compaction-operation-repo.ts` | Remove flush-before-summary dependency, independent triggering, truthful events and prompt |
| Compatibility readers | `primary-memory-source-read.ts` / `primary-memory-source-state.ts` | Prefer unchanged provider-table contract; edit only if required by observed unbound-source state semantics |

One additive migration should be sufficient for the preferred source table/membership design. A second migration is justified only if existing operation-event schema constraints require a new event vocabulary; deleting a gate alone does not justify rewriting schema or historical rows. Current migration numbers must be selected against the live task branch when implementation starts.

The estimate excludes broad memory redesign, new admin screens, a historical source repair service, real provider catch-up, and unrelated cache/prompt-cost optimizations. Replacing both provider journals with a unified queue would substantially enlarge the scope and is not recommended.

### Recommended delivery batches

| Batch | Concrete outcome | Plausible scope |
| --- | --- | --- |
| 1. Compaction, scheduling, prompt decoupling | Canonical Local/Hindsight memory delay or failure no longer prevents eligible context summary; summary preserves salient facts without assuming extraction already completed | About 5-7 production files, 4-6 test files, and 2-3 existing contract documents; no source-data migration should be necessary |
| 2. Atomic local origin and existing-journal recovery | Future primary rows have durable identity/lifecycle; crash closure and repeated provider binding are deterministic; existing provider receipt consumers remain compatible | About 13-19 production/schema wiring files and 6-10 test/fixture files, with overlap in composition/spec files from batch 1; one additive source migration expected |
| 3. Historical repair preview | Exact gap inventory, defensible candidate classification, proposed mutations and catch-up volume; no apply in the preview | A bounded read-only diagnostic or task artifact; live-data apply and fee-consuming catch-up are separate authorization/execution steps |

Batch ranges are not additive distinct-file guarantees because composition and tests overlap. Batch 1 is independently useful and should land first. It does not repair missing memory witnesses or establish backlog completion; report that boundary explicitly instead of presenting it as a full ingestion fix.

### Decisions to settle before their implementation batch

- **Source storage shape:** one lifecycle table plus Timeline membership is the recommendation; field names, nullability for primary-compatible callers without a Run, and migration trigger details remain implementation design work. Avoid exporting this internal schema through the shared public Timeline API without a consumer need.
- **Interrupted input:** the recommendation is to retain the actual durable user row as an interrupted source when no explicit retract committed. This does not settle the Run/effect or invent assistant output. Document this source-specific behavior and verify it against the product's cancel/independent-work cases before finalizing batch 2.
- **Legacy compatibility:** batch 1 should explicitly preserve Legacy extraction behavior while decoupling canonical Local/Hindsight. Decide the narrow composition branch; do not accidentally claim all providers gained durable recovery.
- **Retry trigger versus paid catch-up:** startup source closure/import can be DB-only. Select a bounded retry trigger for already authorized routine maintenance; a historical catch-up campaign and new paid quality probes remain separate work. Do not launch either as a migration side effect.
- **Summary quality:** preserving salient facts during delayed extraction is the recommended small prompt change. Its quantitative token tradeoff and real-model quality are not established by this read-only review; deterministic tests can validate wiring and content requirements, not prove a savings percentage.

These are bounded choices within the proposed architecture, not reasons for further broad exploration. No new production implementation is authorized by this review document alone.

## Minimum meaningful verification

- Crash cuts: before initial commit; after user/source commit; during response/seal transaction; after seal before asynchronous provider binding. Reopen SQLite and show exact retained/retracted membership, not just an in-process callback result.
- Existing cancellation cases: no output retracts; actual partial text survives; accepted independent work preserves its real input; iterator close and exception endings preserve their existing behavior; retry does not duplicate the user occurrence.
- Provider outage/authority drift: valid chat/source commit succeeds while binding remains pending or explicitly unavailable; recovery does not silently select a new epoch/provider. Existing Local-to-Hindsight completed occurrence checks remain valid.
- Repeated source import and model/provider retry do not change sealed boundaries or repeat confirmed writes. Existing receipt/digest tamper refusals remain.
- Older unknown source holes do not suppress later eligible source processing or compaction; contiguous ingestion coverage remains behind the hole. Extraction input preserves gap/subject boundaries.
- Block or fail Local/Hindsight ingestion and prove summary still commits with raw Timeline unchanged. Ensure provider/tidy waiting is not still a hidden scheduling dependency. Check shutdown settles both triggered branches.
- Summary prompt regression for name/preference/hard boundary retention while memory is delayed; static prompt checks and deterministic mocks establish wiring only. A paid model quality probe or manual product acceptance needs its own authorization/evidence.
- Apply the additive migration to a realistic prior schema with existing Local/Hindsight proofs, reopen, and verify proof/receipt bytes and source currentness compatibility. Run targeted project lint/type/tests once implementation exists.

## Separate historical repair and operating cost

The three observed historical user gaps cannot acquire a trustworthy Run binding from this forward-looking migration. Historical repair is a separate, reviewed read-only inventory followed by an explicitly authorized data operation using defensible evidence. Do not erase the gap by moving baselines or classifying missing rows as irrelevant.

Likewise, making pending work recoverable does not make backlog extraction free. Catch-up uses the configured Utility Slot and may invoke Local extraction models or Hindsight retain processing. Its count, provider, batch policy, and fee authorization should be assessed separately before triggering it. A compile/test-only implementation does not authorize live catch-up. No fee estimate or guaranteed savings percentage is established by this review.

Expected cost improvement comes chiefly from reducing repeated oversized chat context and enabling useful summaries while memory processing is delayed. The observed flush failures occurred before summary model dispatch, so eliminating those local failures must not be counted as eliminating paid summary calls. Ongoing memory extraction remains real work. The design removes the global gate and post-turn proof fragility; it does not add layers solely to hide those problems.

## Approved implementation: batch 2 contract challenge

The owner subsequently approved implementation. This addendum challenges the exact source contract before production source edits; the reviewer still owns no production files. The proposed `primary_conversation_sources` table plus nullable `timeline_messages.primary_source_id` membership is sufficient. A separate process-generation column is unnecessary under the verified single-writer boot topology: `main.ts:428-430` completes recovery before trigger dispatch registration, and the WebSocket server starts later at approximately `:719`. Call source recovery once at that boot barrier, before any new primary source can open; do not expose this boot-only operation as a live retry RPC.

### Small repository boundary

Prefer one internal DB repository with operations equivalent to:

```ts
beginPrimary({ sourceId, userInput, runId?, memorySnapshot? }): { sourceId, userEntry };
retainPrimary({ sourceId, responseInputs, terminalReason }): TimelineEntry[];
retractPrimary({ sourceId }): void;
recoverOpen(): { retained: number; unresolved: Array<{ sourceId: string; code: string }> };
readRetained(sourceId): ExactRetainedPrimarySource;
listUnbound(capturedScope, limit): string[];
```

These are internal contract sketches, not required public names. Let the repository own its transaction and reuse Timeline row preparation/insertion; pass prepared `AppendInput` shapes from the existing conversation writer, not AI SDK types into DB code. A narrow linked-batch seam in `TimelineRepo` is sufficient. Avoid a generic transaction callback API that lets consumers link arbitrary rows or seal after a detached observer. ConversationStore remains the notification owner and schedules notifications through `db.afterCommit` so outer rollback publishes nothing. The retained-source reader should return verified exact members to both provider importers, keeping SQL and integrity rules in one place.

### Required integrity details

- Freeze source ID, Character, original user ID/digest, available Run identity, and the admission-captured `RunMemoryReference`. Treat the memory snapshot as descriptive capture; do not call the provider or assert current authority while committing chat.
- Compute the seal over the complete ordered member set, for example ordered tuples of `{seq, id, entryDigest}`. Derive `throughSeq` from that exact set. A user digest plus maximum sequence alone does not detect an omitted/replaced middle response row. The reader must recompute and compare the whole set before provider binding.
- Exactly one original user member must match the stored initial identity/digest. Other committed members are the actual assistant/tool response rows. Validate Character and source membership for every row. `sourceContext` remains interpretation metadata and never establishes membership.
- Membership cannot be changed, detached, or appended after the source is sealed. A nullable membership column must not become a way to attach a historical ordinary row later. Enforce the invariant at the repository boundary and use the additive migration's small immutable/closed-source triggers where appropriate. Existing row digest verification continues to catch content changes.
- Preserve the retracted source record even after deleting its user row. An unconditional foreign key from source.original_user_id to Timeline with RESTRICT or CASCADE would respectively break retract or erase its factual disposition; design that reference accordingly. The Timeline-to-source membership foreign key can remain strict.
- `retainPrimary` validates before inserting a response. A repeated call after sealing must either return the existing exact members for an identical request or reject a conflicting request; it must never append another response tail. Repeated retract is an exact no-op; retain-after-retract and retract-after-retain are conflicts. The in-process `TurnRecording.committed` guard is useful but is not the durable duplicate check.
- The source identity belongs to the original input, not the Attempt. Keep it across overflow retry, including when `turn.onRetry` changes `attemptId`. An original Attempt field, if retained, must not be overwritten to manufacture a new source occurrence.
- The initial append currently precedes fallback `deps.runContext()` capture (`chat-agent.ts:230-234`). Capture the available immutable Run memory reference before calling `beginPrimary`; if an explicitly supported caller has none, persist truthful absence rather than choosing the current provider later. Preserve proper resource disposal if the initial transaction fails.

### Recovery and consumers

For an open source, boot recovery must verify the exact original user row and inspect the complete membership before sealing it as interrupted. Under the proposed atomic response-plus-seal protocol, a normal crash leaves only the original user. Missing/changed user data or unexpected additional members is an unresolved integrity case, not permission to discard members or invent an answer. Keep a bounded per-source diagnostic or explicit unresolved status; continue processing other retained sources. General Run/effect state remains untouched.

Use the existing provider tables for durable ownership and processing state. One exact source is imported into at most one provider occurrence; existing Local/Hindsight history checks remain authoritative. Read an existing binding before inserting, compare exact IDs/digests/final boundary and captured authority, and preserve old-epoch refusal/drain rules. A source import may stop with a clear reason, but source capture and unrelated imports continue. Never widen eligibility by scanning old `role='user'` rows.

No additional event framework, provider-backed chat transaction, process-generation column, or per-message model call is needed. The concrete missing pieces to cover in tests are middle-member omission, closed-source append, durable duplicate seal, retract tombstone survival, fallback Run-context capture failure, and corrupt-open-source isolation. The architecture is ready for implementation with these constraints.
