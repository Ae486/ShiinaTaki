# W5 repaired actual-model result and bounded HTTP diagnostic proposal

Date: 2026-10-05. Reviewer: `w5_postpatch_review`. Status: concrete proposal for parent scope approval; no
HTTP implementation, production change, model load, database startup or working-pair action in this review.

## Result audit

**The repaired actual-model Native diagnostic passes its unchanged 60-second observation gate.**
Job: `.trellis/.runtime/w5-actual-embedding-c7cf4137c82a421fb9458351d9f2cbf9`.

| Independently checked saved evidence | Result |
| --- | --- |
| Full Native apply / margin | 49.3180179s / 10.6819821s |
| Baselines | 12.6864s / 12.5362s |
| Actual local encoding | 68 inputs, 2.4297492s, 384 dimensions |
| Exact subsequent lookup | 0.6859s; equal committed result |
| Ordinary body metadata / parts | 1393 / 1393, restored |
| Three body batch families | 96 each, restored |
| Delta / mappings / artifacts | 1 / 1559 / 1558 |
| Four source reports | Same 404 entries / eight inherited manifests |
| Preservation / cleanup | All saved preservation flags true; stopped and port released |
| HTTP / authority recovery | Explicitly unproven |

Main result SHA256: `65987e822cb34c339684d3cd8b9271d2132e4b34c01141d03d786cdce0dd2916`.
Telemetry result: `9aa8c22556d4a9f408e8c44dadf92f7ec1bab9a91b63ba4a6913fb161100d5c4`.
Postpatch result: `fbdb5833bcb432947052722b82b37b21f48ad76ce1eb15acc415d7f349694dd8`.
The embedded child equals its persisted clone result and hash. Worker launch/self/held PID 33216 and parent PID
19820 agree; creation ticks and venv/base executable identity match. Model and telemetry objects match their
separate files. No paid LLM call is reported. This is independent saved-evidence verification, not a new live audit.

NEW `w5-head-prefetch-actual-audit.json` contains the assertions' inputs, hashes and exact metrics; SHA256
`5fb7896297a5bc5e07e35bf09e64be9e9e6c9e3dca48926238b4a27e7072dde8`.
Parent accepts this margin to prepare the next separate HTTP measurement, not to release the real pair.

## Exact route and client to exercise

Use the genuine socket path, without replacing handlers, authentication or production validation:

1. `hindsight_api/api/http.py:3356` `create_app(real_engine, initialize_memory=False)` installs the actual app,
   middleware and response handling. `:3682` mounts `extensions/builtin/taki_memory.py`, which includes
   `api/taki_transitions.py:create_taki_transition_router` at lines 375-378.
2. `POST /ext/taki-memory/banks/{encodedBank}/transitions/executor/delta` uses `_TransitionRoute`, the real
   `get_bearer_request_context`, FastAPI/Pydantic request validation and response model. The route at
   `api/taki_transitions.py:155-163` calls `MemoryEngine.apply_taki_transition_delta`.
3. `engine/memory_engine.py:1840-1879` `_transition_service` authenticates through the genuine compatibility
   manifest, sets the tenant schema, checks capabilities and derives the actor hash from schema and API credential.
   `:1938` then constructs the ordinary `TransitionApiService` and invokes its real delta service.
4. A separate Node 24 process imports the actual `createHindsightClient`, `signHindsightTransitionDelta` and
   `hindsightHttpTransport` from `packages/core/src/memory/hindsight/`. It invokes public `applyTransitionDelta`
   and then `transitionDelta`. `@taki/shared` resolves through the existing workspace package exports, as the
   existing `w5-reused-driver.mjs` already does; do not boot Core, open its writable DB or run the journey driver.

The Core caller parses/sign-checks the request, conditionally performs its genuine Source capability GET, serializes
the body, applies the bounded authenticated HTTP transport, parses the response and validates its hash/identity.
Keep that conditional GET in the measured public call when triggered. Do not pre-cache it away or bypass
`MemoryEngine._transition_service` with the direct diagnostic's stored `actor_hash`.

## Minimal process and execution design

