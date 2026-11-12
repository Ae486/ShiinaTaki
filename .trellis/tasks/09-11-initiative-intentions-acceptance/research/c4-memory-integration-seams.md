# Research: C4 Memory integration seams

- Query: Identify executable provider-neutral selected-topic recall and source-correction lifetime seams for C4, including plans created before automatic Memory ingestion completes.
- Scope: internal; current T4 source and executable specifications; no service calls or test execution.
- Date: 2026-09-28
- Workspace: `H:/TakiAgent-worktrees/t4`; `.git` resolves to the T4 worktree and its HEAD names `task/t4-skills-mcp-productization`.
- Task routing: explicit root dispatch names `09-11-initiative-intentions-acceptance`. The global `.trellis/.current-task` still names `09-03-avatar-presentation-lab`; this subagent has no session task according to the read-only resolver. Neither pointer nor task state was changed. This file is the only research file written by this investigator.

## Findings

### 1. Conclusion and minimum implementation boundary

The current runtime already provides a safe explicit recall tool under one captured authority, trusted Global/Character routes, policy filtering, and a model-facing untrusted-content fence. It does **not** yet provide C4's one-selected-topic-read-per-Bank quota or a captured per-record/source currentness contract. Its existing `isCurrent` checks authority/runtime/routes, not changes to individual Memory facts.

For a primary-created Intention, the original trusted source should remain the actual current `userEntry` plus its content witness. Automatic ingestion need not run first and must not be forced. Exact subsequent ingestion evidence can add restrictions to that source, but must never replace its identity, renew its window, or adopt the newest source revision as the baseline.

The minimum additions are two narrow Memory-owned, provider-neutral ports:

1. **Primary-source currentness**: synchronously validate the original Timeline witness and any exact immutable ingestion receipt baseline associated with it. This needs small read-only repository accessors; it requires no model, network request, source write, or provider activation.
2. **Selected-topic captured recall**: use the original captured tool once per applicable Bank, cap records and final rendered text, retain real record/policy/source evidence in process, and recheck those bindings before accepting the result and during held delivery.

The names and signatures proposed below are additions, not claims that these APIs already exist.

### 2. Existing captured Run and explicit recall API

`packages/core/src/memory/canonical-memory-run.ts:15` defines the existing executable bundle:

```ts
export interface CapturedMemoryRun {
  readonly isCurrent?: () => boolean;
  readonly snapshot: RunMemoryReference;
  readonly tools: ToolSet;
  readonly automaticRecall?: AutomaticMemoryRecall;
  readonly prompt?: string;
  readonly assemble?: (currentMessage: string) => string;
  readonly assembleInitiative?: InitiativeMemoryAssembler;
}
```

- `canonical-memory-run.ts:36` freezes Global/Character routes before awaiting `coordinator.captureRun()`; the tools and automatic recall share the same capture.
- `runtime-composition.ts:65` exposes `captureRun(characterId, signal?)`. It selects the already active subsystem. At lines 71-79, its held-Run closure compares the original selection mode/epoch and provider's `isCurrent`, and refuses after runtime stop.
- `canonical-local-runtime.ts:56` creates the Canonical Local capture through `createCanonicalMemoryRun`.
- `hindsight/hindsight-memory-runtime.ts:54` synchronizes under the supplied signal, captures routes and prompt once, and calls the same canonical factory. Lines 70-80 add original route currentness.

Existing explicit invocation, after checking that the capability/tool is present:

```ts
await captured.tools.recall.execute!(
  { query: selectedTopic, scope: "global", limit: 4, maxTokens: 512 },
  { toolCallId, messages: [], abortSignal },
);
```

Use a separate `scope: "character"` call for the current Character Bank if selected. The exact AI SDK options type should be taken from the installed tool definition during implementation.

`canonical-tools/canonical-memory-tools.ts:81` routes the request through the captured coordinator with:

```ts
{ bankId, query, queryTimestamp, budget: "mid", limit, maxTokens,
  factTypes: ["world", "experience", "observation"],
  layerIds: [], includeInvalidated: false }
```

