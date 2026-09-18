# Research: D77 Taki Policy and Runtime Implementation Plan

- Query: Complete the accepted B6 engineering design for neutral recall, exact-version Taki policy, native hydration, runtime composition and narrow maintenance.
- Scope: Internal source/contract review in H:/TakiAgent. Native application-state API/storage is a separate research assignment.
- Date: 2026-09-11
- Status: Actionable proposal for the leader's final design; no production implementation, service/model execution or Git operation.

## Findings

### 1. Decision authority and exact scope

The task's current grill.md supersedes the old unresolved-question wording in the historical D77 gap report. The owner
accepted searchable neutral policy for confirmed, valid, correctly owned native content and authorized B6/D77 design and
implementation. Detailed model assessment is asynchronous. Invalid ownership, native identity/version, lifecycle or
application binding is a refusal, not a neutral fallback.

The session-scoped task was verified with task.py current --source using the supplied TRELLIS_CONTEXT_ID. The global
.trellis/.current-task is empty; the authoritative session resolves this existing task. No new task or owner question is
needed for the engineering choices below.

Keep Local complete but algorithmically smaller. Keep native factual confirmation, detailed policy assessment, Pending
replay and B7 authority switching as separate boundaries. B7 switch-back, re-entry and emergency takeover remain outside
this implementation. Memory maintenance operates on durable memories and Blocks; Compaction remains Core-owned.

### 2. Minimal policy-readiness contract

Add a separately versioned Shared application-state schema. Do not add fields to frozen G1/D78 command/result/hash
formats or silently widen their current decoders. The app record binds to:

    providerLineageId, bankGeneration, bankId, objectKind, objectId,
    nativeObjectRevision, nativePayloadHash

It contains the complete resolved Taki policy, its own app/policy revision, its production basis, and independent
assessment state. Native revision comes from the verified native record. Policy revision starts at the repository's
actual first insert and advances by CAS; neither revision is invented at recall time.

Recommended minimal discriminators:

| Field | Values and meaning |
| --- | --- |
| policyBasis | neutral: declared Taki defaults; registry: deterministic resolution of sufficient trusted per-unit labels; curated: an actual explicit/model policy decision or preserved original decision. |
| assessment.state | not_required, due, failed, assessed. A failed assessment has a next attempt and remains usable under its current valid policy. |
| assessment target | Exact native binding plus expected app/policy revision. An assessment for revision N cannot certify N+1. |
| assessment evidence | Attempt count, nextAttemptAt, closed lastFailureCode, actual prompt version/hash and completion time when applicable. Do not populate successful-model evidence for neutral, imported or registry policies. |
| execution lease | Separate durable local job claim/fence; not a native operation ID or Pending phase. A lost lease makes due work reclaimable. |

A new model assessment is unnecessary for a preserved valid policy or a correctly classified record whose ordinary
rules can be resolved deterministically. A valid policy can remain the effective policy while its assessment is due
after a native edit. Policy basis and assessment state therefore must not be one combined readiness boolean.

An imported original policy is preserved verbatim as evidence, including its original policyVersion/updatedAt/epoch
and provenance. The current runtime binding wraps that original evidence and projects the active epoch/native IDs.
Do not rewrite original evidence to make it look as if the current provider or curator authored it.

#### Explicit neutral development defaults

Create one named, versioned policy-default definition and use it in both providers. The following are proposed Taki
development defaults, not claims about Hindsight or completed model judgments:

| Field | Initial rule |
| --- | --- |
| layerId | unclassified, the reserved fallback already defined by B1; do not register a fake normal layer. |
| visibility | retrieved. No automatic pinned or mood permission is manufactured. |
| importance | Reuse the existing automatic writer's midpoint default of 5 through an exported named policy default. Record policyBasis=neutral, so this is an explicit ranking default rather than a model-assessed importance. |
| retention | permanent until a supported policy replaces it. This avoids destructive expiry based on an unknown layer; it does not prevent later assessed retention. |
| disclosure / emotionalWeight | null unless real preserved evidence provides them. |
| origin | Preserve proven self/observed origin. For provider-origin content without that evidence, observed is the conservative projection; native experience does not prove Taki self-authorship. |
| policyVersion / updatedAt | Actual inserted policy revision and insertion time, persisted once; do not refresh them on every read. |
| assessment | due for the exact native version. Failed attempts preserve that policy and retry metadata across restart. |

