# Research: Stage 5B independent design readiness review

- Query: Independently review the proposed Stage 5B PRD/design/implementation plan; close wire, locking, refresh, recovery, label-trust and restore gaps with bounded source-based decisions.
- Scope: internal; read-only current Taki and Native source, with this report as the sole write.
- Date: 2026-10-07.
- Active task/output ownership: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5b-design-review.md`, explicitly supplied by the leader. The child-local legacy pointer is empty and `task.py current --source` returned none; no binding was changed.
- Reviewed artifacts: sibling `10-07-hindsight-template-lifecycle/{prd.md,design.md,implement.md}` and its three `research/source-*.md` excerpts. The refresh/enrollment follow-up supersedes the older external embedding preparation advice.

## Findings

### Verdict and decision boundary

The proposed slice is correctly separate from 5A and is implementable within the approved Stage 5 scope. It is not yet dispatch-ready: the draft names several invariants without identifying the producer/claim/proof that can enforce them. The seven items below are design blockers, not claims that the unimplemented feature already contains these defects.

The leader can settle all recommended engineering details below without another owner product decision. Preserve the explicit boundaries: no forced legacy adoption, no original-data repair, no model/service execution during implementation checks, no schema downgrade, and no commit/push/archive. An actual unsupported legacy collision or destructive recovery remains a later concrete decision, not a reason to hold the fresh/enrollable implementation indefinitely.

### P1-1. Partial rollout loses its runtime hold at restart unless the hold is durable

**Trigger/consequence.** Bank A commits, Bank B refuses or Core exits before selection publication. Reusing only the existing exclusive family and backup write fence allows restart or terminal `outcome_unknown` to reopen operations/runtime while Native and the Core-selected overlay disagree. The final-lease requirement also currently refers to a lease the generic operation owner does not have.

**Evidence.**

- `packages/core/src/db/migrations/048-memory-operations.ts:10-28` has state, owner boot, request/producer/result JSON and a `terminal_at IS NULL` unique-family index; no executor lease or checkpoint revision.
- `packages/core/src/db/memory-operation-repo.ts:95-108` terminalizes foreign open rows as `outcome_unknown/core_restart`, releasing that index.
- `packages/core/src/memory/operations/memory-operation-contract.ts:67-73` excludes only currently active families.
- `packages/core/src/memory/hindsight/hindsight-writer-fence.ts:1-5,20-23,48-51` explicitly keeps recall/reflect and Run capture open and documents an in-memory backup pause.
- `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:46-68` currently guards authority/connection/template revision, not an unpublished partial template rollout.

**Bounded resolution.**

1. Keep the existing `memory_operations` row as the execution owner. Add template-specific executor generation, boot/token, lease deadline and monotonic checkpoint revision in that existing durable ownership boundary (nullable additive columns or a typed producer checkpoint with equivalent SQL CAS). Do not create another independently scheduled operation ledger. Persist the full fixed Bank set, original Native request IDs and plan before dispatch.
2. Define a durable **unpublished-template-effect hold** from the original operation's recorded dispatch/effects versus its publication receipt. It survives `failed`/`outcome_unknown`, process restart and loss of an in-memory fence. Once a Native call may have been sent, absence of a response does not release it. A terminal operation row is not automatically safe.
3. Consult that hold during boot runtime construction, Run/reflect admission, source/background dispatch, auto-provision/revalidate and every conflicting exclusive-family admission. The simplest bounded first implementation holds the Hindsight runtime globally during rollout; per-Bank availability optimization is unnecessary. Chat may use the existing memory-unavailable behavior; primary witnesses remain durable under the unchanged authority/custody.
4. Reuse the writer fence to drain writes and stop the replica scheduler, but separately prevent new memory read/reflect work from consuming mixed templates. Do not keep the backup-only message or automatically release the durable hold in `finally` after a partial effect.
5. An explicit recovery command references the original operation and resumes its fixed plan/request IDs. Only this recovery may cross its own hold. Original status reads and `observeBoot` stay read-only. A fresh preview cannot discard committed Banks from the old plan; unresolved external drift remains reconciliation-required.
6. Publish selection/setup projections and a release/publication receipt in one short SQLite transaction, checking the same executor generation, token, live deadline, exact checkpoint revision, authority epoch, connection/secret fingerprint and Bank set after the complete synchronous read-back. A successful publication followed by failed binding permits binding-only recovery. Derivative refresh pending/failed does not itself prevent configuration publication.

**Required focused check.** Crash after the first of two Bank commits, then restart, attempt normal Run/reflect, auto-provision, backup and a new template apply before recovering the original. Assert no mixed runtime, no dropped source witness, no fresh Native request ID, and no lease-replaced or post-deadline publication. This belongs in B2, before Home integration.

### P1-2. Exact unit tags plus entities still do not prove a per-fact extracted label

**Trigger/consequence.** A caller supplies a source-wide `taki-layer:*` entity/tag. Core later observes that tag and entity on one exact Native unit and infers registry policy. The address is exact, but the classification may have been copied from the entire input rather than extracted for that fact. Merely connecting the currently unused label argument would violate the stated trust boundary.

**Evidence.**

- Native `hindsight_api/native_requests.py:62-68,311-314` accepts input entities and tags, forwarding them to retain.
- Native `engine/retain/entity_processing.py:15-47` merges every content-level user entity into each fact's entity list.
- Native `engine/retain/fact_extraction.py:1545-1588,2340-2384` begins with free-form entity strings, then appends validated structured labels. The resulting entity list no longer proves which channel supplied a matching string.
- Native `engine/retain/entity_labels.py:300-331` projects any matching reserved group prefix from final entities, without retaining structured-label provenance.
- Native `engine/replication.py:545-577,589-601` exports final unit tags/entities/metadata, not their classification origin.
- Taki `hindsight-application-binding-context.ts:107-110` currently omits `initial.label`; `hindsight-application-policy.ts:37-41,134-145` assumes its caller already established trusted per-unit evidence.

**Bounded resolution.** Add the missing trusted producer rather than treating existing tags as proof:

- Capture a tiny typed label-evidence record from the validated **per-fact structured `labels` result**, before merging caller entities/tags. It identifies the owned group, allowed value, effective group digest and Native producer version. Missing/invalid/multiple labels yield explicit absence. Do not synthesize evidence from metadata, caller tags, free-form entity text or current template equality.
- Persist this server-owned evidence atomically with the unit and its logical revision, binding it to namespace, Bank generation, unit ID, exact revision and payload hash. A small sidecar row is preferable to a caller-writable metadata key; it avoids changing existing frozen logical payload hashes. All actual mutation/restore/invalidation paths must invalidate or deliberately republish matching evidence; stale evidence cannot attach to a later unit revision.
- Expose it through an authenticated, bounded exact-version read under the new optional contract, and pre-load it into the existing application-binding work before the synchronous policy resolver runs. A missing sidecar on old builds/old facts is neutral. A claimed current record that cannot be verified must not be promoted.
- Require the evidence value, current unit's single canonical layer tag, scope and selected group configuration to agree. If a caller-supplied extra reserved entity/tag creates ambiguity, remain neutral. Per-unit Native curation is a different provenance from structured extraction; do not silently mint extraction evidence for it.
- Preserve existing original/curated policy priority. `relationship` remains unable to mint a pin; `intentions` without actual disclosure remains neutral. Template suppression disables new taxonomy inference rather than overriding the user's selection. Do not reclassify old application policies.

This is one narrow evidence producer/consumer addition, not a new classifier or daily assessment subsystem. Its persistence must join the same B3 backup/restore and transition preservation inventory as the new lifecycle receipt tables. If the leader chooses a different storage shape, the dispatch contract still must name the server-owned producer and exact-version invalidation rule; tags alone are not an acceptable substitute.

**Required focused check.** With a fake structured extractor, send two facts from the same content: one labeled and one unlabeled, plus caller-provided reserved tags/entities. Only the actual labeled fact may obtain a neutral-safe registry policy. Repeat both extraction paths, malformed/multiple values, custom/suppressed group, old rows, per-unit edit and stale-version evidence.

### P1-3. Refresh admission needs execution ownership and result publication, not only a stable UUID

**Trigger/consequence.** Two Sync submissions or Sync plus Worker execute the same durable refresh; an old worker publishes after a definition edit; a crash after content commit replays and reports unproven generation. Stable child admission alone does not prevent these outcomes.

**Evidence.**

- Native `engine/task_backend.py:95-118` blindly executes Sync submissions; Worker submit is a no-op at `:126-145`.
- Native `engine/memory_engine.py:17472-17503,17577-17587,17644-17648` generates a fresh ID, owns its transaction, inserts a complete payload, then calls the backend. Reuse requires an internal connection/fixed-ID extraction.
- Native `engine/memory_engine.py:2993-3008` only checks missing/cancelled status and continues on lookup error; it is not a strict execution claim.
- Native `worker/poller.py:516-542` delegates actual claims to backend SQL; `engine/db/ops_postgresql.py:1362-1494` claims pending rows and stamps `worker_id/claimed_at`.
- Native `engine/memory_engine.py:14648-14661` loads current model definitions; `:14773-14782` passes the produced content into the existing update path; `:14957-14978` is the final locked publication seam. `:2911-2921` writes outcome metadata only after refresh persistence.

**Bounded resolution.**

1. In B1, extract private validated admission taking the caller connection, exact child UUID, full typed refresh payload and authenticated attribution. Preserve provider/validator, maintenance, Bank and initialization checks. Child IDs are persisted in the template request before effect dispatch. A uniqueness conflict with an unrelated existing child refuses; it never adopts that row.
2. The template transaction inserts definitions, logical changes, child row and receipt together. Only a newly committed request notifies the backend. Replays return original child IDs. Notification failure leaves a pending durable job. Definition-only apply must work without a configured model.
3. Add one internal persisted-job execution gate used by template-owned Sync jobs and by the worker path. Sync obtains a pending-to-processing claim for the exact durable row, with unique execution owner/token; Worker uses its already-issued claim rather than trying to claim twice. Validate namespace/Bank/generation/type/payload hash. Missing, failed read, another owner, terminal row or mismatched payload never executes. Preserve the Worker retry/defer path and original ID.
4. Put expected definition identity in the immutable job payload: namespace/generation, model ID, pinned subtype and complete definition digest (including trigger). Check before model/embedding work, then again under the Bank cursor/owner/canonical lock in `update_mental_model` before content/history/logical events. Freeze the exact model object revision/hash supplying the generation baseline too; recheck it before result publication so a content edit or another refresh during generation cannot be overwritten. The smallest conservative child guard can use the apply-time model revision/hash at both stages: a content-only change may supersede that child, while configuration-only CAS still ignores unrelated content. This also avoids a definition A -> B -> A race without introducing an unmaintained template-only revision. Include claim-owner validity in final publication; stale executors cannot publish. A different definition, deletion or generation yields a truthful superseded/refused outcome without overwriting content.
5. Store a compact child result marker with the generated model publication in the same transaction: child ID, expected definition digest, resulting revision/hash and semantic outcome. Keep the template configuration receipt immutable; derived results are separate. Crash after model commit but before generic operation settlement reads this marker rather than fabricating success from current content. It also prevents duplicate history publication for the same child.
6. Before the atomic result marker exists, worker crash/retry may repeat upstream model/embedding calls. Do not claim exactly-once provider execution or cost. Generic task completion must not replace a recorded superseded/result-conflict with generated success. Explicit retry of a genuinely failed terminal refresh creates a distinct reviewed refresh attempt; template request replay never performs that retry implicitly.

**Ordering adjustment.** Move the guarded execution/result path from B2 into B1's Native commit milestone. B1 must not hand off a queued job contract that is unsafe once a worker runs it. B2 then integrates factual derived-state reads/recovery in Core.

### P2-4. Freeze concrete snapshot/apply wire, locking, hashing and caps

**Trigger/consequence.** A preview calls a convenient lock helper that creates state; permission validation copies fail-open behavior; Python and TypeScript hash different defaults/order; an oversized before-image is truncated; a direct writer slips through a template-only counter. These would invalidate the review/apply boundary.

**Evidence and exact proposal.**

#### Transaction and request contract

- Preview/result reads use `conn.transaction(isolation="repeatable_read", readonly=True)` and only SELECT from the existing namespace/Bank/generation, config and resource rows. `engine/db/postgresql.py:56-62` supports this. Native `replication.py:328-344,376-396` shows why `lock_replication_bank_state` is unsuitable for a read-only preview: it calls an INSERT-based ensure. Missing cursor/generation is unsupported/untracked, not permission to initialize it.
- Apply uses the authenticated schema and existing tenant Bank restrictions; preflight each actual config/create/update/delete/refresh read/write permission, including explicit null/removal. Recheck typed normalized input after hooks and deny every hook exception. `config_resolver.py:402-420` explicitly fails open on generic permission-hook errors; do not call that behavior unmodified. A model-disclosure grant from 5A is irrelevant.
- Enter `transition_writer_scope` outside the mutation transaction. Inside: verify and lock the existing replication Bank row/generation without revive; take maintenance owner and transition-fence locks; then Bank/resource/request/job locks. `bank_maintenance.py:98-120`, `transition_storage.py:155-164`, and `memory_engine.py:17495-17503` establish cursor -> maintenance owner -> transition fence -> canonical Bank order. Sort multiple resource selectors deterministically. Do not open independent public CRUD transactions.
- Reread the same-ID receipt before checking the now-stale original snapshot or provider availability for a new refresh. A previously committed result remains observable after later edits or provider outage, while current authorization/target identity still apply. Same ID plus changed immutable payload conflicts. Lock waiting/timeout is retryable/unknown, not evidence that another request failed.
- Use one per-authenticated-schema request UUID uniqueness boundary with Bank, provider lineage, generation and hash retained in the receipt, or equivalently an explicit unique index that rejects cross-target reuse. Bank-scoped authorization remains checked before looking up/reporting another target. The draft's same-ID/different-target refusal must be backed by storage uniqueness, not only the normal happy path.
- Reread exact selected override/resource projections under that lock. Definition update guards definition fields, resource incarnation and any definition-generation token; generated content alone need not invalidate it. A no-op still acquires an immutable accepted receipt but must not fabricate a native logical change. If the API promises one winner for *every* same-snapshot request, including no-ops, add a receipt-owned snapshot consumption sequence to the precondition in addition to actual Native projections; otherwise explicitly narrow one-winner to overlapping effective mutations. The latter is the smaller correct contract.
- Deletion guards the complete row and all removed history/dependencies, not `load_mental_model_logical_payload`, whose `replication.py:825` explicitly excludes embedding/history. Return an opaque complete-object deletion digest plus truthful count/size/consequence; do not require echoing generated content/history in the request. Recompute before DELETE. Relevant external writes still serialize on the real Bank cursor.
- New receipt/result/evidence tables participate in transition publication protection and backup inventory. Register required triggers/functions in `require_transition_schema` through a new migration; old migration bytes stay immutable. No direct SQL route may bypass final writer lease/fence validation merely because resource writes already ran.

#### Proposed finite wire bounds

The Native generic template/resource models leave many lengths unbounded; these are explicit **new lifecycle bounds derived from the narrower existing Taki client contract**, not claims about old Native endpoint limits. Reject entire oversized plans/snapshots, preserving existing Native state; never truncate or silently split one Bank transaction.

| Field | Freeze for lifecycle v1 | Current source / rationale |
| --- | --- | --- |
| Banks in a Core rollout | 1..256, unique exact identities | Shared setup/status and Native backup `MAX_BANK_IDS=256`; one Native apply always addresses one Bank. |
| Managed config selectors | Exactly the three existing mission/instruction keys plus the `entity_labels`/`taki-layer` group selector; max 4 | `taki-bank-template-v1.ts` and `hindsight-contracts.ts:73-78`. Preserve `entities_allow_free_form`; do not expose every Native config field merely because import accepts it. |
| Mental-model selectors/deltas | 0..64 unique IDs, refresh children <=64 and only for included existing/new models | `hindsight-contracts.ts:80-83,99`. Reject duplicate delta selectors. |
| Directive selectors/deltas | 0..64 unique captured UUIDs (create IDs minted before apply); no ambiguous name selection | `hindsight-contracts.ts:84-87`; Native directive CRUD uses UUID identity. |
| Resource/Bank identifiers | 1..256 Unicode scalars at most; model ID also existing lowercase alphanumeric-hyphen regex; UUIDs strict | D77 `TakiApplicationIdSchema` and Native current-state IDs cap at 256; narrower than legacy client `text` 512. Canonical Taki Bank mapping constraints still apply. |
| Names, ordinary tags, label values/group keys | 1..512 UTF-8 bytes; tags <=32 | Existing client `text` is 512 characters and tags cap at 32. Using bytes is a deliberate conservative common-language limit; old endpoints unchanged. |
| Mission/instruction/query/directive text | Up to 20,000 UTF-8 bytes; empty only where the action/schema explicitly permits it | Existing `templateText.max(20_000)`; use consistent byte checks in both new codecs. |
| Labels | <=32 total groups, <=64 values/group; exactly one owned `taki-layer` selector | `hindsight-contracts.ts:63-70`. Owned group is `type=value`, optional, with `tag=true`; user suppression and unrelated groups remain distinct. |
| `max_tokens` | Integer 256..8192 | Native `http.py:2241,2269,2289`; do not copy the legacy client's looser max 32,000. |
| Directive priority | Integer -1000..1000 | Existing Taki contract `:85`; Native generic integer is looser. |
| Trigger | Complete current `MentalModelTrigger` fields/validators, not just `refresh_after_consolidation` | Native `http.py:1875-2009`: mode, cron/exclusivity, fact_types, exclusions, tags_match/tag_groups, chunk budgets, response_schema and keep_trace all affect definitions. |
| Generic nested trigger/untouched label JSON | <=256 keys/items per container, keys <=128, strings <=20,000 bytes; depth <=32 and <=4096 total nodes | Container/key limits come from `hindsight-json-schema.ts:25-30`; depth/node budgets are explicitly new finite lifecycle policy. Preserve bytes/keys; no passthrough secret/environment/config fields. |
| Request and response | <=524,288 decoded UTF-8 bytes each; calculate before send/return, enforce request streaming cap before parsing | `hindsight-http-transport.ts:13` and Shared D77 response cap. Existing transport caps responses, not request size; add the new request boundary explicitly. Hash canonical bytes need not themselves be transmitted. |

Unrelated configurations/resources outside selected projections do not need copying into requests. If restoring the exact captured label-group base would require an unsupported/oversized group, refuse managed enrollment before effect. Do not erase the existing group to fit the new schema. For deletion, the Native-only full-object digest may be larger to calculate than the response; expose bounded summaries, never a truncated digest input.

The label-group selector has one important storage detail: Native `config_resolver.py:128-133,253-255` replaces the whole `entity_labels` field, not one nested group. Keep the original Bank field presence/base distinct from the active materialized list. For lifecycle v1, the bounded implementation can compose a complete list from the reviewed inherited/base groups plus the owned delta, CAS the complete stored list, and restore the original absent/tombstone state on removal. This preserves the reviewed unrelated groups, but while the Bank list is materialized a later server-default group change needs a fresh preview/reconciliation; do not promise live nested inheritance. Never record those resolved parent groups as historical Bank overrides. If live nested inheritance is a hard requirement, the leader must add a Native group-overlay resolver contract before dispatch; ordinary PATCH cannot supply it. The existing approved requirements do not explicitly require hot propagation of parent label-group changes, so the bounded reviewed-list behavior can be documented as an engineering choice.

#### Hash definition

Reuse the existing tested `hindsightCurrentStateJson` / Native `current_state_bytes` codec without changing it. They encode tagged JSON with UTF-8 key ordering and binary64 number bytes (`packages/shared/src/hindsight-current-state-encoding.ts:8-42`; Native `transfer/current_state_schema.py:36-75`). Wrap new domain objects with `domain: "taki-template-{request|snapshot|definition|deletion|receipt}.v1"` and hash their exact snake_case fields. This is substantially safer than introducing another Python/JS JSON canonicalizer.

- Parse/validate first; hash one documented normalized wire shape. Do not have only one side expand Pydantic defaults. The snapshot carries exact stored presence separately: `absent`, `null_tombstone`, or `value`; restoration can preserve inheritance without confusing it with an explicit value.
- Keep definition arrays in stored order, including tags and nested trigger arrays. Deterministically sort only selector sets/resource maps by the documented UTF-8 identity ordering before hashing. Reject duplicate selectors; do not silently deduplicate values that would change actual storage.
- Include every managed definition field and its presence/default semantics. UUID spelling canonicalizes to lowercase on both sides. Do not trim user text or normalize Unicode. Reject NaN/infinity/lone surrogates; ordinary count/revision integers stay within safe integer bounds.
- Request hash excludes its own hash but includes Bank/lineage/generation, explicit delta, full expected projections, resource IDs, refresh choices and child IDs. Snapshot digest is separate from the immutable receipt. Later content/definition edits never rewrite a historical receipt.
- Freeze cross-language vectors for astral/non-ASCII keys, `__proto__`, null vs absent, empty tags, reordered selectors, ordered tag arrays, every trigger field and binary64 values in response schemas. Do not reuse frozen v1 template digest or G1 receipt hash domains.

### P2-5. Restore needs template-state equality in addition to receipt membership

**Trigger/consequence.** A Core backup is taken before template application while Native backup is taken afterward. Current receipt membership/cursor checks can accept this pair even though runtime setup/template selection no longer describes Native state.

**Evidence.**

- `hindsight-backup-pair.ts:1-5,39-47` deliberately allows Native ahead of Core.
- `hindsight-backup-receipts.ts:17-35,45-47` lists current write kinds and collects only pending/application receipt IDs; there is no template proof.
- Native `admin/taki_backup.py:117-143` proves membership of only the operation IDs Core requested. An extra Native template receipt is invisible to an empty pre-template Core list.
- Native `admin/cli.py:42-110` requires complete FK-ordered persistent table inventory. Its REPEATABLE READ proof/copy is the correct place to capture new state.

**Bounded resolution.** Version the paired template evidence, leaving existing cursor-superset behavior intact for ordinary memory writes. Add a per-requested-Bank template summary to both Core backup identity and Native proof: exact generation, enrolled/legacy mode, current managed receipt/selection identity, complete managed effective projection digest, and whether unpublished template work exists. Compute the Native summary on the backup's own transaction. Require equality for the selected managed state; absent Core enrollment must not accept a new Native managed state. Unpublished/unknown partial rollout blocks normal capture (incident evidence remains separate).

Add the finite `template-operation:<...>` receipt mapping and verify complete original receipt identity/hash, not just row existence, before restoring writer availability. Use bounded printable IDs (existing backup ID cap is 256); a fixed UUID-based receipt key avoids concatenating arbitrary 256-character Bank IDs beyond the bound. Validate semantics again against restored actual resources before runtime binding, not just during ZIP admission. Keep legacy v1 pair parsing supported only for Banks that actually remain legacy and have no managed template history; do not default missing managed proof to success.

List every new Native template/refresh-result/label-evidence table after its actual FK parents, update live schema parity, and preserve Core overlay histories through normal SQLite copy. Test customized, removed/no-overlay and pre-Core/post-Native pairs. Do not require exact overall Native cursor equality or invalidate valid later ordinary memory changes.

### P2-6. Definition-only fresh enrollment is outside the current pristine initialization proof

**Trigger/consequence.** A fresh Bank receives an empty-content model definition with no refresh. The template apply is correct, but Stage 4 unused-target validation rejects it; alternatively an implementation fakes a refresh completion or resets `ever_used` to make it pass.

**Evidence.** Native `transition_initialization.py:92-143` binds initialization to original creation and journal evidence. `:247-296` requires matching admission/completion history; `_validate_final_template` at `:299-313` requires every current model to appear in a completion event. The e30 migration's trigger at `:358-379` permanently marks later unexplained writes used. These are stronger contracts than empty-content SQL nullability.

**Bounded resolution.** Extend genuine initial-enrollment evidence additively with a distinct definition-installed event, created on the same connection as the conditional template receipt. It records exact before/after definitions and the resulting complete empty-content model state; it never claims generated success. Initialization verification may accept that event only for an exact absent-resource insert with empty content, null embedding/structured/query tracking, no fabricated history, matching initial template and unchanged original creation identity. If refresh was requested, its real child admission/completion requirements remain separate. Later updates/removal, different initialization template, extra resources, direct writes or changed generation must still invalidate unused eligibility. Preserve legacy import evidence/verifier and existing server-default behavior; enrollment ownership alone never grants pristine eligibility.

Do not force the new initializer to treat Banks with preexisting server-default resources as pristine if current evidence cannot prove that. They may still be safely enrolled as existing managed bases while `unused_scope_unproven` remains truthful. This distinction needs a test, not an owner decision.

### P2-7. Collision/enrollment and compatibility activation need exact freeze points

**Trigger/consequence.** The PRD's collision-refusal rule is read as allowing automatic capture-and-overwrite of a same-name resource; or implementation chooses a migration/build ID before 5A releases shared files and then overwrites its compatibility changes.

**Evidence.** Draft PRD requires same-ID/name collision refusal while design permits captured preexisting base overlays. Current v1 never stored pre-Taki before-images (`hindsight-bank-setup-repo.ts` and v1 verifier). Live source now reports `taki-memory-hindsight-0.9.0-config-observation-v1` (`engine/taki_compatibility.py:39`). Current Core migration registry ends at 057; static parsing of all Native migration declarations yields the single head `e40b1e8a7d32`.

**Bounded resolution.**

- Name three enrollment states explicitly: fresh absent resource (creation ownership proved by atomic absent->insert), deliberately reviewed existing base overlay (capture proves restoration base, never creation ownership), and untracked legacy/collision (no automatic overwrite/delete). The apply preview must show intentional enrollment of a preexisting base. Duplicate directive names always refuse. An old exact v1 match cannot reconstruct before-v1 values. Force-adopting unknown legacy resources is not part of this dispatch.
- For removal, restore captured config presence/base definitions; preserve complete explicit user resources; delete only proven-created resources whose complete-object deletion guard was reviewed. A suppression is not an instruction to delete Native base resources. Resolve `user inherit` precisely as removal of that user-layer override so the current Taki/base layer is revealed; `no Taki` is a distinct selected overlay value. Avoid ambiguous use of the same null for both commands.
- Freeze Core migration 058 only after 5A release confirms 057 remains current. Allocate a new unique Native revision with `down_revision=e40b1e8a7d32` only after the same check. This review read source declarations only; it did not query a live database or claim migrations executed.
- Suggested finite build name: `taki-memory-hindsight-0.9.0-template-lifecycle-v1`, capability `template_lifecycle` version `1.0.0`. Keep exact old transition build(s) and exact 5A build supported, with 5A observation optional/intact. Do not widen prefix admission. Whole-manifest hashes invalidate old previews normally.
- Freeze OpenAPI/maintained SDK ownership with the Native/Shared/Core owner. Regenerate once the complete B1 wire (including exact label/restore evidence extensions) is stable, then again only if that contract changes. No Home owner should touch generator/compatibility/schema/migration files.

## Dispatch/check adjustment

Keep a single Native/Shared/Core implementation owner until the coherent producer is stable. A Home owner can work after typed operator contracts are frozen. The risk boundaries justify the existing three review milestones, with two ordering corrections:

1. **B1:** composition, ownership, complete finite wire, Native conditional commit and result lookup, stable refresh admission **plus claim/expected-definition/result publication**, migrations and initialization proof. Focused independent check: auth/lock order, concurrent duplicate/no-op semantics, fault rollback, source-byte/hash bounds, worker/Sync race and pre/post-provider crash.
2. **B2:** durable Core hold/executor/recovery/publication, active runtime/source custody, and actual trusted per-fact producer/consumer. Focused review: mixed Bank/restart safety, old executor rejection, no-overlay/legacy provisioning, classification provenance and policy restrictions. Add the backup proof **schema** early enough that B1/B2 persistence cannot become unaccounted terminal state.
3. **B3:** Home interactions, semantic paired restore, final generation/schema parity and consolidated adjacent gates, then one independent whole-slice check. Do not claim C16/C11, original-environment or installed/manual acceptance from this slice alone.

Tests use fresh isolated fixtures and deterministic fakes/fail-on-call providers. Do not repeatedly run the full Core suite during contract changes; use the focused producer milestone tests, then completed-slice affected checks. Preserve actual failing outputs and exit codes. Recheck only changed shared/boot/compatibility/transition behavior after fixes.

## Files found

Native paths below are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`.