- Lines 97-106 validate envelope schema, provider/epoch, stable capabilities, vector status and namespace.
- Lines 110-127 combine `scope: "both"` with a **shared** limit/token budget. `both + limit:4` does not mean four per Bank; `both + limit:8` could admit more than four from one Bank. Separate Bank-scoped invocations are the direct fit for the parent contract.
- Lines 212-222 preserve expected epoch/provider/lineage/capability digest and pass `abortSignal` into the coordinator.
- Lines 137-149 preserve structured execute results but escape XML-significant characters and call `fenceUntrusted` for model text. Hindsight uses `hindsightApplicationWireJson`, because ordinary recursive `JSON.stringify` is not the supported serializer for its deep metadata.
- `recall-tool.ts:8` has broad foreground limits of 20 records/8192 tokens and permits repeated calls. C4 must narrow these limits and count invocations in its owning per-Run adapter. A prompt instruction alone does not enforce the quota.

**Token-budget caveat:** `memory-recall-selection.ts:154` counts only `hit.record.unit.text` for normal hits. The full tool model view includes record metadata, provenance and policy. Therefore `maxTokens:512` is not evidence that the final injected envelope fits 512 tokens. C4 should render a narrow projection, measure the final per-Bank text including labels/fence, and drop whole records that do not fit. Do not serialize arbitrary metadata/source bodies into a purportedly bounded prompt. Keep full internal evidence separate from prompt text.

`memory-recall-selection.ts:109` rejects invalidated, hidden, mismatched mood-gated or expired records at consumption. It also keeps Pending overlays distinct from confirmed hits. Preserve actual `confirmed`, `partial`, `vectorState`, branch failures and provenance; never manufacture confirmation or freshness.

### 3. Original primary source exists before automatic ingestion

`agents/chat-agent.ts:214` appends the user row once. Lines 363-368 give primary-only tools `{ characterId, userEntry, turn }` from this exact row. On cancellation/retraction, lines 265-267 remove that row. Only later, lines 269-275 commit the assistant batch and call:

```ts
onPrimaryCommitted({ characterId, entries: [userEntry, ...entries], runId })
```

`main.ts:418` wires this to `memoryRuntime.recordPrimaryCommitted`.

Consequences:

- During the primary tool call, `userEntry` is trustworthy Core context, but an ingestion witness/span may legitimately not exist yet.
- A plan must not require an already ingested Canonical source to acknowledge the user's actual current input.
- A missing current Timeline row, changed digest, Character mismatch or original Run/source invalidation must refuse later plan use.
- “No associated Memory yet” is an unbound Timeline source, not a confirmed Memory source and not proof of a correction. It must not force ingestion, trigger another extraction model or write a fake source.

`canonical-ingestion-source.ts:47` computes `primaryEntryDigest` over id, seq, Character, role, content, parts and creation time. `ProvenPrimaryEntry` at line 19 has `kind`, `entry`, `digest`, `committedThroughSeq`. Sanitized spans at line 31 persist exact `{id, seq, digest}` proofs. The same codec is used by Local and Hindsight ingestion.

### 4. Exact source chain, identifiers and immutable receipt fields

There is no existing generic Memory `sourceId`/`groupId` that can be calculated from only a primary user row. Ingestion groups depend on the eventual sanitized span and selected Write Gate subrange.

| Link | Canonical Local | Hindsight |
| --- | --- | --- |
| Exact primary witness table | `canonical_memory_primary_commits` | `hindsight_ingestion_primary_commits` |
| Witness fields | `timeline_seq`, `character_id`, `entry_id`, `entry_digest`, `committed_through_seq`, `authority_epoch_id`, `ingestion_span_id`, `run_id`, `committed_at` | Same relevant witness/claim fields; epoch is explicit |
| Span table | `canonical_memory_ingestion_spans` | `hindsight_ingestion_spans` |
| Span origin | `source_json` containing sanitized messages/proofs, plus `source_hash`, `from_seq`, `through_seq` | Same origin structure, plus `provider_lineage_id` |
| Original planned output | `gate`, `extraction.batches`, `bankReceipts` in `CanonicalIngestionState` | `gate`, `batches`, `receipts` in `HindsightIngestionState` |
| Confirmed baseline | `LocalIngestionReceipt`: `documentId`, `sourceRevision`, `memories[{memoryId,revision}]`, `reinforced[{memoryId,revision}]` | `receipt.evidence.kind === "provider"` contains real `RetainCompletedResult`; an outbox receipt is explicitly Pending |

