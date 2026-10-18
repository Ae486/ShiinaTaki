# Research: Stage 5B template and user-overlay lifecycle

- Query: Identify the smallest implementable lifecycle that completes C16 without losing Native defaults, user overrides, provenance, or active-runtime safety.
- Scope: internal; current Taki and local Hindsight source. Research only.
- Date: 2026-10-07.
- Task: `.trellis/tasks/10-07-hindsight-configuration-observation`, explicitly supplied by the leader; the legacy `.trellis/.current-task` is empty and the workflow documents session-scoped resolution. Only this report is owned by the researcher.

## Findings

### 1. Recommended implementation boundary

5B is a substantial independent slice and should receive its own implementation and independent check. It crosses configuration composition, two databases, Native mutation/recovery, active runtime admission, taxonomy, and Home. Do not merge its review into 5A or treat it as an edit to the v1 constant.

Recommended minimal structure:

1. Core owns immutable built-in templates, separately versioned user overrides, explicit ownership/before-images, and the desired rollout plan. Native remains the source of actual applied configuration/resources.
2. Add one narrow Native **conditional, idempotent, per-Bank template-mutation producer**. It checks an exact target incarnation and resource projection, applies the requested configuration/resource delta with its logical changes, and commits a request receipt in the same transaction. Existing public import/PATCH/DELETE calls do not provide that combined contract.
3. Reuse the Core memory-operation owner for an immutable multi-Bank rollout and interruption recovery. Do not introduce another scheduler or operation ledger. A Native transaction is atomic per Bank; a rollout across Banks is durable forward progress, not a claimed distributed transaction.
4. Extend existing setup/provision/revalidate/runtime consumers to verify the selected effective overlay receipt rather than unconditionally compare every Bank against pristine v1. Preserve the legacy path and its refusal behavior until a Bank is explicitly enrolled.
5. Ship the owned `taki-layer` label-group configuration together with a real, exact-version Core label consumer and current neutral fallback. Home ships alongside the producer.

This is a recommendation for 5B artifacts, not an existing endpoint or approved schema name. 5A source files are being edited concurrently; source line anchors below were read directly, not taken from a semantic index. Recheck moved line numbers and migration heads at dispatch.

### 2. Accepted requirements; no new taxonomy or precedence decision

- Parent `.trellis/tasks/08-09-hindsight-memory-provider/prd.md:44` makes layers per-memory labels, not Banks.
- Parent `prd.md:60` settles additive Taki templates with user overrides as a separate highest-precedence layer.
- Parent `prd.md:85-86` requires logical changes/tombstones, revision-checked mutation and atomic layer entity/tag synchronization; Native changes must be evidence-backed compatibility work.
- Parent `prd.md:114-119` requires controlled per-fact `taki-layer:*` labels and `unclassified` fallback.
- Audit `.trellis/tasks/09-14-hindsight-integration-completeness-audit/research/closure-plan.md:69` defines C16: fresh Banks, controlled per-fact layers, independent revisions, apply/customize/preview/update/remove, and preservation through restore/upgrade.
- `packages/core/src/memory/layer-registry.ts:30` is the existing taxonomy: Global `profile`, `activity`; Character `relationship`, `episodes`, `intentions`. `relationship` is pinned; `intentions` is mood-gated. Do not invent another list, turn all labels into writable layers, or promote a pinned label automatically.

### 3. Files found and executable patterns

