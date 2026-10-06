# W5 Actual Local Embedding Discriminator

Status: reviewed design for a new parent-run-only diagnostic. Not implemented or executed by the independent checker.

## Decision and bounded scope

Use one fresh physical pre-apply clone and the same persisted delta request, with the cumulative seven-file Native
repair and the explicit e30-to-e40 migration. Reuse the existing clone custody, normal expired-executor claim,
source/input/Core preservation, exact result lookup, and owned PostgreSQL stop checks. Introduce a NEW composition
helper and a NEW immutable manifest. Do not edit or regenerate previous helpers, manifests, reports, or runtime logs.

This is an actual local-model timing discriminator, not permission to resume the working pair. The parent alone
may execute it after the independent correctness gate. Do not run a working-pair migration, renew its admission,
change its authority, repeat conversion/extraction, or spend maintenance/LLM budget in this diagnostic.

## Exact request and production seam

Keep transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`, delta operation
`6497dfc9-e287-4cb1-96b5-1020ea1eabc4`, and request hash
`946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.
These delta identities differ from the owning Core operation. The only renewed executor is the NEW clone's
ordinary claim; prove that its attempt envelope preserves the persisted delta hash, as the existing helper does.

1. Reuse `w5-trigger-uuid-migration-rehearsal.py` composition over
   `w5-reentry-candidate-native-clone.py`, including its exact source checks and e30/e40 catalog/data proof.
   Read only the explicitly authorized stopped source copy and create a new unique owned clone; never reuse an
   already-applied diagnostic clone. Pre/post migration proof warms SQL data: label the result accordingly.
2. Before the original `run_clone` starts its apply measurement, construct and initialize one normal
   `hindsight_api.engine.embeddings.LocalSTEmbeddings` instance. Use the parent-supplied effective defaults:
   model `BAAI/bge-small-en-v1.5`, `force_cpu=False`, `trust_remote_code=False`, `allow_mps=False`.
   Keep actual GPU/CPU selection. Do not initialize a full `MemoryEngine`, reranker, or LLM stack.
3. Intercept only the diagnostic call to `transition_delta.prepare_current_state_rows`: supply the initialized
   actual model as `embeddings_model`, then delegate to the original production function. Leave the production
   files unchanged. Preserve its input rows, observation handling, date/entity augmentation, mental-model text,
   and the normal `embedding_processing` -> `embedding_utils` -> `encode_documents` path. Do not replace this
   path with direct model calls or precomputed vectors.
4. Count/time the actual instance's document-encoding calls through a transparent delegating wrapper. Reject
   unexpected query encoding. Assert the model's actual dimension equals the stored native vector dimension
   before writes. Ensure the original synthetic encoder is never called. The existing date lambda is currently
   equivalent to `MemoryEngine._format_readable_date` (both return full month plus year); verify this exact seam
   if source changes before execution.
5. Keep the existing timed full apply, normal renewal, transaction recording, exact lookup, delta-row count and
   preservation checks. Its 60-second observation is the request-budget discriminator. The existing diagnostic
   180-second collection ceiling must never be described as a production timeout extension or a 60-second pass.
   Record apply success and budget success separately, including failed/late runs.

## Offline environment and process boundary

Build a clean child environment from the already reviewed Windows/toolchain allowlist. Set
`PYTHON_DOTENV_DISABLED=1`, `UV_NO_ENV_FILE=1`, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, and
`TOKENIZERS_PARALLELISM=false`. Use the explicitly supplied model defaults; do not read `.env`, stored provider
credentials, or arbitrary inherited `HINDSIGHT_API_*`/`PG*`/API-key settings. Preserve normal device selection.
Retain the clone's loopback-only connection refusal guard and absent libpq password/service-file paths. Missing
local model assets are a recorded offline failure; they do not authorize downloading or fallback models.

`LocalSTEmbeddings.initialize()` is declared async but performs synchronous SentenceTransformer loading.
`embedding_utils.generate_embeddings_batch()` executes synchronous document encoding in a worker thread.
An asyncio timeout alone cannot interrupt the first operation or safely stop the second; `asyncio.run` may also
wait for the executor during shutdown. Do not claim that `wait_for` creates a hard model deadline.

The parent must launch this diagnostic in a dedicated hidden process with a finite outer deadline covering model
initialization, migration/proof, apply collection and shutdown, with ownership recorded before startup. On expiry,
the parent must terminate only that known child process and stop only its verified owned PostgreSQL clone,
checking the canonical data directory/port/process identity before cleanup. Preserve evidence on failed cleanup;
never select a server for stopping by a guessed port alone. Record timeout and stop/port-release results even if
the child cannot write its normal final report. Choose and record the finite initialization/overall deadlines in
the parent implementation; they are diagnostic resource bounds, not production timer changes.

## Required report

Record source/helper manifest hashes; exact request identity; original and new clone ownership; migration
revision and function/data proof; supplied model options; resolved model identity/cache revision if locally
available without networking; offline settings; actual device and dimension; initialization time; each document
batch's input count and encoding time; total prepare/full-apply/lookup times; the 60-second observation; exact
receipt, mapping/artifact/delta counts; preservation results; final process/PG stop and port release. Persist only
counts, hashes and timings, never source texts, vectors or credentials. Replace misleading synthetic labels in
the NEW result with explicit actual-local-model labels, while leaving historical results intact.

The c79 reference has 68 document inputs, 68 actual invalidation inserts and no `memory_links` INSERT. The source
sets final lifecycle before live retrieval-link creation. Thus that specific run did not exercise live semantic
link creation; do not assert that synthetic vectors changed its semantic graph. Synthetic vectors still omit
actual encoding and can change temporary vector-index insertion cost. This distinction does not remove the
need for the actual-model discriminator.

## Interpretation and remaining release gate

- A late/refused/offline-missing run remains a failed readiness discriminator, with all preservation/cleanup
  evidence retained. Do not recover by increasing request timeout, TTL, lease or maintenance budget.
- A direct Native apply below 60 seconds is a necessary timing result, not proof of complete HTTP latency or
  actual authority recovery. Initialization is startup work and must remain separately reported.
- The existing c79 result is 56.018 seconds for full apply, 56.709 seconds including subsequent lookup, after
  SQL proof prewarming and with only 1.233 milliseconds of synthetic preparation. A few seconds of margin does
  not absorb unknown actual encoding, request parsing/transport overhead or scheduling variability by proof.
- Only if the new actual-model result provides sufficient margin should the parent consider a narrowly scoped
  request-path timing check. Do not invent a full HTTP harness before the Native result resolves this question.
- Real working-pair migration, exact interrupted-operation recovery, maintenance readiness, complete roundtrip
  preservation and user/manual acceptance retain their separate gates.
