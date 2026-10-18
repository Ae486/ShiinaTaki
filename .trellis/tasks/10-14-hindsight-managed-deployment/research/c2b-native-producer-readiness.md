# Research: C2b actual Native producer readiness

- Query: What existing Native startup/identity path can produce real managed API provenance without real model calls, and what belongs to C2b versus C3?
- Scope: Internal source/docs only; no runtime, Docker, build, dependency or network execution.
- Date: 2026-10-15

## Findings

### Decision

Use the **real single-process Hindsight API and its real PostgreSQL migrations/authenticated compatibility handshake**, launched as the fixed child of the admitted Native owner. Current source permits an initial no-inference configuration without adding a mock provider framework: `LLM_PROVIDER=none`, `RERANKER_PROVIDER=rrf`, and OpenAI embeddings with an explicit dimension and an unreachable container-local test endpoint. With the dimension supplied, the embeddings initializer only constructs its client; it does not make its dimension-detection request. Real model availability remains deliberately unverified.

This is a viable source path, not a verified cached-image/runtime result. C2a currently lacks the fixed API consumer, reachable endpoint topology and owner-produced ready evidence. Those are a concrete **producer substep of C2b**, upstream of its receipt consumer. Complete that substep and the positive consumer integration before accepting C2b. A permanently refusing resolver is only partial implementation.

There is also an actual setup dependency: the existing B3 template import schedules mental-model refresh and the Taki setup service waits for it. It cannot complete with the proposed no-inference configuration. Reuse the accepted Stage 5B definition-only template producer for new managed initialization, after reviewing its integration, instead of pretending old setup is already model-free or silently enabling model calls.

The parent execution map separates C2's resource ownership/receipt/ordinary setup from C3's six-slot model application and readback. Initial API/storage/authentication readiness can therefore be accepted independently of working models, but C2b must actually reach that producer and a truthful setup outcome. The owner has authorized the engineering sequence; these missing contracts need review, not another product-choice prompt.

### Existing startup, storage and identity seams

Native paths below are under `H:/hindsight`; `Taki:` paths are under `H:/TakiAgent`.