Use **one existing parent supervisor, one V2 Python worker and one Node client**, with Python and Node as siblings
owned by the parent. This avoids introducing a process-tree cleanup framework.

1. Reuse the frozen V2 direct-interpreter launch/handshake, unique job directory, clone creation, e30-to-e40 migration
   proof, source/input/Core/original custody, PG ownership and cleanup primitives. Start only a fresh pre-apply clone.
   Reuse its reviewed bootstrap password/HBA hardening; no original credentials or original instance are needed.
2. In a NEW HTTP-specific clone `run_clone` adapter, read the sealed prepared request from the immutable SQLite input
   using the existing read-only preparation seam. Validate its same transition, delta operation and request hash.
   Only the executor may later change through normal claim; the signed delta hash must remain unchanged.
3. Initialize the same real cached `LocalSTEmbeddings` with unchanged `MODEL_OPTIONS`, then pass that actual object
   through the supported `MemoryEngine(embeddings=model, ...)` constructor. `LocalSTEmbeddings.initialize():184`
   already returns when loaded. Use the genuine engine initialization, not a fabricated `_initialized` flag or
   `SimpleNamespace` engine. Keep pool 2/5, command timeout 180s, acquire timeout 10s, external clone DSN,
   `run_migrations=False`, `skip_llm_verification=True`, `SyncTaskBackend` and `ApiKeyTenantExtension`.
4. Prebind one new loopback listening socket; exclude PG, 18495 and 18496. Run the real `create_app` under uvicorn
   with `initialize_memory=False`, `lifespan="off"`, no access log and the existing 20s graceful-shutdown setting.
   This uses the existing `w5-reused-native.py:execute` server pattern after explicit engine initialization.
   No server worker/poller is started. Serve real HTTP; neither direct ASGI invocation nor TestClient counts as this gate.
5. Worker writes an atomic `http-ready.json` containing the job/clone, bound endpoint and verified Python identity.
   Parent validates it against its held Python process and clone pointer, then launches exactly one pinned
   `C:/Program Files/nodejs/node.exe` with the NEW client entry. Parent retains the original Node Popen handle.
   Node initially uses only built-ins to verify the inventory/launch record before dynamically importing Core.
   The Node process reports `process.pid`, `process.ppid`, `process.execPath` and version; parent verifies live
   executable/creation identity and writes a bounded admission acknowledgement. No HTTP occurs before that ack.
6. Through the actual Node client, perform authenticated status/compatibility readiness and one normal claim with
   a new attempt UUID and exact expected revision. Verify the old clone request is fenced/expired and has no delta.
   Use the original fixture API key `w5-owned-healthy-fixture` and schema. Compare the resulting real service actor
   hash to the persisted actor before claiming; mismatch is a refusal, never a rewrite or adoption of stored identity.
7. Replace only the prepared executor with the returned executor; time an explicit exported signing/preparation
   check and require the original delta hash. Invoke `applyTransitionDelta` **once** with `timeoutMs: 60000` and
   record the full public-method duration. On successful return perform one exact `transitionDelta` GET, compare
   complete results and retain compact hashes/counts. No implicit/manual POST retry, maintenance call, Source upload,
   retain, current-state transfer, reconversion, authority commit or new admission is part of this diagnostic.
8. Stop/drain the HTTP server before the final database audit. Inspect the exact delta row, full mappings/artifacts,
   retained historical maintenance and input/source preservation; close the real engine and stop owned PG. Parent
   retains cleanup responsibility even if Python or Node dies. Node failure never becomes a reason to retry apply.

Reuse lifecycle primitives from the frozen helpers, but **do not reuse their direct-apply `prepare_interceptor`**:
it assumes a synthetic embeddings placeholder and rewrites that object's encoder. A real engine should hold the
actual model directly. The NEW adapter replaces the direct `run_clone` body and its result adapter only; the old
files/results/manifests stay sealed. The new report must name this as an isolated HTTP request diagnostic.

## Initialization and no-maintenance conditions

Before constructing the engine, use the existing clean environment/absent HF credential path, then set these
**task-only child settings**. Do not write `.env`, production defaults, user settings or model configuration:

