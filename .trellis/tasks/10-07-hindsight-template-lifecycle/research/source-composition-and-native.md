# Context excerpt: source-composition-and-native

Extracted without semantic edits from the full Stage 5B research to avoid context-injection truncation.
Source: `../10-07-hindsight-configuration-observation/research/stage5b-template-lifecycle-research.md`.
Source SHA256: `b80ed090b6b2d99be9fe499dd4f0ac690f987b4f3074b2bab77d6c2007708461`.
The full research remains retained. The refresh/enrollment follow-up supersedes earlier embedding-preparation advice.

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