| File / lines | Verified behavior |
| --- | --- |
| `docker/standalone/Dockerfile:177-202,268`; `start-all.sh:168-222,229-253` | Existing API image includes the venv, unprivileged user and prepared `/home/hindsight/.pg0`. The shell starts the API, checks health and forwards TERM with a 30-second shutdown budget. No full image rebuild or Control Plane is intrinsically needed. |
| `hindsight-api-slim/hindsight_api/main.py:245-286,314-329`; `server.py:28-81` | CLI/ASGI entrypoints construct the actual `MemoryEngine`, extensions and application with initialization enabled. Use one worker, no reload/daemon mode. The CLI has cleanup hooks; uvicorn's request shutdown setting is five seconds, distinct from complete DB shutdown. |
| `hindsight-api-slim/hindsight_api/api/http.py:3386-3491,3494-3521` | Application lifespan initializes the engine and optional poller/extension hooks; shutdown calls `memory.close()`. This is the production lifecycle to exercise, not `initialize_memory=False`. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:3953-3980,4091-4113,4150-4180,4484-4543` | Startup initializes embeddings/query analyzer/reranker, starts pg0, then performs actual schema migration. It owns pg0 only if it started it. Shutdown closes maintenance, tasks, pools and providers, then pg0. |
| `hindsight-api-slim/hindsight_api/config.py:25-41`; `docker/standalone/managed_bootstrap/supervision.py:19-35` | Entrypoints intentionally load discovered dotenv with override. Preserve the admitted child's `PYTHON_DOTENV_DISABLED=true` and cleared environment. Existing child HOME/TMP/TEMP point at the volume root, which changes default cache/data resolution. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:4430-4470`; `api/http.py:3755-3770` | `/health` proves initialization and a real `SELECT 1`; it supplies neither deployment identity nor model readiness. Raw unhealthy output can contain exceptions and must be reduced to safe fields. |
| `hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py:51-110` | Built-in `ApiKeyTenantExtension` uses `HINDSIGHT_API_TENANT_API_KEY`, requires authentication and has no remote auth provider. The default tenant permits anonymous access and cannot satisfy the Taki compatibility contract. |
| `hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py:63-82`; `api/http.py:3681-3683` | Actual authenticated compatibility endpoint is `GET /ext/taki-memory/version`, not a new `/compatibility` route. It is bound to the same engine. |
| `hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:32-38,245-253,421-452` | Manifest verifies required authentication/storage/contracts and reports current build identity plus persistent provider lineage. Current source build is `taki-memory-hindsight-0.9.0-template-backup-v1`; this is not confirmation of the cached image's build. |
| `hindsight-api-slim/hindsight_api/alembic/versions/e6c9a4f2b8d1_add_replication_journal.py:35-44`; `engine/replication.py:307-318` | Migration creates the singleton provider lineage UUID; ordinary manifest reads SELECT it without provisioning. It survives same-volume restart. Do not replace it with the PostgreSQL cluster ID, Docker ID or a configuration hash. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:1388-1390`; `engine/configuration_observation.py:51-117` | An existing engine session UUID changes per constructed engine. Its current public exposure is the optional Bank-scoped configuration observation, requiring an existing Bank and exact disclosure grant. It is not a general pre-setup identity handshake. |

Prefer a fixed direct API child under the existing Native supervisor, using the stock CLI/lifespan, over nesting an unrestricted shell supervisor. If the packaged `start-all.sh` is chosen, prove its actual API/postmaster descendants and inherited private environment explicitly. Neither code path is already connected to the C2 owner.

### Smallest no-inference initial profile

These are explicit **isolated validation inputs**, not a silent replacement for the user's configured model choices. Pin the complete initial profile with the admitted image/configuration. Never claim that C2's desired-configuration hash means C3 has applied those model choices.

| Fixed setting / prerequisite | Why it avoids the implicit effect |
| --- | --- |
| `HINDSIGHT_API_LLM_PROVIDER=none`; no per-operation provider overrides; explicit skip-verification | Existing `NoneLLM` refuses inference (`engine/providers/none_llm.py:27-91`); engine automatically skips verification for `none` (`memory_engine.py:1334-1345`). Inherited operation settings must remain `none`. |
| `HINDSIGHT_API_RERANKER_PROVIDER=rrf`; no indexed failover members | Existing passthrough initializes without weights or network (`engine/cross_encoder.py:813-835,1820-1848`). Current factory does **not** accept the `none` value mentioned in some config guidance. |
| `HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai`; explicit positive `HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS`; fixed test model label, nonsecret test API key, base URL on an unused container-local loopback port | Factory already supports these inputs (`engine/embeddings.py:1647-1663`; `config.py:3224-3228`). Initializer sets the supplied dimension without `embeddings.create` (`embeddings.py:672-716`). Actual encode still makes a request: prohibit data/refresh/embedding operations in this profile and verify no request attempts. This is an unavailable model client, not synthetic successful embeddings. |
| Confirm the existing `cl100k_base` cache under the **effective** child environment | Engine construction eagerly requests tiktoken (`memory_engine.py:1659-1660`; `engine/token_encoding.py:35-43`). A cache miss can download before DB startup. Pin the already-cached tokenizer path, e.g. through the supported tiktoken cache variable after verifying its actual location. Do not infer it from the image recipe, and do not download it during validation. |
| One new pg0 instance/volume, default SQL store, `pgvector` + native text search, normal migrations | Actual API acceptance requires its schemas/extensions, beyond the raw disposable-PG test. Verify cached pg0/PostgreSQL/pgvector assets and actual `SHOW data_directory`; never borrow an existing database. `pg0.py` does not forward arbitrary data-dir kwargs, so freeze HOME/instance layout or use the already-owned DB URL deliberately. |
| Worker, MCP, LLM-health, tracing and webhook delivery disabled/unconfigured; built-in API-key tenant only | Avoid external workers, auth hooks, telemetry and background inference. Also disable consolidation reconciliation and mental-model refresh ticks; `MaintenanceLoop` starts independently of the HTTP poller (`engine/maintenance.py:95-151`). Keep default Bank-template injection unset. |

The no-request embedding branch is stronger than “skip LLM verification,” which does not suppress embedding/reranker initialization. Do not use cached local model weights as a shortcut: local initialization loads real models, and a cache miss may fetch them. An arbitrary remote embedding model without an explicit dimension takes the probe-call branch.

Use a fresh generated connection credential through the existing private custody delivery and map only that connection slot to the fixed API-key tenant environment. The generated model-slot sentinels are not working provider keys and must not be mapped to model endpoints. No Docker `--env` secret, `.env` file, argv key, original Catalog/key or real model is needed. Keep the DB connection parameters independently nonsecret and fixture-local; pg0 can expose its password in helper argv, as the prior DB study records.

### Endpoint-to-container/startup binding required for a receipt

The producer must establish this one chain from actual owners:

`accepted Core Run/Effect -> protected Host plan/record -> exact engine/image/container/volume -> current Native startup -> owned API child/listener -> authenticated manifest lineage/build -> Core-visible endpoint`

1. Current C2a creates `--network none` with no port bindings (`Taki: apps/hindsight-host/src/docker-adapter.ts:84-96`). Core's existing HTTP client cannot reach that API. Review one fixed local topology for C2b, with an owned container port and host binding **only to 127.0.0.1**, recording the actual mapping in admission and inspect checks. An isolated internal Docker network is a candidate for keeping egress closed; platform reachability must be tested, not assumed. Do not add a general proxy, arbitrary Docker options or an endpoint supplied as trusted receipt input.
2. Native's owner must tie readiness checks to the exact live API child it launched, with one worker and no in-place restart. Verify the listener belongs to that process/container; query health and authenticated manifest inside the owned resource, then recheck startup/process identity. Report bounded factual lineage/build/storage and the bootstrap startup identity through its protected control path. Reuse that identity rather than minting another process ledger.
3. Host verifies its original Docker identity, mount and published mapping before/after the read; Core verifies the original accepted Run/Effect/Host provenance and independently matches the external authenticated manifest. A free host port or matching `/health` response alone is insufficient. A new Native/API process withdraws prior current readiness and requires the existing fresh-startup authority path.
4. Existing provider lineage identifies persistent SQL state; existing bootstrap startup plus exact owned child identifies this process lifetime. If the implementation cannot prove the listener-to-child relationship, add one narrow authenticated process-identity read using the existing engine session UUID. Do not misuse Bank-scoped 5A by creating a Bank merely to authenticate a pre-setup receipt. No new identity endpoint is automatically necessary if the owner/process binding is proven.
5. Preserve registry facts and Core references through restart. Historical accepted evidence is distinct from current readiness; a missing/stopped/different resource cannot remain ready. No observer creates, restarts or reinjects. Inner Native ACK-loss and shared-daemon acceptance remain separately open.

### The real setup gap and the existing no-model producer to reuse

`Taki: taki-bank-template-v1.ts:35-61` includes a continuity mental model for each Bank. `hindsight-bank-setup.ts:45-54,77-88` uses legacy import and waits every returned operation. Native `api/http.py:2782-2828` creates or updates the model and unconditionally submits refresh, returning those operation IDs. The new model starts with `Generating content...`; a model-free API/worker-disabled launch does not make that operation succeed. Skipping the wait, fabricating completion, removing models from the frozen v1 template or enabling a real provider would all change the required result.

Stage 5B already has the needed real definition-only primitive:

- Native `engine/template_mutations.py:106-128` inserts new model definitions with empty content and NULL embedding/derived state; no model inference.
- Native `engine/template_apply.py:31-72` recovers existing receipts before new work, requires provider availability only when `request.refresh` is nonempty, and commits definition-installation provenance with the transaction. Use an empty refresh list for initial definitions.
- `Taki: hindsight-template-client.ts:20-27,45-58` already exposes authenticated snapshot/apply/result methods. The corresponding backend spec explicitly distinguishes installed definitions from generated/refreshed content.

The smallest honest design is to use those accepted lifecycle primitives for **new managed initialization** while preserving ordinary existing-instance compatibility. First create the actual empty Banks using the existing authorized path with no default template; then apply the reviewed definitions through snapshot/CAS/apply/result and verify them. Bind the lifecycle receipt to the same managed deployment/Native lineage and the setup attempt. Root must select the existing Stage 5B owner/composition seam during design; this research does not authorize bypassing its writer/initialization guards or inventing a second template orchestrator.

This is required consumer integration for a no-model positive C2b case, not C3's six-slot apply feature. If that integration is left out, explicitly retain it as an upstream prerequisite and leave C2b incomplete. A source-only positive receipt test or successful API `/health` cannot substitute for the actual managed setup consumer result.

### Practical reviewed sequence and completion boundary

1. Finish the current recovery -> disposable database checkpoints. Reuse their accepted ownership/stop evidence without extending it to the API or shared daemon.
2. Probe only the exact cached image's consumed Native modules, installed SDKs, tokenizer cache and PG extension assets. Source hashes/version/layout must support the branches above; missing cached prerequisites stop the slice without download. Add narrowly bounded no-request startup checks to the independent review.
3. Review and implement the fixed API child, private connection-key mapping, exact local endpoint topology and owner readiness observation. Prove one real authenticated API startup on fresh generated storage, manifest lineage, absence of real model requests and ordinary Native migrations. Keep raw child stdout/errors private.
4. Exercise actual graceful API/PG stop and the same-volume restart. Confirm durable generated data/provider lineage, a new process/bootstrap startup, original resource identity and a fresh admission before API child creation. Existing pg0 return values alone do not prove shutdown; retain postmaster/control-state evidence. Coordinate API, 30-second Native supervisor and outer Docker budgets without treating forced KILL as graceful success.
5. Implement the reference consumer plus the reviewed definition-only managed setup integration; exercise the actual operator/durable setup entry, real SQL template receipts, reply loss/reopen and rejection of fabricated/stale/wrong-resource references. `configured` means verified definitions/Banks and compatibility, with model health still not run and Memory Authority unchanged.

C2b completion belongs to this full producer-and-consumer slice. C3 subsequently owns applying the user's six model slots, inheritance/clear/fallback, generation-bound restart/readback including embeddings/reranker, and separately authorized real model health. The fixed unavailable initial profile must remain explicit; it is not an applied-user-model success. C4 populated re-embedding/upgrade and service/manual platform gates also remain separate.

### Related specs, references and limits

Read `H:/hindsight/AGENTS.md` and its referenced `CLAUDE.md`; current C2a design and C2b readiness; parent `stage5-execution-map-2026-10-07.md`; Stage 5C host-boundary research; Trellis workflow and relevant custody/managed-deployment/template-lifecycle contracts. The older Stage 5C report supplied the C2/C3 responsibility split; current source verified each concrete startup/consumer claim above.

No external documentation/registry was consulted. Repository API version is 0.9.0; the current compatibility build and package behavior are not asserted to exist in cached image `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`. One focused Hindsight `jbcontext` query found no index; direct reads/exact searches were used without indexing.

## Caveats / Not Found

- No ready-API consumer, owner-produced endpoint/identity attestation or model-free integration for the legacy managed setup consumer currently exists in the inspected C2a path. Those are real implementation prerequisites.
- The cached image's tokenizer/SDK/PG extension contents, offline startup, local published-port reachability, API/postmaster shutdown and real setup success were not tested. This report proposes no permanent dummy success or permanently refused “completed” C2b.
- The legacy `.trellis/.current-task` remains empty; Root supplied the exact task/output path. Only this research file was written. No source/task metadata, runtime, dependencies, original data/credentials or Git lifecycle was touched. Ownership is released to Root.