| File | Relevant responsibility |
| --- | --- |
| `api/http.py` | Existing template/resource/trigger validation and generic limits. |
| `config_resolver.py` | Null-as-inheritance behavior, field permission hook and locked config persistence. |
| `engine/replication.py` | Bank cursor lock, canonical resource projections and journal publication. |
| `engine/native_operation_receipts.py` | Existing-state generation lock and immutable request/result patterns. |
| `engine/memory_engine.py` | Actual model creation/refresh/update, admission and task settlement seams. |
| `engine/task_backend.py`, `worker/poller.py`, `engine/db/ops_postgresql.py` | Sync execution versus persisted Worker claim/retry. |
| `engine/retain/fact_extraction.py`, `entity_labels.py`, `entity_processing.py` | Structured per-fact labels, tag projection and content-wide entity merge. |
| `native_requests.py` | Caller-supplied entity/tag input. |
| `engine/transition_writers.py`, `transition_storage.py`, `transition_initialization.py` | Live writer permits, lock inventory and pristine provenance. |
| `engine/bank_maintenance.py` | Cursor/owner lock ordering and maintenance admission. |
| `engine/transfer/current_state_schema.py` | Existing cross-language canonical JSON codec. |
| `admin/cli.py`, `admin/taki_backup.py` | Exact snapshot/table coverage and receipt-membership proof. |
| `engine/taki_compatibility.py` | Current 5A build and optional contracts. |
| `alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py` | Existing publication/initialization trigger behavior. |
| `alembic/versions/e40b1e8a7d32_optimize_transition_association_lookup.py` | Current source migration head. |