Sources:

- `db/canonical-ingestion-source-repo.ts:33`, 69-89: exact durable Timeline comparison, atomic primary witness insertion and claim link.
- `db/hindsight-ingestion-source-repo.ts:17`, 44-60: Hindsight witness table and same exact durable-row digest comparison.
- `canonical-ingestion-plan.ts:36` and 51: Local receipt and complete state codecs.
- `hindsight/hindsight-ingestion-contract.ts:23` and 31: Hindsight receipt and state codecs.
- `db/canonical-ingestion-repo.ts:137`: acknowledges only `maintenance.ingestReceipt(batch)`, stores the actual receipt, and rejects changed replay evidence. Lines 184-189 compare durable receipts again at completion.
- `db/hindsight-ingestion-repo.ts:99`: captures actual provider/outbox coverage and validates existing coverage; completed ingestion may have durable Pending source coverage without confirmed extracted facts.

Identity derivation is explicit:

```ts
// canonical-ingestion-plan.ts:61-69
spanId = "local-ingest:" + sha256(JSON.stringify([epochId, characterId, sourceHash]));
requestId = "local-ingest-bank:" + sha256(JSON.stringify([spanId, bankId]));
documentId = "auto-source:" + sha256(requestId);

// hindsight-ingestion-contract.ts:39-59
spanId = "hindsight-ingest:" + sha256(JSON.stringify([epochId, characterId, sourceHash]));
requestId = "hindsight-ingest-bank:" + sha256(JSON.stringify([spanId, bankId, bankGeneration]));
documentId = "hindsight-source:" + sha256(requestId);
```

Local `canonical-local-ingestion-batch.ts:53-66` and Hindsight `hindsight-ingestion-contract.ts:46-66` both preserve:

```ts
metadata: {
  "taki:conversation-source:v1": {
    version: 1, spanId,
    entries: [{ id, seq, role, createdAt, utf16Start, utf16Length }, ...]
  }
}
provenance: {
  actor: "agent", origin: "auto-gate", characterId,
  timelineFromSeq, timelineToSeq, capturedAt, sanitized: true,
  sourceRef: `timeline:${characterId}:${fromSeq}:${throughSeq}`
}
```

`retainedIngestionSource` at `canonical-ingestion-source.ts:86` produces the exact UTF-16 entries. The source text is separate from extracted fact text. A containing numeric Timeline range alone is insufficient: verify exact entry id/seq/digest in the span and that the Write Gate actually retained the row.

Local duplicate ingestion can reinforce a fact whose `unit.documentId` points to an older source. `db/canonical-memory-maintenance-ingestion.ts:77` annotates the new source with `taki:local-evidence:v1` for these targets; the immutable receipt's `reinforced` list records the actual target revisions. Do not rely only on `unit.documentId` to discover this association.

### 5. Proposal A: synchronous primary-source currentness

Suggested new Memory-owned contract, with exact input fields drawn from the existing witness and Run capture:

```ts
// Proposed internal API, not an existing export.
type PrimarySourceWitness = {
  characterId: string;
  id: string;
  seq: number;
  digest: string;
};

readPrimarySourceCurrentness(
  original: PrimarySourceWitness,
  originalMemory: RunMemoryReference,
): "current" | "retired" | "unavailable";
```

The original `RunMemoryReference` is an authority fence, not permission to switch providers. The Intention owner should keep the original witness/source opportunity and finite window; the Memory callback supplies only evidence/currentness.

Implement this at the existing runtime/provider composition seam:

1. Check the original selected provider/epoch/lineage and current runtime. Check the exact original Timeline row/digest.
2. Locate its exact primary witness by original epoch/Character/seq. If no witness/span exists yet, preserve the distinction “Timeline exists, no confirmed Memory association.” Do not create one.
3. If assigned, decode the saved span using its existing codec; verify original proof and selected gate membership. Retrieve original batch/receipt, not current search results.
4. Compare confirmed receipt identities/revisions with current source/unit/policy evidence. A previously changed/deleted source is detected even when this is the first check after ingestion: the baseline is the saved receipt, not the record observed now.
5. Pending/outbox-only Hindsight evidence remains Pending. It cannot be used as an authoritative Memory revision or native completion. Its exact cancellation/withdrawal can retire dependent source use; generic network outage cannot create a replacement authority.
6. Return retired for a proven original source/record withdrawal or mismatch, unavailable for missing/corrupt/unverifiable required evidence. The Intention owner must distinguish terminal withdrawal from temporarily unavailable recall, while neither authorizes stale output. Expiry is independently final.

**Required small repository addition:** neither current ingestion repo exposes a public completed-span read by exact primary witness. Local has `pending(scope)` at `db/canonical-ingestion-repo.ts:35`; Hindsight has `pending(scope)` at `db/hindsight-ingestion-repo.ts:26`. Add a bounded read-only witness-to-span projection beside these owners, reuse their source/state codecs, and validate stored receipt evidence. Do not add a second generic JSON interpretation in the Intention service or scan all history/expired Intentions.

An alternative is an ingestion-completion callback that attaches proven source constraints to existing plans. It is safe only when attaching the exact original witness and receipt baseline, monotonically; it requires durable linkage and replay handling. The direct read-only projection is the smaller integration if the owning service can already invoke synchronous source checks.

**Not safe:** capture `memory: absent` at creation, then later read and adopt any current same-topic record or current source revision. The first later observation might already be a correction. Absence is not a version and does not grant rebinding authority.

### 6. Existing current source/unit/policy evidence and withdrawal markers

#### Local

- `CanonicalMemoryRepo.record(epochId, bankId, memoryId)` exists at `db/canonical-memory-repo.ts:45`. Its underlying read is at `db/canonical-memory-maintenance-records.ts:22`.
- `readCanonicalSource(db, { epochId, bankId, documentId })` exists at `db/canonical-memory-maintenance-records.ts:42`; it returns actual `revision`, `contentHash`, provenance and metadata. These are separate from unit revision.
- `CanonicalMemoryRecord` is exactly `{ unit, policy, provenance }` (`shared/memory-provider-domain-schema.ts:108`). Unit has `memoryId`, `documentId`, `revision`, `state`, invalidation fields; it has no embedded `sourceRevision`. Source revision must be read through the source owner.
- `db/canonical-memory-repo.ts:140` edits the unit by CAS and increments its revision; line 156 invalidates/restores and increments revision. `replaceExistingDocument` at line 118 invalidates old valid units and increments their revisions, while retain increments the source revision at line 86.
- Policy also matters. Compare the captured supported policy or its real fingerprint/current eligibility, rather than assuming a native/unit revision catches every policy update.
- `db/canonical-memory-maintenance-retention.ts:29` physically deletes only authorized expired rolling activity rows. Lines 83-91 delete an unneeded source and insert `canonical_memory_retired_sources(authority_epoch_id, bank_id, document_id, last_revision, deleted_at)`.
- `db/canonical-memory-maintenance-records.ts:56` refuses recreating a retired source identity. Lines 71-76 refuse reusing a historical unit identity. Historical revision snapshots/receipts survive deletion and are **historical proof**, never current eligibility.
- Missing current unit/source, revision mismatch, invalidation, hidden policy or current retention expiry should close a dependent captured plan/output even if the old Timeline text still exists.

#### Hindsight

Use `state.replica`, the **application** replica installed at `hindsight/hindsight-runtime-state.ts:78`. Do not read the older B5 replica or Local tables as substitute current authority.

`db/hindsight-application-replica-contract.ts:81` declares:

```ts
checkpoint(bankId)
nativeHead({ bankId, namespace, objectKind, objectId })
logicalRecord({ bankId, namespace, objectKind, objectId, ... })
record({ bankId, namespace, memoryId, includeInvalidated?, includeHidden? })
sourceArtifacts({ bankId, namespace, documentId?, bindingKind? })
artifact({ bankId, namespace, version })
body({ bankId, namespace, bodyId })
```

- `record` defaults to excluding invalidated/hidden data; `logicalRecord` can inspect tombstone/current document evidence. These checks are based on exact paired application/native checkpoints and validated body/artifact closure, not arbitrary cache JSON (`hindsight-application-replica-query.ts:54`, 62, 180-230).
- Preserve the original `namespace.provider_lineage` and `namespace.bank_generation`, epoch and actual Bank. The current checkpoint includes `verifiedAt`, `bankDeleted` and paired cursors. A changed namespace is not a new current source under the old plan.
- `nativeHead` exposes the exact native `version` and `bound_artifact`. App-only policy changes can update the artifact/policy without changing native unit revision. Capture/check both, or compare the actual supported projected policy plus source/native versions. Native revision alone is insufficient.
- `sourceArtifacts` explicitly returns **candidate** source evidence (`contract.ts:91`); that array alone does not prove successful/current native association.
- `hindsight/hindsight-application-projection.ts:91-120` preserves original Timeline provenance only if `original_witness` exactly equals the current document kind/id/revision/payload hash **and** actual source text/context remain exact. Otherwise it projects provider-derived provenance with null Timeline bounds. This is a useful correction fence, not permission to re-label the new document as the old source.
- `hindsight/hindsight-application-source-binding.ts:82` produces real `{ source_kind, source_id, source_revision, source_payload_hash }` from the native version. Do not invent a revision or derive confirmation from a queue ACK.
- Tombstoned head/source, absent/unbound current projection, hidden/expired/invalidated policy, changed native/source revision, changed bound policy artifact, or loss of original witness invalidates that captured source use.

A source corrected on the remote provider while completely disconnected cannot be detected synchronously until verified synchronization supplies evidence. Report this limit honestly. The existing contract permits clearly degraded verified-replica reads; it does not promise omniscient remote freshness or permit a Local authority promotion during outage.

### 7. Proposal B: per-Bank selected-topic read and captured evidence fence

Suggested addition on `CapturedMemoryRun`, or a companion object owned by the same capture:

```ts
// Proposed interface, not existing fields.
readSelectedTopic(input: {
  query: string;
  scopes: readonly ("global" | "character")[];
  signal?: AbortSignal;
}): Promise<{
  text: string;        // final bounded, escaped/fenced model view
  isCurrent(): boolean; // original authority plus exact captured record/policy/source evidence
}>;
```

The owning implementation should retain structured real outcomes internally; the two-field sketch is only the minimum consumer surface. Preserve failure/degradation information in the bounded text or explicit existing envelope, rather than converting unavailable into an empty successful recall.

Required behavior:

1. Start only after an independently eligible fresh opportunity exists, with selected topic from its actual purposes; do not mine expired Intention bodies or the old trigger text to create that opportunity.
2. Use the original captured coordinator/tools and selected scopes; one explicit query per applicable Bank. Count attempted calls, including failed ones, for this Run; do not reset counters in overflow retry/held delivery.
3. Check original `isCurrent` and cancellation before dispatch, after every awaited call, and before returning. Retain the provider's normal partial/degraded semantics.
4. Build bounded model text from selected actual results; enforce maximum four records and final 512 tokens per Bank, within the Run budget. Preserve unknown outcome semantics, provenance and actual confirmation. Keep internal source/record/policy refs outside prompt/control text.
5. Capture current unit identity/revision, relevant source revision/content evidence, and current policy/native artifact evidence through the provider-owned read ports above. If the result cannot be matched to current proven evidence, refuse/drop that result instead of adopting a newer version or quietly re-querying.
6. The returned closure rechecks those exact references and current retention/policy without another semantic search or model call. It must not switch authority, capture replacement Banks, renew the original opportunity, or regenerate held text.
7. Combine this closure with the already retained source/Intention deadline and original Memory closure in C1's admission/delivery currentness. `initiative-context-builder.ts:28-50` currently remembers the original Memory capture and tests only its `isCurrent`. `initiative-runtime.ts:117-120` combines opportunity, primary version, timezone, expiry and captured authority; lines 139 and 146 use the same predicate after reasoning and during delivery. These are existing places to compose the new stricter check.