The numeric precedent is auto-layer-policy.ts:10-17, which explicitly declares the 3..7 band and default 5. This proposal
reuses that convention; it does not authorize an adapter to write "hit.revision ?? 1" or "hit.importance ?? 5". A named
default constructor must first verify native identity/scope/lifecycle, confirm absence of an existing policy, and persist
an explicit policy receipt. Invalid or unreadable existing app state must never be treated as absent.

For a registry policy, reuse getLayer(), requireLayerOwnership() and canonicalLayerRetention(). New automatic content
must still obey the automatic visibility boundary. A bare relationship tag is not proof of a deliberate pin, and a bare
intentions tag is not a disclosure rule. If labels are insufficient to produce a safe complete policy, retain the label
as a candidate and use unclassified neutral policy until the curator resolves it. Existing pinned, mood-gated, hidden or
expiring policy is preserved; it is never replaced with neutral just because some later native field is absent.

Grounding: B1 design:256-301 reserves unclassified, requires a matching Canonical layer tag and separates source-backed
from provider-derived provenance. CONTEXT.md:282-287 defines neutral searchability and the narrow curator.

### 3. Projecting a native object without corrupting its evidence

The current Canonical record requires exactly one matching layer tag
(packages/shared/src/memory-provider-domain-schema.ts:108-117). The current replica adapter copies native tags unchanged
(packages/core/src/memory/hindsight/hindsight-replica-projection.ts:65-68), so merely supplying a neutral policy does not
produce a valid record.

Use two explicit representations:

1. Preserve the exact parsed native logical record, its native tags/typed metadata and its native payload hash as evidence.
2. Resolve the exact app binding and construct a new Canonical consumer projection. Preserve all non-Taki tag namespaces;
   replace only the Canonical projection's Taki layer tag with the one policy-authorized tag, including
   taki-layer:unclassified. The projection operation does not mutate the native object.
3. Validate the resulting CanonicalMemoryRecordSchema. The native ref/hash, app revision and projection version remain
   available outside the frozen record payload, in the app binding/replica projection envelope.

Prefer a new application-state projection beside createHindsightSourceEvidenceProjection. Add a narrowly typed optional
projected layer-tag contribution to HindsightReplicaProjection, or a separate versioned projector, without weakening the
existing source-evidence projector's exact metadata/tag checks. D78 legacy source evidence continues using its unchanged
codec and decoder.

The raw native unit determines text, source links, native fact type, timestamps, lifecycle, unit revision and native
consolidation state. Taki supplies policy/provenance/typed restoration only where proven. Never infer missing native
revision, valid state, document identity, proof count or source bounds from a recall snippet.

#### Provenance when no original Taki source exists

- A linked, verified original source keeps its actual source provenance. Preserve source and unit provenance separately
  where they differ.
- A genuinely provider-created unit without a Taki source can use actor=provider/origin=provider-derived, null timeline
  bounds and a scoped native reference. Its capturedAt is the persisted Taki observation/admission event time, not an
  invented conversation time. characterId identifies verified Bank scope, not an invented original speaker.
- The current schema requires sanitized=true. Set this only after the ingress safety check actually succeeds; reuse the
  existing safe-memory text check and observed-content fence. Reject unsafe input instead of silently editing the native
  evidence or asserting a historical Write Gate occurred. canonical-ingestion-source.ts:77-78 provides the existing
  text admission check. The original-source Write Gate still runs exactly once for Taki's own committed sources.

### 4. Native edits, source/unit metadata and remote-only reconstruction

The new extension must supply exact-version app binding, not "nearest older policy". Taki consumes the following rules;
the native transaction/API implementation belongs to the companion research.