| Setting | Value / purpose |
| --- | --- |
| `HINDSIGHT_API_WORKER_ENABLED` | `false` — no app worker dispatch |
| `HINDSIGHT_API_SKIP_LLM_VERIFICATION` | `true`, also constructor flag — no startup paid-model probe |
| `HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS` | `0` |
| `HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS` | `0` |
| `HINDSIGHT_API_AUDIT_LOG_RETENTION_DAYS` | `-1` |
| `HINDSIGHT_API_LLM_TRACE_RETENTION_DAYS` | `-1` |
| `HINDSIGHT_API_OPERATION_RETENTION_DAYS` | `0` — negative is invalid |
| `HINDSIGHT_API_AUDIT_LOG_ENABLED` / `HINDSIGHT_API_LLM_TRACE_ENABLED` | `false` / `false` |

Use the existing SQL-backed `PostgresMemories` store and assert `writes_memory_rows_in_sql=True` before initialization;
`MaintenanceLoop._cross_store_recovery_enabled()` must be false. With the settings above,
`MaintenanceLoop._any_job_enabled()` must be false **before** `initialize()` can call `start()`, then verify no loop
task/poller after initialization. This covers operation cleanup and cross-store recovery as well as the older flags.

Do not load paid-provider credentials merely to initialize unused LLM clients: supply a nonsecret inert constructor
API-key placeholder where required, leave provider/model selection unchanged, and install a task-only fail-fast
guard at the LLM call/verification boundary before engine creation. Record any attempted call as failure. Keep the
Python socket/asyncio guard restricted to the owned PG endpoint; the server needs accept/listen, not outbound HTTP.
Node's transport wrapper must allow only the recorded HTTP origin and the explicit read/claim/apply/lookup paths.

Full engine initialization also loads the normal configured local reranker and default `DateparserQueryAnalyzer`.
Do not substitute RRF, disable query initialization, change CPU/device settings or download anything. Current venv
metadata locates uvicorn, FastAPI, dateparser and sentence-transformers. The default local reranker cache directory
exists with snapshots `233902d25c440f23af6f7d6e94d2946bac0bee0a` and `c5ee24cb16019beea0893ab7796b1df96625c6b8`.
These are static existence observations, not proof of a complete compatible cache or successful full initialization.
Record the actual configured model/cache revision during readiness; missing cache/dependency or attempted download
fails the diagnostic without installation or fallback.

The existing **180s initialization hard bound covers one continuous interval from before model imports through full
engine readiness**, including any reranker/query initialization. Preserve its original monotonic anchor in a new
HTTP-initialization record/parent phase adapter; do not restart the budget when `initialize_model` writes its
intermediate `initialized` phase. The 900s overall watchdog and existing PG/SQL/cleanup bounds remain unchanged.

## Timing and timeout evidence

| Clock / event | Meaning |
| --- | --- |
| Initialization start -> engine/server ready | Readiness only, outside request measurement; one 180s gate |
| Normal status/claim and explicit preparation signing | Separate setup measurements; preserve exact claim/hash |
| Public `applyTransitionDelta` enter -> successful return | **Complete gate**, including input parse/sign check, any capability GET, JSON serialization, transport, response schema and final proof validation; require strictly less than 60000ms |
| Real transport delegate start -> fully bounded body return, per request | Actual network/body interval; retain method/path/status/bytes and durations, no credentials or payloads |
| Public start -> first transport / final transport return -> public return | Honest preprocessing and final schema/proof tail groups; do not label either as a pure single-function time |
| Real MemoryEngine method entry/exit and nested delta `apply` entry/exit | Server authentication/manifest overhead versus Native apply; retain original methods and delegates |
| ASGI request/response start/final body events | Request parse/routing and real response serialization/emission; instrumentation observes only, does not replace body or handler |
| Exact subsequent GET | Separately measured and compared; outside the POST public-call duration |