Taki paths are relative to `H:/TakiAgent/`.

| File | Relevant responsibility |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-contracts.ts` | Existing bounded template client schemas. |
| `packages/shared/src/hindsight-json-schema.ts`, `hindsight-current-state-encoding.ts` | JSON domain validation and portable canonical hashing. |
| `packages/shared/src/hindsight-application-primitives-schema.ts` | Existing ID and response bounds. |
| `packages/core/src/memory/hindsight/hindsight-http-transport.ts` | Decoded response cap and request behavior. |
| `packages/core/src/memory/hindsight/hindsight-application-binding-context.ts`, `hindsight-application-policy.ts` | Exact first-binding label seam and neutral/pinned/mood safeguards. |
| `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts`, `hindsight-writer-fence.ts` | Current runtime drift and in-memory backup write hold. |
| `packages/core/src/memory/operations/memory-operation-contract.ts`, `memory-operation-service.ts`, `memory-operation-kind-transition.ts` | Family exclusion, boot observation and receipt-based producer integration. |
| `packages/core/src/db/memory-operation-repo.ts`, `migrations/048-memory-operations.ts` | Actual generic claim/restart limitations. |
| `packages/core/src/db/memory-transition-publication-repo.ts` | Final synchronous publication/read-back/live-clock precedent. |
| `packages/core/src/memory/hindsight-backup/hindsight-backup-receipts.ts`, `hindsight-backup-pair.ts` | Terminal receipt map and Native-ahead pair rule. |
| `packages/core/src/db/migrations/index-list.ts` | Current Core head 057. |

## External references / versions

No network/external reference fetch was needed. Current local Native source is Hindsight 0.9.0 with the actively implemented 5A compatibility extension. Source declarations, not a running instance, supplied the build/migration observations. The retained v1 template catalog and existing D77/D78/G1 codec/receipt contracts are compatibility boundaries, not rewrite targets.

## Related specs

- `.trellis/workflow.md`: source-based planning, persisted research and reviewed activation.
- `.trellis/spec/backend/index.md`, `database-guidelines.md`, `sqlite-migration-lineage.md`: additive immutable migrations and synchronous Core ownership.
- `.trellis/spec/backend/memory-operations.md`, `memory-hindsight-lifecycle.md`: durable operation/admission/observation and runtime replacement.
- `.trellis/spec/backend/hindsight-application-runtime.md`: exact Native evidence and trusted per-unit/neutral policy.
- `.trellis/spec/backend/memory-hindsight-backup.md`: paired proof, custody and restore admission.
- `.trellis/spec/backend/memory-transition-publication.md`: full read-back then live final publication guard.

## Caveats / Not Found

- No tests, services, model/embedding calls, credentials, original data, dependencies, Git operations, production files, sibling task artifacts, specs or task binding/status were changed. This document is design research, not runtime verification.
- 5A Native/Shared/Core and Home implementation was active while this review read source. Exact build/migration ownership must be rechecked at release; this review did not redo 5A acceptance.
- No existing template executor lease, durable partial-runtime hold, per-fact structured-label provenance or exact overlay backup equality was found in the directly inspected owners. These must be real producers in the implementation, not status fields inferred from current tags/content/receipts.
- Some exact-path probes returned not-found during source navigation; the evidence above uses the actual subsequently found files. No semantic index or old memory was used as source truth.

## Resolution confirmation: 2026-10-07

- Query/scope: bounded confirmation of the leader's incorporated seven resolutions in sibling `10-07-hindsight-template-lifecycle/{prd.md,design.md,implement.md,research/design-review-resolution.md}`. No new code discovery, execution or source modifications.
- Reviewed SHA-256: PRD `9424e5784e906bc04744ab17cb1df33d3fa7552dcfd97b6cc835f61109bc66dc`; design `395ec18f7f5f37a6e4a5443dbbb234f7eb94a1cb8c0ee4b942efc45b1d862c1d`; implementation plan `166ce8e1a2cdb196a962383e3dd7391c1fb613be65d2803b21fcab2e1098a552`; resolution map `97f431a2434e61e96dafb86be3b63b388d00c77454e3491df424ec82a6d035d2`.
- Result: all seven original engineering fixes are captured coherently. One contradictory removal clause below should be corrected before dispatch; no new owner product decision is needed.

| Original finding | Confirmation |
| --- | --- |
| P1-1 durable hold/executor | Design section 4 now explicitly adds generation/token/boot/lease/checkpoint CAS, 300-second/30-second initial bounded timing, hold surviving failed/unknown/restart, global runtime admission and original-only recovery, plus atomic hold release/final guard. B2 and PRD explicitly cover this. |
| P1-2 classification provenance | Section 5 names the structured-result producer before caller merge, server-owned exact-version sidecar, mutation invalidation/read preload and neutral/original-policy rules. B2 owns actual producer and consumer. |
| P1-3 refresh execution/result | Section 3 and B1 now own persisted Sync/Worker claims, apply-time object and definition checks, live owner validation and the atomic child result marker. Provider retry limits remain truthful. |
| P2-4 finite read/CAS/hash/caps | Section 8 freezes finite limits, existing codec/new domains, read-only repeatable reads, actual lock order, authenticated-schema uniqueness and receipt-first replay. PRD/implementation agree on one winner for overlapping effective mutations, with independent no-op receipts allowed. |
| P2-5 restore equality | Section 6 and B3 distinguish managed-template equality from permitted ordinary Native-ahead cursors, include all new evidence tables, and refuse absent-Core/new-Native or unpublished template state. |
| P2-6 pristine definition-only | Section 6/B1 name the distinct definition-installed event and preserve actual refresh evidence, original creation identity, old import proof and truthful server-default limitations. |
| P2-7 enrollment/compatibility | Section 1/PRD distinguish fresh creation, explicitly reviewed base enrollment and untracked collisions. Section 8 preserves exact builds/whole-manifest checks, freezes heads only after 5A release, and assigns generator/schema ownership. |

### Remaining P2-R1: label-group removal must compose surviving user overrides

**Evidence.** Revised `design.md:43-45` says: "CAS that complete list and restore original absence/tombstone on removal." Read literally, that instructs implementation to clear the Bank-level `entity_labels` field even when an explicit user customization still needs that field. This conflicts with the highest-precedence composition at `design.md:23-24,39-41` and PRD acceptance that removing Taki preserves explicit user settings. The general resource-preservation clause at `design.md:53-54` does not explicitly qualify this config-field instruction.

**Trigger/consequence.** Begin with inherited labels (no original Bank override), apply Taki's materialized group, explicitly customize/suppress a label group through the user layer, then remove Taki. An unconditional tombstone discards the surviving user layer and may re-enable a suppressed inherited group.

**Exact bounded correction.** Replace the removal sentence with: "On Taki removal, recompute the complete field from the captured base and every surviving explicit user override/suppression. Restore original absence/tombstone only when the composed user/base result requires no Bank override; otherwise retain the complete materialized user result. A fresh preview is required for parent-group changes while materialized." Existing-original explicit lists must likewise be restored only after applying surviving user choices, not in place of them.

Keep the chosen reviewed-materialized-list behavior; this correction does not introduce live nested inheritance. Add the already-in-scope composition regression: inherited base -> Taki apply -> explicit user label edit/suppression -> remove Taki preserves the user result; removing the final user override afterward restores inheritance. This belongs to B1 composition tests and the Home removal preview, without a new review cycle or product question.

After this focused clause correction, the reviewed design is ready for dispatch subject to the existing 5A ownership release and actual head/build recheck. This confirmation does not activate the task or claim implementation/test acceptance.

### Final closure: P2-R1 resolved, 2026-10-07

Read-back confirms `design.md:44-49` now recomposes captured base plus surviving explicit user group values/suppression and restores absence/tombstone only when no Bank override is needed. PRD `:47-49` explicitly requires preserving surviving user label overrides. This exactly closes P2-R1; the prior remaining-finding paragraph is retained as review history, not an open blocker.

Final status: **design review PASS; no material design findings remain open within this bounded review**. Activation still waits for 5A source/check ownership release and actual migration/build head validation. No implementation, tests, source edits or additional follow-up were performed or requested by this closure.

Read-back SHA-256: design `35de1dfe675732c9fbcb54b3d0cea6c45fee6d9776f16d49065f5911777995ff`; PRD `9424e5784e906bc04744ab17cb1df33d3fa7552dcfd97b6cc835f61109bc66dc`.