| Case | Required Taki behavior |
| --- | --- |
| Known unit receives a native content edit | Native data advances to the exact new revision. Preserve the original policy/provenance artifacts and publish a new runtime binding carrying the effective policy. Mark detailed assessment due when the changed fields require review. |
| Native metadata/tag/source links change | Preserve both old evidence and current native state. Re-evaluate only affected projection bindings; do not apply an old typed decode to changed raw values. |
| Existing policy is hidden | Keep hidden through rebinding and failed assessment. A missing tag or metadata field cannot unhide it. |
| Native record is invalidated/deleted | Native lifecycle/tombstone suppresses ordinary recall independently of policy readiness. Restoring a valid native state does not clear an existing Taki hidden policy. |
| Native publisher creates a genuinely new unit/observation | Verify Bank/generation/identity/lifecycle. Use per-unit registry resolution where sufficient; otherwise install explicit neutral policy plus durable assessment work. Do not apply the source document's one policy to every extracted fact. |
| Native ID stays but generation changes | Treat as a different native namespace. Do not bind old policy merely by UUID or text similarity. |
| No app artifact exists after authenticated exact lookup | Eligible new content may receive a declared neutral policy; record the absence/creation outcome. |
| App artifact exists but is malformed, mismatched or unavailable | Refuse affected exposure or use an already verified replica snapshot under degraded semantics. Do not catch the error and create neutral state. |

Source metadata and unit metadata remain distinct maps. The current source-evidence projector already restores these
separately and checks exact encoding equality
(hindsight-source-evidence-projection.ts:31-36,61-75). Native G1 retain stringifies non-string metadata
(hindsight-pending-client.ts:76-81); do not change that frozen request identity to fix D77.

For each source/unit artifact, preserve the original typed map, its native encoded counterpart and exact binding.
On a native edit, an unchanged encoded key/value can retain its proven typed value. A changed/added native key is current
native data, not JSON text to decode speculatively; a deleted key is not silently reintroduced into current native
metadata. Original typed metadata remains in its historical artifact. Preserve null, absence, empty objects/arrays,
JSON-looking strings and special own keys without prototype assignment.

For new healthy retain, store the accepted source body/provenance/typed metadata as an app artifact associated with the
deterministic original operation/document identity before dispatch. The native publication binds it to actual resulting
source/unit identities; source-level policy is only intent/hint, not per-fact policy. When offline, preserve the same
artifact in durable local intent until recovery can submit it. Native source changes and append fragments keep their
actual source history; do not overwrite original evidence with a later derived fact.

Memory Blocks remain Taki-owned documents, not native facts, directives or mental models. Their independent artifact
identity is blockId + scope + block revision, with original writer and content. Provider association supports recovery
but does not make the current native fact revision their owner. Reconstruct Blocks through an internal validated restore
path that preserves exact revisions/writer evidence; ordinary replace() intentionally increments revisions and enforces
user/background ownership. Do not import every Block using actor=background or allow the curator to edit the user card.
See structured-memory-block-repo.ts:10-39.

#### Independent native and application checkpoints

Keep the B5 native cursor/revision meaning. Add app cursor/revision state and an atomic projection-publication seam:

    verified native page/state + exact app changes/bindings
      -> canonical projections + app replica state + FTS
      -> native/app checkpoint pair, under the same Authority/Bank/lease/deadline fence

Current B5 write() rejects a different Canonical payload at the same native objectRevision
(hindsight-replica-record-store.ts:43-51). App-only policy updates therefore need an explicit app-CAS reprojection
operation. They must not forge a native revision/cursor, call the existing unguarded replace() from the curator or loosen
the stale-native check globally. The leader confirmed this separate cursor direction during this review.

Raw B4 staging is not a B5 seed. Bootstrap requires seedVerifiedSnapshot with verified native metadata/pages and paired
app evidence. Reconciliation and provider-only recovery must be able to reconstruct this pair after all local Taki
evidence is removed. A local-only artifact table or a hash witness without its body cannot satisfy that acceptance.

### 5. Real B6 runtime composition

Implement one Hindsight subsystem parallel to createCanonicalLocalSubsystem, returning the same runtime surfaces:
engine, captureRun, recordPrimaryCommitted, maintenance, memoryFlush, tidy/writeMemory adapters and stop.

