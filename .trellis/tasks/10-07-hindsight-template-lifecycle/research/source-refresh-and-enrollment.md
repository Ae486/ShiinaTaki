# Context excerpt: source-refresh-and-enrollment

Extracted without semantic edits from the full Stage 5B research to avoid context-injection truncation.
Source: `../10-07-hindsight-configuration-observation/research/stage5b-template-lifecycle-research.md`.
Source SHA256: `b80ed090b6b2d99be9fe499dd4f0ac690f987b4f3074b2bab77d6c2007708461`.
The full research remains retained. The refresh/enrollment follow-up supersedes earlier embedding-preparation advice.

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