All Native paths below are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`; Taki paths are relative to `H:/TakiAgent/`.

| File / current anchor | Verified behavior and implication |
| --- | --- |
| Taki `packages/core/src/memory/hindsight/taki-bank-template-v1.ts:14,29-66` | Only `taki-bank-v1`; three config keys, one stable model ID and one directive name per scope. The built-in owns `retain_mission`, `observations_instructions`, `reflect_mission`. There is no label group or user overlay. |
| Same `:85-124` | Verification compares owned config and model/directive definitions, ignoring unrelated fields. Model projection does not compare `trigger`; any new effective-definition hash must include every managed definition field, including trigger. |
| Taki `hindsight-bank-setup.ts:29-53` | Creates Bank, imports, records operation IDs, polls refresh, exports/verifies. A verified row still compares against the original fixed template. This is setup evidence, not independent ownership or user history. |
| Taki `hindsight-setup-stages.ts:12-32` | Builds both scope templates and invokes Native dry-run. Reuse pure template construction and bounded preflight, but dry-run is not a state-bound CAS preview. |
| Taki `packages/core/src/db/hindsight-bank-setup-repo.ts:16-25` | Stores one mutable revision/digest/status per canonical identity; `upsert` has no expected revision. No before-image, user revision, or exact Native receipt. Keep it as a setup/readiness projection; do not make its unconditional upsert the new mutation arbiter. |
| Native `api/http.py:2599-2720,2767-2849` | Import merges config, matches mental models by ID/directives by name, then updates/creates each separately. Every included model schedules `submit_async_refresh_mental_model`, even when already present. Empty tag lists become `None` on updates and therefore do not reliably clear prior tags. Import never deletes resources omitted from a manifest. |
| Native `engine/memory_engine.py:11766-11874` | Import preauthorizes all child writes/refresh reads and holds a transition writer across import. This prevents a transition fence slipping between children; it is **not** a transaction encompassing all resource writes. |
| Native `engine/transition_initialization.py:147-173` | Begins and completes initialization evidence in separate transactions around the import. It records pristine-Bank provenance, not rollback or a general active-Bank template receipt. |
| Native `api/http.py:6649-6711` | Export returns active Bank overrides, model definitions and directives. It omits directive UUIDs and model generated content/history; its reads are separate. It cannot alone prove a coherent CAS snapshot or a complete removable-resource before-image. |
| Native `config_resolver.py:267-298,304-338` | **JSON null is already a tombstone**: single and bulk loaders filter it, restoring inherited server/tenant defaults. Per-key effective removal can reuse PATCH-null semantics. It is incorrect to claim whole-Bank reset is required. |
| Native `config_resolver.py:485-542,567` | PATCH merges under a Bank/replication lock and emits a Bank logical change. Reset removes all Bank overrides. Neither accepts an expected resource revision. Reset is unsuitable for removing just Taki. |
| Native `config_resolver.py:376-420` | Rejects credentials/static fields and consults configurable-field permissions. Its legacy generic-exception path logs and continues; a new mutation boundary must explicitly fail closed on permission-hook failure rather than inherit that failure behavior. |
| Native `engine/memory_engine.py:13836-13969` | Model creation computes an embedding before SQL and commits the new row plus logical change. It is not a zero-provider-call primitive. |
| Native `engine/memory_engine.py:14879-14962` | Model update accepts definition/content fields but no public expected revision. Content updates may embed before SQL. Existing cutover-proof replay is tied to that producer and is not authorization to reuse it for a new template request. |
| Native `engine/memory_engine.py:15303-15365,16286-16379,16421-16474` | Model DELETE uses Bank + model ID; directive PATCH/DELETE uses Bank + UUID. SQL changes/tombstones are atomic per call, not across calls. Use exact UUIDs, not a fresh name lookup, for deletion. |
| Native `engine/replication.py:737,882,901,1006,1025` | Existing authoritative Bank/model/directive upsert/tombstone builders should be reused by the new transaction. Do not write resource rows without the corresponding journal evidence. |
| Taki `packages/core/src/memory/operations/memory-operation-kinds.ts:24-38` | Real closed operation registry already owns setup, lifecycle, backup and transitions. Add one cohesive template family/handler with action-specific plans. |
| Taki `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:50-69` | Runtime construction refuses mismatched desired template revisions; live fingerprint drift degrades the runtime. These guards must learn verified overlay state, not be removed. |
| Taki `hindsight-compatibility-service.ts:112-126` | Connection fingerprint includes desired template revision, model settings and secret marker. Do not silently redefine historical connection fingerprints to add overlay history. |
| Taki `packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-reads.ts:38-43,73-85` | Global's verified revision controls new Character provisioning; normal revalidation refuses template changes. New managed state must propagate through these explicit consumers. |
| Taki `hindsight-lifecycle-revalidate.ts:67-83` | Revalidation exports/verifies every verified Bank and records reviewed connection/admission. Replace only the enrolled-Bank verification rule and keep exact lineage/epoch/connection checks. |
| Native `admin/cli.py:42-110,260-278,336` | Backup has an explicit FK-ordered table list and REPEATABLE READ capture; newly added tables must be listed (or correctly declared as extension tables). The list is covered by schema parity tests. |

### 4. Data ownership and overlay composition

Keep four concepts separate:

| Concept | Owner / representation |
| --- | --- |
| Built-in version | Immutable scope-specific catalog value plus digest; retain v1 bytes. Add a later version for taxonomy rather than rewriting v1. |
| User revision | Core CAS sequence for an exact Bank identity, independent of built-in version. Store explicit changes, suppression and inherit as distinct operations. |
| Native base / ownership | Capture actual **Bank override presence and value**, exact resource identity and definition before first managed application. Absence means inherit current Native global/tenant defaults; never freeze resolved server defaults as a synthetic Bank override. |
| Applied evidence | Native request receipt binds request/hash, namespace/Bank generation, prior and resulting resource projections. Core publishes that receipt with selected revisions and setup status. A matching current export without a receipt does not establish ownership or exact prior outcome. |

Recommended Core additive storage is immutable per-Bank overlay revisions/before-images plus an applied selection using expected revision. The existing operation row owns execution phase; do not mirror an independent operation state machine into the overlay table. Key state by connection/provider lineage + canonical identity + Bank incarnation, not `bank_id` alone. New Native durable storage can be limited to idempotent mutation requests/receipts; Native need not become the owner of Taki-specific template or taxonomy policy.

Composition rules:

- Native inherited defaults and unrelated existing Bank overrides/resources survive. Taki contributes its owned values; user values win even when equal to an old template value. Equality is not evidence that the user did not explicitly choose it.
- Configuration edits use tri-state semantics: inherit, explicit value, and explicit suppression/release as applicable. For a removed Taki key with no prior Bank override or user override, write the existing null tombstone (or equivalent exact key deletion inside the new transaction). With a captured preexisting override, restore that value.
- Merge `entity_labels` by exact group key. Taki owns `taki-layer`, not the entire list. Preserve Native/user label groups and free-form entities. Do not set `entities_allow_free_form=false` as a side effect of adding layer classification.
- Model identity is Bank + ID; directive identity is Bank + captured UUID. Names/tags aid display and enrollment checks but do not prove ownership. Reject duplicate matching directive names or ambiguous existing resources instead of choosing the last item from a map.
- A user-customized resource needs a complete effective definition or a durable base reference plus patch. On template removal, preserve a complete user-owned resource; do not leave a patch whose required base fields have disappeared. A deliberate user suppression must not be undone by a later template version.
- Delete only resources proven created/owned by this managed overlay and explicitly present in the preview. Restore captured preexisting definitions for overlaid resources. Generated content/history may exist: deletion needs an exact current object precondition and must be shown as resource deletion; it cannot be inferred from the small export definition.
- External edits after the last receipt are drift. Preserve and report them; do not silently overwrite or relabel them as user-owned. A new preview can explicitly adopt eligible edits into a user revision with a fresh CAS boundary.
- New Character provisioning uses the currently admitted scope-specific built-in revision. Character-specific customization stays on its original Bank; do not copy one Character's overrides to another. Any future cross-Character defaults are a separate explicit setting, not an inferred propagation rule.

**Legacy limitation:** existing v1 setup did not retain pre-application Native values or resource ownership. Exact v1 equality and `taki-owned` tags cannot recover overwritten historical user settings or prove that a same-ID resource did not preexist. Enroll a legacy Bank only with evidence-qualified ownership; otherwise expose an explicit conflict/untracked state. Fresh managed Banks can fully satisfy preservation. Do not silently backfill invented before-images. The owner only needs a decision if they later want to force migration/removal of such an actual legacy Bank without adequate backup/evidence; that is not required to begin implementation.

### 5. Minimal Native producer and effect boundaries

The missing primitive is not a DELETE API. It is a single authenticated conditional mutation with an exact recoverable outcome across Bank config, definitions and deletions.

Recommended wire actions are preview/read, apply and read-original-result (names to settle in design):

- Preview performs no Bank creation, writes, embedding, model call or refresh scheduling. It returns a bounded coherent snapshot containing target incarnation, per-resource identity/version/hash, active Bank-override presence, owned-group projection and a digest. Ordinary template export remains useful for display/legacy verification, not the mutation guard.
- Apply supplies one Core-minted request ID, immutable plan hash and expected snapshot. Authenticate against the actual schema; enforce Bank restrictions, operation validators, field permissions and all requested create/update/delete decisions before effect preparation.
- Read an existing receipt first. Same request and same hash returns the original outcome; same ID with different target/hash refuses. A read-back of the current resource state is separate from historical completion.
- Prepare genuinely necessary embeddings outside the database transaction and expose that potential provider work in the action plan. The implementation/test environment uses fail-on-call or deterministic fakes, never original instances or paid services.
- Enter the existing transition writer boundary. In one SQL transaction, take the established replication/Bank locks, recheck target incarnation and the expected projections, apply exact deltas, append logical changes, and commit the receipt. Reuse/extract private validated SQL helpers; invoking existing public methods inside an outer transaction does not make their independently acquired connections atomic.
- A native direct writer racing the preview is serialized by the same underlying resource/replication locks and causes a precondition failure. A template-only version counter that ordinary Native writers do not increment is insufficient.
- Model definitions and generated content are separate outcomes. Do not inherit import's unconditional refresh-per-model behavior. Preserve content when changing only definitions and mark freshness truthfully. Where generation is required, admit an explicit tracked Native refresh exactly once after definition publication, with its durable ID and separate pending/failed result. Do not show generated content as current until the actual producer proves it.
- Never run paid/model work while holding SQL locks. Lost responses must be resolved through original receipts; no blind re-import or fresh refresh ID.
- Preserve pristine-Bank initialization provenance for genuine initial enrollment. An active-Bank update is normal use and cannot reset `ever_used` or manufacture a new pristine birth. New producer tests must cover Stage 4 unused-target admission; the existing initialization context alone does not support an arbitrary general lifecycle.

The exact reuse/extraction of embedding preparation and async refresh admission belongs to implementation design. No public generic transaction endpoint, new admin credential, or unrestricted config patch surface is needed.

### 6. Core end-to-end state and interruption recovery

Suggested phases, carried by the existing durable operation adapter:

`admitted -> preparing -> quiescing -> applying(bank cursor) -> verifying -> publishing -> rebinding -> completed`

- **Admission:** snapshot authority epoch, connection/secret/config identity, selected template and user revisions, Bank set/incarnations, immutable plan hash and Native request IDs. Acquire the existing exclusive operation family so setup/provision/transition/backup cannot interleave.
- **Quiesce:** for an active Hindsight runtime, drain relevant foreground and background work through existing lifecycle boundaries before changing behavior. Keep new Run admission degraded/closed while the rollout is partial. A local operation row alone does not stop Native writers; Native CAS/writer boundaries still apply.
- **Apply:** process the fixed Bank list; persist each original request identity before dispatch. One Bank transaction may commit before another fails. Preserve confirmed receipts and continue the same plan; never claim global rollback or mutate prior receipt history.
- **Verify:** verify exact current definitions/config and the Native receipt, then synchronize resulting logical changes. If generated model work is outstanding, report definition-applied/derived-pending separately.
- **Publish:** one short synchronous Core transaction CASes selected revisions, applied receipt/digest and relevant setup/readiness projections. Recheck operation ownership/lease, current epoch, connection and all Bank identities immediately before commit. No Native I/O inside SQLite.
- **Rebind:** reuse the runtime binding replacement seam. A post-publication bind failure keeps committed selection and reports binding unavailable; recovery rebinds that same selection rather than reapplying Native writes.
- **Restart/lost reply:** query each original Native result, verify its plan identity, continue unfinished Banks, and never infer success from the disappearance of an operation. A Native/connection identity mismatch is reconciliation-required. New preview is required when external drift prevents the original precondition.
- **Cancel:** allowed before any irreversible dispatch. After a known per-Bank commit, stop at a recoverable boundary and report partial application; do not label it cancelled-with-no-effect or auto-compensate over new user edits.
- **Removal:** does not disable Hindsight or change authority. Introduce an explicit admitted no-Taki-overlay state that runtime verification understands; user resources and inherited Native behavior remain usable. Do not fake removal by marking setup failed or applying an empty v1 manifest.
- **Observers:** Home observes the original Core operation ID after reconnect. Status reads do not replay commands, run model refresh, or promote desired state to applied state.

Built-in revision rollout should include the actual provisioned Bank set before publishing its connection-wide default, while per-Bank user customization remains independent. Keep old desired-setting fingerprints/receipts intact; use a separate overlay selection identity for the new runtime guard rather than rewriting prior fingerprint inputs.

### 7. Per-fact taxonomy: configuration AND consumption are needed

Native already supplies the useful extraction mechanism:

- `engine/retain/entity_labels.py:33-42,172-227`: a `type="value"` group with a finite enum and optional null; `tag=True` enables tag projection.
- `engine/retain/fact_extraction.py:1136-1181`: builds the actual per-fact structured `labels` schema.
- Same file `:1549-1598,2344-2388`: converts each fact's selected label into a label entity in both extraction paths.
- Same file `:2497,2716,2811-2823`: injects tags after fact extraction.
- `entity_labels.py:300-331`: re-derives controlled tags from final entities while preserving unrelated tags. It does not invent `unclassified` for an absent value, or independently validate a raw entity string against the enum.

Add a `taki-layer` enum group from the existing registry filtered by Bank scope, plus `unclassified`. Permit absent/uncertain classification and explain the neutral choice; do not require a confident class for every fact. Its `tag=True` setting is essential. Preserve free-form entities and all non-owned label groups. User override/suppression is still highest precedence; display when it disables the controlled taxonomy rather than secretly overriding the user.

**Current Core gap:** `packages/core/src/memory/hindsight/hindsight-application-binding-context.ts:91-110` initializes a newly observed Native memory without passing a `label`. `hindsight-application-policy.ts:88-104` therefore chooses neutral even if Native supplied a label. Merely adding `entity_labels` does not prove the final Memory Layer assignment.

Reuse the supported `HindsightTrustedUnitLabel` argument with the exact observed Native namespace/object revision/hash. Admit only one valid scope-compatible Native label, and never borrow a source-wide or caller-supplied tag as per-fact proof. `hindsight-application-policy.ts:134-145` already rejects pinned layers, incompatible ownership and mood-gated labels without disclosure; keep those checks. Existing original/curated policies take precedence over fresh inference.

Expected safe outcomes:

- A valid Global profile or Character episodes fact can get the registry policy through exact per-unit evidence.
- Absent/malformed/multiple/unknown/cross-scope labels remain `unclassified`, default importance, retrieved visibility, permanent neutral retention and due assessment.
- A `relationship` label cannot mint always-visible/pinned memory. An `intentions` label without real disclosure remains neutral. Template instructions must not invent the missing disclosure.
- `hindsight-policy-admission.ts:58` projects one canonical policy layer tag while leaving exact Native evidence intact; preserve this separation. Existing tests at `hindsight-application-policy.test.ts:142-171` are executable examples of the fallback.
- No taxonomy edit re-extracts old documents or mass-reclassifies existing curated facts. That would exceed this lifecycle slice and the deferred curator work.

### 8. Backup, restore, migration and compatibility

- Core overlay history and selections live in Core SQLite, so the existing paired full Core copy preserves them. Add migration/reopen tests and semantic verification; the fact that bytes are copied does not prove the restored selected receipt matches Native.
- Add Native request/receipt tables to the explicit admin backup list, FK order and table parity test. New terminal operation kinds must be represented in the Taki backup receipt map/pair proof where that map requires remote receipts; do not leave an unsupported terminal ID silently unverified.
- Restore verifies Bank generation, applied plan/selection digests, current effective resources and original request receipts. A Core snapshot from before application paired with Native from after application must refuse, not automatically import the old template.
- Carry selected overlays/ownership across healthy return/reentry through retained Core state and exact per-Bank binding reconciliation. If a restored/recreated Native Bank changes incarnation, old ownership cannot be transferred by Bank ID alone.
- Add new immutable migrations at the then-current heads; do not edit applied Core/Native migrations or pretend old Banks had managed user revisions. Old valid v1 Banks remain supported in legacy mode; unsupported Native lacks mutation capability and gets a truthful unavailable action.
- Introduce a finite optional compatibility contract/build identity coordinated with 5A's changes. Keep old exact build support and existing whole-manifest stale-preview rules; do not widen compatibility with a prefix match or rewrite saved evidence.
- Candidate upgrade itself remains 5D. 5B supplies restorable template/user state and isolated restore evidence; it cannot close the entire C11 upgrade or Stage 6 installed/manual acceptance.

### 9. Exact acceptance and check grouping

| Group | Necessary tests |
| --- | --- |
| Composition / independent revisions | Built-in update leaves explicit user value unchanged, including a value equal to old template; removing user override reveals current Taki/base; removing Taki preserves user resources and prior Bank overrides; absent base inherits current Native default; unrelated config/labels/resources unchanged; explicit suppression survives update. |
| Ownership / enrollment | Fresh absent resources acquire ownership; preexisting same-ID/name collision refuses; duplicate directive names refuse; legacy-v1 missing before-images remain untracked; exact UUID deletion; external change since preview refuses with no overwrite. |
| Native atomicity / auth | Actual authenticated route; wrong namespace/Bank/validator/field permission denied before effect; permission-hook exceptions deny; fault after each resource write rolls back all rows, logical events and receipt; two concurrent requests against one expected snapshot have one winner. |
| Idempotency / derived work | Same ID/hash returns original receipt without a second mutation/embedding/refresh; different hash refuses; loss before and after commit; definition update preserves generated content; empty tags genuinely clear; refresh pending/failure remains distinct; preview makes zero writes/provider calls. |
| Taxonomy end to end | Fresh Global and Character config -> actual extraction schema with fake structured model -> per-fact entities/tags -> replica/application binding -> canonical policy; valid same-scope cases; missing/null/unknown/multiple/cross-scope; pinned relationship and missing-disclosure intentions neutral; original curated policy preserved; both Native extraction paths exercised. |
| Active runtime / interruption | Quiesce and concurrent Run/auto-provision/backup/transition exclusion; crash at every phase; partial multi-Bank commit; expired/replaced Core lease at publication; changed secret/config/epoch/Bank generation; post-commit bind failure recovers binding only; new Character gets admitted built-in version. |
| Backup / migration / compatibility | Fresh/historical/reopen Core and Native migrations; paired isolated restore of customized/removed overlay; mismatched pair refuses; new table parity and receipt map; old build without capability; 5A build preserved; stale whole-manifest preview; healthy return/reentry and pristine target provenance regressions. |
| Home | Operator-only actual dispatcher; preview diff includes deletions and provider work; separate desired/applied/derived states; two observers; reconnect observes original operation; stale preview, conflict, unsupported, partial application, failure and recovery are actionable without browser-local truth. |

Use one implementation owner for Native/Shared/Core schema, admission, registry and runtime changes; Home can be delegated only after the contracts are stable and with disjoint file ownership. Suggested milestones:

1. Pure overlay composition + Native transaction/receipt + additive schemas: focused tests, then a targeted transaction/auth review before layering more behavior.
2. Core operation recovery + runtime + taxonomy producer/consumer: targeted integration tests and cross-layer review, including source custody/transition interaction.
3. Home and full-slice closure: one independent checker covering all of 5B, affected-package checks and selected adjacent regressions. Reuse unchanged 5A evidence, but recheck shared manifest/client/boot files actually modified by 5B.

This may still use one implementation agent serially. The separation is by risk milestones, not arbitrary function count. Do not run full Core suites repeatedly while contracts are still changing; run the appropriate full affected scope at the completed slice, retain real failures/exit codes, and rerun only impacted checks after fixes.

## External References / Versions

No network research or external model/service execution. Dependency source is local Hindsight API 0.9.0 and its maintained Taki compatibility extension. Native `CLAUDE.md` requires endpoint/OpenAPI/client artifact synchronization. Exact future build IDs and migration versions must be selected against the live post-5A source, not copied from this report.

## Related Specs

- `.trellis/workflow.md`: persisted research and independent implementation/check dispatch.
- `.trellis/spec/backend/index.md`, `database-guidelines.md`: Core database ownership, migrations and synchronous transaction boundaries.
- `.trellis/spec/backend/memory-operations.md`: existing operation owner, observation and recovery.
- `.trellis/spec/backend/memory-hindsight-lifecycle.md`: setup verification, template-change refusal, degraded runtime and binding replacement.
- `.trellis/spec/backend/hindsight-application-runtime.md`: exact Native evidence, original/curated policy and neutral fallback.
- `.trellis/spec/backend/memory-hindsight-backup.md`, `memory-transitions.md`, `memory-transition-publication.md`: paired receipts, custody, immutable operation identity and final guard.
- `.trellis/spec/frontend/memory-transitions.md`: operation observation/reconnect and truthful outcomes.
- `.trellis/spec/guides/index.md`: source grounding and cross-layer consistency.

## Caveats / Not Found

- No tests, services, models, original data/credentials, dependency changes, Git actions or production writes were performed. This is current-source research, not executed acceptance.
- No complete existing independent template/user-overlay lifecycle or public atomic template-CAS contract was found in the directly inspected setup/Native mutation paths.
- The important reusable correction is PATCH-null's existing inherited-default semantics; do not build a new key-deletion endpoint merely because the raw JSON retains tombstones.
- Existing v1 history cannot prove lost pre-v1 values; preservation must be evidence-qualified. No owner question blocks building the strict fresh/enrollable path. Actual destructive enrollment of an unresolved legacy collision requires its own concrete review later.
- Adding the group alone fails the C16 consumer requirement: the current first-binding production call omits the trusted label argument. This is a required 5B code path, not deferred daily policy reclassification.
- The new atomic Native producer is the substantive compatibility change. Do not substitute sequential public import/DELETE calls plus a Core success flag, or mistake transition writer admission for SQL atomicity.

## Follow-up: definition-only creation, stable refresh admission and enrollment

- Query: Remove the avoidable external preparation window, define duplicate-request semantics precisely, and distinguish database idempotency from provider-call guarantees.
- Scope/date: targeted current-source follow-up, 2026-10-07; no tests or production edits.

### A. A definition can be installed without generating an embedding

**Use `content=''` and `embedding=NULL`, not null content.** This is the recommended refinement of section 5 and supersedes its suggestion to prepare embeddings for ordinary template-definition creation.

| Current Native source | Evidence |
| --- | --- |
| `alembic/versions/n9i0j1k2l3m4_learnings_and_pinned_reflections.py:255-264`; rename in `t5o6p7q8r9s0_rename_mental_models_to_observations.py:70-71` | Existing table lineage has `content TEXT NOT NULL`, nullable `embedding vector(...)`, and `last_refreshed_at NOT NULL DEFAULT now()`. Do not introduce null content or a null refresh timestamp against that schema. |
| `engine/memory_engine.py:13881-13885,13913-13930` | Public create currently always asks the embedder, but its persistence already accepts `embedding_str=None` when no embedding is returned. Embedding-at-create is API behavior, not a database requirement. |
| Same `:15197-15256` | The real clear operation sets `content=''` and clears structured content/query tracking. Empty content is an existing supported state. |
| Same `:14074-14111` | Refresh reads `content or ''`; empty content, including delta mode, yields `no_baseline_content` and full generation. No initial embedding is needed to execute the source query. |
| Same `:14768-14782,14942-14950` | A successful refresh writes generated content through the existing update path, which computes its embedding before SQL. Keep that pipeline, including structured/delta behavior. |
| `engine/reflect/tools.py:127-138` | Semantic mental-model search explicitly filters `embedding IS NOT NULL`; an ungenerated definition is not a semantic-search result. |
| `engine/reflect/agent.py:310-325` | The freshness shortcut requires nonempty content and an explicit non-stale result. Empty content is not answerable evidence. |
| `engine/memory_engine.py:16006-16050`; `engine/replication.py:106-118` | Listing/read/replication carry the content and definitions without requiring an embedding. They can represent the definition before generation. |

Therefore the new conditional producer should use an internal validated **definition-only insert** in its transaction, with empty content, null embedding/structured content/query tracking and existing schema defaults. It must not call `create_mental_model`, whose unconditional embedding is the avoidable effect. Update-only definition changes preserve existing content and embedding. No schema nullability change is needed for this design.

The new model is configured but **not semantically usable through mental-model vector search until refresh generates and stores content/embedding**. Show `ungenerated`, `refresh_pending`, `refresh_failed`, and generated results from the operation evidence; the default `last_refreshed_at=now()` is not proof of a successful refresh. Do not expose placeholder text as generated content. This still requires fresh-schema/reopen and actual consumer tests before implementation acceptance; no database was queried in this research.

### B. Atomically install one stable existing refresh job

Current `submit_async_refresh_mental_model` (`memory_engine.py:18258-18328`) checks provider availability/authorization, reads the model, and calls `_submit_async_operation`. The latter generates a new UUID (`:17472`), owns its own transaction (`:17487-17503`), writes the complete `task_payload` in the row (`:17577-17587`), then calls the task backend **after commit** (`:17644-17648`). `skip_if_in_flight` only deduplicates pending/processing work by model; after completion it may create a new job. It is not immutable-request replay.

Precise required extraction:

1. Extract a private validated refresh-admission helper that accepts the caller's existing SQL connection, one fixed operation UUID, authenticated tenant attribution and complete `refresh_mental_model` payload. Reuse the current maintenance-admission checks, lock ordering, validator logic and initialization-admission hook; do not expose arbitrary connection/operation overrides in the public API.
2. The template request determines its refresh choice and one stable child ID per changed/new model. Validate requested refresh permission and LLM availability before mutation, as the current public path does. A definition-only choice is valid without LLM availability and stays visibly ungenerated.
3. In the same Bank transaction, write the definition/config/resource changes, their logical events, the complete pending refresh row when requested, and the template receipt containing those child IDs. The worker sees neither the row nor the definition until commit. A rollback leaves no definition, receipt or orphan job.
4. Only the winning newly committed request issues post-commit notification. Broker/Worker backends already use the durable row as truth (`engine/task_backend.py`, module contract and `WorkerTaskBackend.submit_task`); a notification failure does not erase the job. Do not call the public submit function after commit: that would create a second UUID and reopen the crash gap.
5. Sync/embedded execution must also dispatch through a claim/settlement guard for that persisted child, not blindly execute every call to `SyncTaskBackend.submit_task`. A replay of the template request observes its original child rather than invoking the backend again. Test this separately because the existing helper's Sync backend runs inline after commit.

Keep the existing refresh handler and worker pipeline (`memory_engine.py:2873-2921`) so full/delta refresh does not fork into another implementation. Its present payload contains only the model ID, and the worker reads the current definition. For a template-generated job, add the expected definition identity to the job and reject a superseded definition before generation and again at result publication. Otherwise an old job can generate for, or overwrite, a later user edit. This guard is an actual missing seam; a stable job UUID alone does not provide it. The shared refresh execution/update path needs a narrowly scoped optional expected-definition guard, not reuse of the unrelated cutover-proof authority.

### C. Concurrent duplicates and external-call truth

- Serialize definition apply under the established Bank/replication lock, then reread the uniquely keyed request receipt. `(authenticated namespace, Bank generation, request ID)` + immutable payload hash is the identity. Concurrent same-ID/same-hash calls have one committing writer and return the same result/child IDs; same ID/different hash refuses. A waiting request may return in-progress/timeout, but cannot enqueue another child.
- A lost response **after transaction commit** is resolved by reading that receipt and the original child. If the transaction rolled back, no definition/child exists and the same request can safely commit later.
- `engine/native_operation_receipts.py:512-580` is the current example of Bank-generation locking followed by receipt lookup/insert. Its kind enum is retain/mutation; reuse the pattern, not a false existing template kind.
- The guarantee is **one definition transaction and one durable refresh admission per request**. It is not exactly-once model or embedding execution. `worker/poller.py:683-699,789-795,850-855` explicitly supports retry/deferral under the same operation ID. `memory_engine.py:2911-2921` persists refresh data before writing outcome metadata, with worker completion later. Process failure can occur after an external response or content commit and before the worker records completion.
- Reuse those worker retry semantics, preserve the child identity and report retry count/unknown outcome truthfully. A refresh retry may repeat model/embedding calls (and potentially derived publication in the unguarded existing path). Do not claim billing or upstream execution deduplication without an actual provider idempotency contract.
- For the preferred definition-only apply there is **no external call before the template transaction**, eliminating that ambiguity from configuration publication. If a future operation really must precompute an external result, reserve a durable request/attempt before dispatch, bind a claim token and request hash, save the result when available, and return `outcome_unknown` when dispatch may have happened without a stored result. Lease expiry cannot prove the call did not happen. Do not transparently start a new paid attempt merely because an old lease expired; resume/read or explicitly retry with possible duplicate cost acknowledged. That extra protocol is unnecessary for the proposed definition-only template path.

Tests must separately prove concurrent duplicate **admission** makes one child, lost commit response makes no new child, process failure before notification leaves a recoverable child, expected-definition drift prevents stale publication, and retry uses the same child while honestly permitting repeated external work. The earlier section 9 phrase "without a second embedding/refresh" applies to replay of a completed template request/admission, not to a worker's crash recovery guarantee.

### D. Fresh enrollment versus legacy v1

"New Bank" is not sufficient ownership evidence by itself. Do not infer creation from an earlier 404 followed by a create-or-update call, or from an empty present-day Bank.

- Let Native complete its normal server-default creation path first. Capture the actual resulting Bank override presence and resource definitions, including server-default model/directive resources, before the first managed Taki delta. Bind the snapshot to the current Bank generation and recheck it in the enrollment transaction.
- An exact **absent-resource precondition plus the new insert and enrollment receipt in one transaction** proves that this overlay created that resource. An existing resource is a captured base overlay/collision, not newly owned, even on a newly created Bank. A lost response recovers the same receipt. This proof does not depend on claiming that Core created the whole Bank.
- New enrollment stores every relevant before-image before overwriting it and assigns user revision zero only to the newly established managed layer, never to an unknown historical layer. Unrelated Native defaults remain untouched; prior same-key values are captured for restoration.
- `transition_initialization.py:92-143` additionally ties pristine provenance to `creation_id`, journal history and `ever_used`; a different template hash can mark the Bank used. Keep that independent proof intact. Managed ownership does not imply Stage 4 pristine-target eligibility and cannot reset it.
- A legacy v1 Bank already had Taki fields/resources applied without these before-images. Current equality with immutable v1 cannot reconstruct its earlier base. Support its existing setup/runtime verifier unchanged, expose untracked enrollment/removal when proof is absent, and use an explicit evidence-qualified migration plan when needed.
- Keep the v1 catalog manifest/digest and loader support byte-stable. Add the new template revision and new managed mode alongside it. Never relabel old v1 receipts as the new revision, silently reapply v1 to erase customization, or require an unsupported old Native build to implement the new optional lifecycle capability.