| Layer | Concrete composition |
| --- | --- |
| Boot inputs | Reuse resolveHindsightConfig, createHindsightConnectionSecret, createHindsightClient, connection/Bank repos and compatibility service from boot/hindsight-setup-boot.ts:23-41. Separate reusable construction from B3 method registration; add no second credential mechanism. |
| Authority/Bank routing | Use authorityEpoch(), not Local-only activeEpoch(). Freeze the verified native Global/Character bindings; do not call ensureCanonicalLocalBanks to create native Banks. |
| App hydration | Add a bounded app-state client/hydrator. It returns full native logical objects and exact app bindings from one coherent read. Native recall snippets only supply candidates and actual scores. |
| Provider | Implement MemoryProvider capabilities/retain/recall/reflect/mutate with existing validated result/error envelopes. No silent authority fallback. |
| Replica/recovery | Construct app-aware projection -> replica repo -> Pending repo/writer -> existing Pending recovery runner -> existing scheduler, with trusted Banks, actual connection and secret marker. |
| Run capture | Reuse createMemoryCoordinator and createCanonicalMemoryRun. Capture provider/lineage/epoch/capabilities, routes, row/Block/persona projection once for both tools and automatic recall. |
| Runtime switch selection | Replace the Hindsight guard only after this real subsystem exists. Preserve Legacy retirement ordering and complete Local runtime; this is selection of an existing authority, not B7 activation/switching. |
| Shutdown | Await the actual scheduler/curator stop paths and retire their leases before DB close. main.ts composition order currently constructs memory runtime before composeHindsightSetup; move reusable dependencies or pass a factory rather than relying on a later setup side effect. |

#### Healthy recall and reflection

Translate RecallRequest to recallNative without a native layer-tag filter that would exclude newly unclassified records.
Hydrate candidate IDs from verified current logical/app state; filter by actual lifecycle, policy, layer restrictions,
Bank and active epoch before the output limit. Use native scores as native scores. If raw hit text/type no longer agrees
with the hydrated current version, drop that stale candidate or repeat one bounded query within the same deadline.
Never combine a new hit with an older replica revision just because the ID matches.

Limit and token accounting remain in the existing shared-budget automatic recall path. Add the new truthful Pending
overlay representation to both explicit and automatic recall projection; preserve fencing and exclusion from Timeline,
Compaction, Write Gate and Retain. automatic-memory-recall.ts currently assumes every hit is a Canonical record and
prints a revision, so it must not receive source intents disguised as records.

Reflection must apply Taki admissibility before native model context is built. Post-filtering based_on after
reflectNative has already generated text cannot enforce hidden/lifecycle policy. The leader is obtaining a native
policy-aware reflect seam; it must reuse native reasoning rather than add a Taki reflection engine. Until negotiated,
reflect must be accurately unavailable rather than an unsafe bare pass-through. This is an existing policy obligation,
not a new product choice.

#### Healthy writes and durable Pending

Use one durable operation identity for healthy and degraded retain/mutation dispatch. Prefer the existing Pending
operation/replay machinery as the pre-dispatch ledger and let an authenticated healthy request wake the same recovery
runner. Persist intent before I/O; never implement a second raw PATCH/retain path that bypasses G1 hashes/receipts.
Healthy attempts may return completed only after actual native factual proof and matching local checkpoint application.
Otherwise return a truthful pending acceptance referring to the persisted operation.

The order stays first admitted pull -> frozen native replay -> G1 proof -> second pull/checkpoint -> completion.
New neutral policy must be producible deterministically during native publication/hydration, so awaiting an LLM
classification does not stall this factual completion. Do not add the later curator result or native derived freshness
as a G1 completion condition.

Shared currently has no pending MutationResult (memory-provider-operation-schema.ts:110-113). Add a truthful additive
result for queued mutations. Pending recall should expose the existing PendingMemoryOverlayEntry shape, or a bounded
consumer projection of it, beside confirmed Canonical hits; an accepted source can be useful without invented fact IDs,
revision=1 or derived text. A mutation overlay keeps its target and expected revision and is explicitly unconfirmed.
Cancellation/supersession removes its operational effect but preserves audit. Confirmed and pending identical text
should not crowd the output budget.

Curator policy-only writes use a new exact native-ref/app-revision CAS port. Native text/lifecycle writes use tracked
native operations. If a user operation requests both, persist a compound application intent with independent native and
app receipts; do not claim both applied after only one step, or retime old G1 Pending completion. Historical layer-edit
wire behavior and old Pending rows remain unchanged.

