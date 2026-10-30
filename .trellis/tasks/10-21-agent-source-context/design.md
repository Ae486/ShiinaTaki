# Source context and prompt design

Status: the shared contract and Runtime ports were released, and Source's S4 adapter plus S5/S6 projection/Memory implementation now have scoped deterministic/static evidence in [the implementation handoff](research/s5-s6-implementation.md). The owner requested pause after the current tests. Source semantic A1-A3 calls were not started; live/native/human acceptance and overall child completion remain open. The S4 subsection below preserves the original independently released storage checkpoint.

## First S4 subset

The optional source sidecar and its existing publication/Timeline consumers do not depend on unfinished child dispatch. Implement candidate/staged equality, atomic speech-plus-source persistence, legacy null reads and retention of S1 tool-result `sourceMaterials` before connecting new source producers. This preserves the reviewed contract and is not complete source-feature acceptance.

Exclusive source ownership for this subset is Shared `prepared-publication-schema.ts`, `initiative-schema.ts`, `timeline-schema.ts`; Core `db/timeline-repo.ts`, `db/run-delivery-repo.ts`, T4-local migration 057 and necessary registry/test mirrors; `delivery/prepared-publication-source.ts`, `delivery/prepared-publication.ts`; and only the `ConversationStore.appendDelivery` signature/writer plus source-material sanitation. Runtime keeps Shared barrel, ChatAgent, RunService, main composition and new delegation/governance protocols. Coordinate any further file transfer before editing.

The local registry has no duplicate 057, but current `main` has a pre-existing different 049–059 lineage. Follow the accepted [migration scope review](../10-21-agent-delegation-source-context/research/current-main-migration-scope.md): T4 functionality may proceed; main merge/release compatibility requires a separately coordinated higher guarded convergence. Do not describe local checks as cross-branch collision clearance.

Capture working-tree preimages after S1 review, including changed migration expectations. Preserve pre-S5 projection/prompt code as the source-comparison baseline. No producer may infer trusted sources from model-authored labels, and no private child transcript gains Memory eligibility.

## Shared implementation contract

Use the reviewed [joint Runtime/source contract](../10-21-agent-delegation-source-context/research/joint-runtime-source-contract.md), particularly sections 8-10, 13.1-13.2 and S4-S6. It incorporates the [independent review](../10-21-agent-delegation-source-context/research/joint-contract-review.md), program-known tool-acquired material sources and the exact Co-Watching adapter. Runtime S1 owns the common schemas/private records; transfer ownership before changing Shared/DB/ChatAgent boundaries. The approved SDK cancellation policy is the implementation baseline.

The owner's R14/AC11 clarification keeps Subagents read-only Memory consumers. This child's source/prompt work must preserve that execution boundary and unchanged original-primary eligibility; child suggestions are result data for the main Companion, not an automatic mutation request. Reuse task/role instructions and the existing effective-tool projection rather than adding a parallel role/Memory permission framework.

## Evidence-first design sequence

Use [source/prompt research](../10-21-agent-delegation-source-context/research/source-context-prompts.md). Reuse official native role/tool framing and explicit material boundaries. Inspect actual input at each consumer before choosing any additional format; a JSON storage structure need not be the model-facing text. Keep comparisons bounded to candidates supported by the inspected API/use case.

## Known loss points and required mapping

1. Material and selected child input: retain known source identity/reference and its association with supplied material without full-history copying.
2. Child result and publication candidate: preserve material origin plus generation origin when private source-aware work becomes a bounded result or planned speech.
3. Delivery/Timeline projection: reuse existing durable delivery/Run/Timeline linkage and add only missing descriptive evidence needed later. Do not rewrite historical conversation content for context management.
4. Replay and compaction: project source distinctions into the actual model input and compactor transcript. Summaries must not promote inferred or external first-person content into user facts.
5. Memory: inspect original-primary gate/extraction, Local maintenance/use and native provider stages independently. Canonical memory reads exact eligible original primary sources in parallel with replay/compaction; it does not ingest the resulting summaries or non-primary publication. Do not admit raw child/video material to force a sequential chain. Existing source exclusion does not remove the need to interpret eligible dialogue accurately. If a primary reply already lost attribution, repair upstream generation or retain uncertainty instead of fabricating a recoverable subject.

Before editing, record a field/consumer table with nullability, retention lifetime, revision/deletion handling and restart behavior. Durable model-readable meaning cannot depend solely on digests, ephemeral sessions or an unreconstructable current-plan file.

## Prompt responsibilities

Shared instructions explain role versus source, quotation, incomplete/unknown attribution and the distinction between external stories and explicit user statements. Stage-specific instructions cover description, response, summary and memory operations without contradictory rules. External material remains data through existing fencing. Do not insert trusted policy text from a material's own instructions.

## Evaluation

Capture actual provider-bound requests using existing test seams and deterministic models/transports. Check context plumbing without calling a model. Later authorized live trials compare a baseline and a bounded candidate on identical scenarios/settings, with repeated ambiguous cases and preserved outputs. Judge unsupported attribution separately from fluency. Choose representation based on correctness plus token/complexity costs; official recommendations alone do not count as Taki effectiveness.

## Compatibility

Use additive metadata where necessary; derive replay without changing the canonical speech or expanding memory admission. Current source links should be reused when sufficient. Legacy rows with missing evidence remain readable and explicitly unattributed. Revision/source retirement and deletion must not resurrect stale content. Rollback must preserve accepted speech and existing memory truth.