The existing selected assembly intentionally contains bounded Persona/Blocks/index only. `assembleInitiative` must remain distinct from primary `assemble` and `automaticRecall`; it must not invoke the old intention picker.

### 8. Authority, awaits and unavailable/degraded behavior already implemented

- `memory-coordinator.ts:71-82` captures epoch/provider object/executable methods/capabilities. Lines 102-128 fence dispatch; lines 163-175 verify result namespace, capabilities and authority again after the operation. Lines 202-215 check provider identity/method replacement.
- `runtime-composition.ts:73-79` holds the original mode/epoch/lifetime. It does not activate a provider.
- `hindsight/hindsight-runtime-connection.ts:33-61` checks original selected epoch/lineage/configuration and credential fingerprint, then resolves only verified existing Bank mappings. Capture's route closure compares these original Bank identities (`hindsight-memory-runtime.ts:70-80`).
- `hindsight/hindsight-memory-recall.ts:17-45` uses native recall and exact hydration when available. Only a recognized availability error triggers verified application-replica search under the **same Hindsight identity**. Invalid policy/evidence is not converted to availability fallback.
- Its lines 75-87 preserve `vectorState: "degraded"`, `partial: true`, and `MEMORY_PROVIDER_UNAVAILABLE` branch failure for degraded results. Confirmed replica records remain confirmed evidence of previously verified data, not proof of current remote health.
- `hindsight-memory-runtime.ts:83-94` allows a failed synchronization only with previously verified capability evidence. No capability evidence means admission refusal; it does not perform an unowned fresh capability retry.

### 9. Existing tests to extend; additional C4 scenarios

Tests were located/read, **not run**. No live Hindsight or paid model call was made.

| Existing file and starting line | Existing evidence / useful extension |
| --- | --- |
| `memory/canonical-memory-run.test.ts:51`, 84, 94, 112, 145 | One capability capture; old-provider refusal; method replacement; honest vector degradation; post-await authority refusal. Extend with selected-topic per-Bank attempt cap and no fresh capture on retry. |
| `memory/canonical-tools/canonical-memory-tools.test.ts:13`, 21, 30 | Abort forwarding; one successful Bank when the other fails; shared bounds and deterministic request identities. Extend with final serialized budget and fence-escape cases. |
| `memory/hindsight-runtime-composition.test.ts:118`, 129, 135, 172, 198 | Route replacement refusal, disabled selected-Hindsight refusal, outage retains Hindsight+partial/degraded, active recall drain and held consumer stop. Extend with C4 source/policy change while output is held. |
| `memory/hindsight/hindsight-memory-read-projection.test.ts:12`, 30, 65 | Hidden/expired/mood exclusion, never relabel old native candidate with newer revision, missing binding distinct from corrupt policy. Extend with current source and app-only policy mutation invalidating a captured C4 result. |
| `db/canonical-ingestion-repo.test.ts:38`, 50, 59, 88, 108 | Exact Timeline witnesses, edit behind old digest, immutable commit/claim, fabricated receipt refusal, corrupted source/authority refusal. Extend with completed-span lookup and first currentness check occurring after correction. |
| `memory/canonical-local-ingestion.test.ts:80`, 150, 174, 206 | Original source/fact separation, duplicate evidence, both-Bank restart and real receipt after lost acknowledgement. Extend with primary-created plan before ingestion, then exact receipt-linked correction. |
| `db/canonical-memory-maintenance-retention.test.ts:47`, 82, 94 | Historical receipts survive physical deletion without recreating rows; shared source preservation; duplicate-evidence source cleanup. Extend with Intention retirement while old Timeline row remains. |
| `memory/hindsight/hindsight-ingestion.test.ts:244`, 262, 324, 336, 347 | Completed receipt without invented facts; cancelled exact Pending coverage; source change during await; authority and Bank generation drift. Extend with Pending-vs-confirmed plan source linkage. |
| `initiative/initiative-context-builder.test.ts:117`, 141 | Original prepared authority is retained; absent currentness port refuses; selected sampling deadline controls capture. Extend with per-record/policy/source closure. |
| `initiative/initiative-runtime.test.ts:112` | Held same-Attempt output invalidated after timezone change without another model/presentation. Reuse structure for source revision/deletion/authority changes. |
| `harness/initiative-recovery.test.ts:27` | Staged/dispatch-committed crash cuts do not replay/refund old speech. Extend with expired Intention followed by a fresh independent opportunity. |