Keep per-object native capability limits truthful: the existing replay explicitly refuses observation mutations
(hindsight-pending-replay.ts:30-36). Observation policy/visibility/retention can change through app state while native
observation content/lifecycle remains native-owned. Do not remove that refusal to make the generic tool suite appear
complete, synthesize a native lifecycle change, or implement Local-style observation editing in Taki.

#### Degraded reads and ingestion/flush

When the selected Hindsight provider is temporarily unavailable, read the verified replica plus durable Pending overlay
under the same Hindsight epoch. This is degraded service, not Local authority. Refuse wrong generation/ownership or
invalid binding. Report actual degraded vector/provider state without inventing metrics. A successful native response
with a bad policy binding is not an availability fallback.

B5 replica FTS currently omits invalidated units but does not exclude hidden units before LIMIT. The leader assigned
this independent small fix elsewhere. The final consumer must also apply layer/time/mood policy before exposing results.

Reuse primary commit witnesses, sanitizer, cadence and createCanonicalIngestionModel().gate. The Hindsight path must not
call its extract() method: retainedIngestionSource() already produces the approved original wording and speaker/time
metadata for native extraction. Persist gate decision, selected Banks and per-Bank durable dispatch coverage once.
Do not weaken Local-only repository authority checks to reuse its entire implementation; extract a genuinely shared
source/witness seam or give Hindsight a provider-specific journal adapter.

Provide a Hindsight MemoryFlushPort that forces the same gate/dispatch coverage for the retiring span. Durable complete
Pending source coverage is sufficient durability, but not remote confirmation. Cover both Banks for route=both, exact
source witnesses, restart and late commits. Queue failure or unresolved source coverage must block retirement. The
Compaction producer itself stays unchanged.

### 6. Narrow curator scheduling and tool scope

Create a dedicated Hindsight policy pass; do not supply the generic Local tidy prompt/tools unchanged.

- Input is a bounded set of exact revision-bearing policy defects: new unclassified records, missing fields,
  incompatible labels, relevant native changes and due policy reviews. Ordinary correctly classified content is skipped.
- Model work uses the existing process Utility Slot exactly once per model task. UtilitySlot.run catches errors and
  returns undefined, so the caller must persist failed/retry state rather than assuming an exception will update it.
- The model proposes layer/importance/disclosure/retention and permitted Block changes. Code checks Bank/layer ownership,
  schema, automatic versus deliberate visibility constraints, native/app CAS, writer identity and limits.
- Tools are policy update, permitted reversible lifecycle maintenance through the authority, Block read/update, and
  finish. Do not expose generic merge/rewrite/re-extract/consolidate/observation-generation/mental-model-update tools.
  Do not allow direct writes to the confirmed replica.
- Correcting a wrong Bank requires the existing copy-with-provenance then invalidate contract; do not silently change
  ownership of an ID. Do not implement B7 authority switching to achieve that repair.
- Memory-level summaries/Blocks may consume eligible memories as maintenance products. They are not Compaction summaries
  and do not authorize duplicating Hindsight's generic semantic consolidation.

Recommended scheduling reuses existing values rather than creating a new timer framework:

| Concern | Proposed initial implementation |
| --- | --- |
| Wake | After a committed app/native synchronization batch, on-touch defect discovery, explicit run, and startup/reconnect catch-up. Coalesce durable due IDs; do not repeatedly scan all historical memories. |
| Periodic fallback | Reuse the existing six-hour maintenance/sync wake for missed work; detailed native semantic scheduling remains Hindsight's. |
| Batch/steps | Reuse MemoryConfig reportClassCap=10 and tidyMaxSteps=12 for the narrow pass initially. They are bounds, not model-call quotas. |
| Failure delay | Reuse REPLICA_RETRY_DELAYS_MS (1m,5m,15m,1h,6h) as a named backoff policy, without making assessment part of replica run success. |
| Restarts | Persist due/failed state and attempts/nextAttemptAt. Reclaim expired execution leases; preserve successful policy effects and do not mark the whole pass complete on a partial failure. |
| Prompt/config | Version a dedicated Taki policy prompt and hash the actual effective prompt in assessment evidence. Reuse Utility Slot model settings. Register any new prompt/default/scheduling knobs in knob-registry.ts and load them through ConfigSource.env(). Mark restart until production truly rereads per use. |