Instrument only the NEW harness wrappers: real transport delegation, original engine/service method delegation and
an outer ASGI event observer. Do not monkeypatch production codecs, signing or validation. An explicit signing
preparation measurement does not remove the client's own required sign-check from the complete public call.
The real `requestJson` timer begins after preprocessing and clears after synchronous `parseResponse`; final
transition proof validation is later. Record those actual boundaries rather than claiming the timer alone bounds
the complete method. A returned result taking >=60s fails the complete gate even if its internal timer did not fire.

The independent Node event loop keeps its real HTTP deadline responsive while Python performs CPU work. Preserve
the real 60s client timer, redirects-off, response/body limits, JSON/schema checks and no-retry behavior. Any injected
transport wrapper delegates to `hindsightHttpTransport` with the same `maxBytes` and endpoint refusal status set;
it must not use fetch mocks or replace response parsing. Internal synchronous JS work is not preempted by a JS timer;
the measured complete-method gate and independent parent watchdog prevent that from being hidden.

Parent holds both original Popen handles and verifies them before termination; never kill by process name or an
unverified later PID lookup. Bound Node handshake/ack waiting at 10s. Parent's new supervision adapter records Node
exit/failure/timeout and terminates/reaps Node in `finally`, including when the original Python watchdog fires.
The worker must not await a missing Node result forever. Preserve first failure, stopped/drained server evidence,
owned PG cleanup and source audits. On timeout/disconnect, classify HTTP failure even if a later native receipt
exists; drain/cancel pending server work with the existing shutdown pattern before SQL inspection. A late receipt
is outcome evidence, not HTTP success, and never authorizes a second POST.

## Exact NEW helper and verification scope

Only NEW task-local files under this research directory; no existing production/helper/test/spec replacement:

- `w5-http-diagnostic.py`: inert default entry, reuse V2 Python launch/handshake and parent watchdog, add the one
  parent-owned Node handle/admission/cleanup and the new worker dispatch/result classification.
- `w5_http_composition.py`: reuse frozen migration/clone lifecycle and model initializer; provide the genuine
  engine/server/claim/delta HTTP adapter, instrumentation and complete preservation audit. Keep this as the single
  HTTP adapter, not a second W5 journey or reusable server framework.
- `w5-http-client.mjs`: real Core imports, exact pinned request/claim, measured real transport delegation and one
  public apply/lookup sequence; sanitized result/identity records only.
- `w5_http_inventory.py` plus `w5-http-source-manifest.json`: additive inventory over the complete 404-entry seal
  at `ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb`; zero replacements. Explicitly add the new
  helpers/tests/reports and previously unpinned HTTP dependencies, including Native app/router/dependency/tenant
  sources and Core transition proof/transport/Shared source/package-lock inputs. Existing 404 pins do not include
  all those files. The implementation must materialize and review the actual import dependency file set; the final
  verifier enforces that fixed union, with both Python and Node confirming its same identity before/after execution.
- `test_w5_http_diagnostic.py` and `test_w5_http_client.mjs`: focused offline supervision/composition and actual
  client/socket-harness tests. Plus separately named implementation/check logs and report; preserve every old seal.

Required tests before a parent actual-corpus run: default no-op/no model import; wrong Node executable/parent/job
or inventory rejected before dispatch; one launch/one POST and no retry after timeout; Python/Node crash and startup
failure cleanup; one continuous initialization budget; no enabled maintenance/recovery/LLM path; exact executor-only
request replacement and hash equality; real loopback response body delay/over-limit/corrupt proof/refusal handling;
complete public duration includes capability and final validation; malformed/missing reports refuse. Run one small
owned fixture through actual uvicorn + actual Node/Core client with deterministic fixture embeddings to establish
wiring/auth/cleanup. Label that fixture proof separately; it cannot satisfy the actual-model HTTP timing gate.
Use scoped Python/Node lint/type/syntax checks and existing locked dependencies, not broad suites or installs.

Parent reviews the concrete implementation and independent gate, then executes ONE new actual-model clone. A full
HTTP pass permits discussion of the separately gated same-transition working-pair continuation; it does not execute
maintenance, authorize per-Bank allowances or complete W5 automatically.

Search note: `jbcontext search` reported no index for this Native repository. Exact known-symbol searches and direct
source reads supplied the route/client/init evidence above; no index, dependency or source was modified.