Required new integrated missed-interview scenario:

1. Create a source-bound plan from an actual primary user row; no forced Memory call is required. Retain the independently reported matter through normal Memory ingestion.
2. Advance offline beyond the original plan deadline. Verify its source key/trigger/text remain terminal across restart and duplicate callbacks.
3. Admit a later **independent** valid window/Signal. Explicitly recall the selected topic from Global/current Character once each and produce a new question; do not resolve the event's unknown outcome or reopen the old plan.
4. Repeat after edit/invalidation/deletion of the related Memory while the old Timeline text is unchanged. A known corrected/withdrawn source must neither feed stale output nor renew the old plan. Include a correction before the first post-ingestion source check.
5. Repeat with one unavailable Bank and with Hindsight verified degraded replica. Preserve uncertainty, original authority and no fallback activation. Repeat with no verified capability evidence and corrupt current source/policy evidence: refuse rather than fabricate a healthy empty result.

### 10. Related specifications and external references

- Child `design.md` and `prd.md`: C4-01 through C4-04 and source/expiry/provider-neutral acceptance.
- Parent `../09-11-companion-initiative-implementation/design.md:218` (section 9): finite source-bound plans, expiry independent of the reported matter, fresh independent recall, one read/four records/512 tokens per Bank.
- Parent `research/decision-register.md:17`, 34, 93: current source/specs outrank old implementation snapshots; one authority and no outage promotion.
- `.trellis/spec/backend/canonical-local-memory-runtime.md`: exact primary witness, immutable Run identity, selected assembly and durable source/receipt semantics.
- `.trellis/spec/backend/hindsight-runtime-reads.md`: native results alone do not contain sufficient Canonical provenance/revision/policy; hydration must use actual evidence.
- `.trellis/spec/backend/hindsight-application-runtime.md`: paired application/native evidence, confirmed vs Pending source state, original source witness, immediate policy, shutdown and degraded-read boundaries.
- `.trellis/spec/backend/initiative-runtime.md`: original context/authority survives retry/held delivery; no primary auto-recall or fake user turn.
- External references: none fetched. This research relies on installed current TypeScript APIs and repository fixtures. Package test command is `vitest run` (`packages/core/package.json:11`); the root manifest declares Vitest `^4.1.0`, not a live package-version verification.

## Caveats / Not Found

- Source was being implemented concurrently by other owners. Line numbers describe the inspected T4 files and may move. This investigator did not modify code or the other owners' research.
- No existing provider-neutral per-record/source lifetime port or completed-span-by-witness reader was found in the inspected interfaces. These are explicit small implementation proposals.
- Existing captured Memory currentness alone is insufficient for C4 source correction. Existing Timeline digest alone is insufficient when Memory changes but historical Timeline text remains.
- Existing recall text-token accounting does not bound the entire serialized model view; final C4 projection needs its own measured cap.
- Remote corrections cannot be known during complete disconnection before new verified evidence arrives. Degraded replica semantics must remain visible; this limitation is not a reason to promote Local authority.
- D81 remains an explicitly documented Hindsight limitation: source labels/visible subsets do not prove all inputs of every provider-derived body. This work must not claim global propagated erasure/exclusion for opaque derived summaries (`hindsight-application-runtime.md:102-108`). It can enforce exact supported direct record/source fences.
- No full tests, runtime acceptance, native UI acceptance or owner acceptance was performed. The parent/child tests above are extension targets, not passing C4 evidence.