The existing 40-write tidy threshold may still batch ordinary maintenance, but it must not be the only retry trigger for
an unclassified record: one failed assessment must not require 40 unrelated future writes to become eligible again.
No foreground turn waits for this pass.

## Concrete Test Matrix

| Group | Required evidence |
| --- | --- |
| Policy default | Exact native identity/ownership/lifecycle plus no policy creates one persisted neutral policy; repeat reads reuse its revision/time; no LLM call; new text can affect a response. |
| Readiness independence | confirmed+neutral+assessment due/failed remains usable; completed G1 Pending is not reopened by classification failure; failure survives SQLite reopen. |
| Existing restrictions | Hidden, mood-gated, expiring and invalidated state survives native tag removal/edit and app recovery; wrong scope or corrupt existing app binding never triggers neutral fallback. |
| Classification | Correct simple registry label needs no model call; unsafe auto pin or missing mood disclosure stays a candidate; actual curator CAS completes a valid policy. |
| Native evidence | Tagless native object becomes valid Canonical unclassified projection while original native payload/hash and frozen decoder fixtures remain byte-equivalent. |
| Provenance/maps | Source versus unit metadata differ; typed null/empty/absent/JSON-looking strings and special keys survive; external native edit never reuses mismatched typed decoding or invented original source bounds. |
| Rebinding | Same UUID/new revision preserves original artifacts and restriction; stale assessment CAS fails without overwriting; same UUID/new generation refuses old binding. |
| App-only update | Policy changes with unchanged native revision update eligible projection/FTS under app CAS; native checkpoint is unchanged; rollback leaves both checkpoints/projection consistent. |
| Remote-only recovery | Delete only fresh test fixture local evidence, reconstruct from provider app/native artifacts, and verify source bodies, typed maps, Blocks, policy and original/current identity distinction. |
| Hydration | Partial native recall cannot create Canonical fields; exact hydration filters current invalidation/hidden and discards stale-hit text; other healthy Bank can still contribute. |
| Reflection | A hidden or invalidated source is excluded before native reflection context; a bare read-client method is insufficient capability proof. |
| Healthy/outage writes | One original UUID/command through existing tracked replay, lost ACK, restart, zero result, append, stale mutation and partial Bank success; no blind replay or new UUID. |
| Pending consumption | Retain source and pending mutation remain usable with truthful source/intent identity and unconfirmed status; no fake Canonical unit; cancellation/supersession and confirmation dedupe are correct. |
| Ingestion/flush | Exact primary witnesses, one original-source gate, no Local extraction in Hindsight mode, two-Bank durable coverage, late commits and forced retirement during outage. |
| Scheduler/curator | B5 first/second pulls preserved; one Utility Slot; small/retry batches survive restart; failed assessment cannot fail a healthy replica run or foreground response. |
| Run/lifecycle | One captured identity/capability/router/projection for tools and automatic recall; drift refuses; shutdown revokes stale callbacks before DB close; Local fixtures remain independent of Hindsight. |
| Frozen regression | Existing G1/D78 hashes, command fields, append receipts, native result paging, current-state certificates and Local runtime tests remain unchanged. |

Use actual temporary SQLite and injected authenticated HTTP/model substitutes. Include transaction rollback and
abort-ignoring late callbacks. This research runs no tests; final implementation requires Shared/Core typechecks,
affected focused tests, repository lint and the established isolated boot gate. Live activation and owner acceptance
remain separate.

## Suggested File Ownership Groups

| Owner group | Scope |
| --- | --- |
| Leader / Shared contracts | New independent app/policy schemas and exports; additive recall overlay and pending mutation outputs; final design, migration numbering and spec/context integration. Preserve frozen schemas. |
| Native application-state implementer | The separately researched native API/storage/exact binding/policy-aware reflection hook. No Taki runtime ownership. |
| Taki app projection/storage implementer | New app client, artifact replica/CAS/checkpoint and projection modules; bounded changes to hindsight-replica-projection.ts and sync publication. Separate Source/Unit/Block artifacts. |
| Taki provider/ingestion implementer | New Hindsight MemoryProvider, hydrator, healthy/degraded writes/reads, source journal and flush adapter, reusing existing G1 replay. |
| Taki curator implementer | Dedicated narrow policy pass/config and durable due-work consumer; permitted Blocks and maintenance port. No generic native consolidation. |
| Leader serial integration | runtime-composition.ts, runtime-selector.ts, main.ts, boot construction, canonical-memory-run.ts, automatic-memory-recall.ts and RunSnapshot/tool integration. Preserve prior dirty Local/read-client work. |
| Independent B5 small fix | hidden-before-LIMIT correction already assigned by the leader; not owned by this research. |

## Files Found and Code Patterns

| File / location | Why it matters |
| --- | --- |
| task/grill.md; task/prd.md; task/research/d77-hindsight-runtime-handoff-2026-09-11.md | Current accepted behavior and continuation authority; older pending-question prose is superseded. |
| packages/shared/src/memory-provider-domain-schema.ts:95-118 | Complete policy and strict matching Canonical tag invariant. |
| packages/shared/src/memory-provider-operation-schema.ts:56-71,110-113 | Retain can be pending; recall assumes Canonical hits; mutation has no pending branch. |
| packages/core/src/memory/hindsight/hindsight-source-evidence-projection.ts:42-75 | Existing exact native version/hash/source evidence checks; separate typed source and unit maps. |
| packages/core/src/db/hindsight-replica-sync-repo.ts:24-48,71-107 | Guarded verified seeding, canonical reads and transactional checkpoint publication. |
| packages/core/src/db/hindsight-replica-record-store.ts:43-51,83-92,146-160 | Same-native-revision hash guard and the current FTS policy filtering seam. |
| packages/core/src/memory/hindsight/hindsight-pending-replay.ts:23-58 | Existing durable tracked dispatch and stale mutation handling; preserve old-row protocols. |
| packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:42-70 | Required first pull/replay/proof/second pull/confirmation composition. |
| packages/core/src/memory/canonical-ingestion-model.ts:22-48 | Reusable original-source-only Write Gate; extraction is a different method. |
| packages/core/src/memory/canonical-local-subsystem.ts:24-59 | Complete existing Local composition to preserve and use as a shape precedent. |
| packages/core/src/memory/canonical-memory-run.ts:21-37 | Shared immutable tool/recall/routes capture. |
| packages/core/src/memory/canonical-memory-assembly.ts:17-42 | Existing policy-aware captured prompt/Block assembly. |
| packages/core/src/db/structured-memory-block-repo.ts:10-39 | Epoch-independent Blocks, writer rules and CAS. |
| packages/core/src/memory/utility-slot.ts:38-73 | One background model and serial queue; undefined on task failure. |
| packages/core/src/config/memory-config.ts:22-35; config/knob-registry.ts:181-184 | Grounded adjustable development defaults and truthful restart apply class. |

## External References

No new external API claims or web research. The current task handoff and executable hindsight-runtime-reads.md identify
the admitted Hindsight 0.9.0 read surface and the separately negotiated G1/D78 contracts. The native app-state design is
a proposal being researched by another assigned agent; its API names must be frozen by the leader before implementation.

## Related Specs

- .trellis/spec/backend/canonical-local-memory-runtime.md
- .trellis/spec/backend/hindsight-runtime-reads.md
- .trellis/spec/backend/memory-native-result-recovery.md
- .trellis/spec/backend/memory-replica-sync.md
- .trellis/spec/backend/database-guidelines.md
- .trellis/spec/backend/config-store.md
- .trellis/spec/guides/source-grounding-guide.md
- .trellis/spec/guides/cross-layer-thinking-guide.md
- .trellis/tasks/archive/2026-08/08-09-memory-provider-foundation/design.md:256-301

## Caveats / Not Found

- This file completes Taki-side engineering recommendations; it does not repeat or close every item in the earlier gap
  report. Proposed field names/defaults/API seams are not claims that they already exist.
- The app-cursor publication, exact hydration and native policy-aware reflection capabilities require the companion
  native contract. They are not supplied by the existing raw recall/reflect client.
- Readiness and retry must be durable on both ordinary runtime/restart and remote-only reconstruction. A process-local
  Set of unclassified IDs or one in-memory callback cannot satisfy either.
- No new blocking product ambiguity was found. The approved decisions determine neutral recall, unequal provider
  capabilities and scope. B7 retains its already scheduled separate grill.
- Only this assigned research file was written. No code/spec/other-task edits, tests, models, services, private data,
  Git operations or subagents were used.
