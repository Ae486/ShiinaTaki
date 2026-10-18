# Research: Stage 5C managed deployment, Host ownership, and model application

- Query: Identify the minimum reusable Host/Shell execution and secret-custody path for managed Hindsight deployment and real model apply/readback, without making Core platform-dependent.
- Scope: internal; source-only inspection of `H:/TakiAgent` and `H:/hindsight`. No tests, builds, model calls, service operations, credentials, original databases, Git commands, or production edits.
- Date: 2026-10-07.
- Active task: `.trellis/tasks/10-07-hindsight-configuration-observation`, explicitly supplied by the leader. The legacy `.trellis/.current-task` file was empty; workflow documents session-scoped routing. This report does not change task state.
- Coordination: 5A production implementation and 5B template research were active concurrently. Native line references are a source-reading snapshot and may move as 5A changes land.

## Findings

### 1. Decision summary

Stage 5C is a substantial cross-boundary deliverable, not a small extension of 5A. Reuse the existing Host broker, canonical governance, encrypted Secret Catalog, memory operation owner, and setup/activation services. Add a narrowly scoped deployment helper and trusted receipt admission; do not build provisioning by composing the generic `exec` tool in Core.

Recommended first managed topology: one explicitly selected Windows host, its existing Rust Shell, an operator-installed helper, an accepted immutable Hindsight container artifact, and a new owned persistent volume. Core and the provider-secret catalog should be co-located with that helper for the first slice; the existing store cannot transparently serve a remote Shell. Existing-instance setup remains independent of every helper step.

The Windows-first constraint does not make Ubuntu Core unsupported. Ubuntu/headless existing-instance setup already has the necessary platform-neutral Core and systemd credential seam. A production headless managed Host is additional work: the current `taki-node` binary is a debug-only test harness and explicitly exits in release. Do not label it a supported Ubuntu deployment agent.

Implement and check 5C in separate milestones: (1) helper identity/Host permission/secret custody, (2) isolated deployment and receipt recovery, (3) real model application/readback and minimal Home integration. Data-bearing model changes require a fourth explicit migration/recovery sub-slice if included in the promised model-management lifecycle. Combining all of 5A, 5B, and 5C into one final check would hide materially different trust and recovery boundaries.

### 2. Accepted requirements and existing foundation

The parent `.trellis/tasks/08-09-hindsight-memory-provider/prd.md`, R9/R10, requires progressive setup, secret-safe configuration, Windows and Ubuntu/headless backends, Shell/helper ownership of process/Docker/filesystem/service management, and an independently usable existing-instance path. The Stage 5 allocation and residual scope are in `.trellis/tasks/09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md`, sections 3.1/3.2 and 4. These are the requirements; historical statements that the secret backend is wholly absent are superseded by current code below.

| Current source | What exists | Consequence for 5C |
| --- | --- | --- |
| `packages/shared/src/hindsight-setup-schema.ts:58-70` | `HindsightManagedDeploymentReceiptSchema`: version, helper/deployment IDs, endpoint, `ready`, persistent `external-postgresql` or `embedded-pg0`, immutable identity, timestamp. | Reuse the setup seam, but the current receipt is only a supplied assertion. |
| `packages/core/src/memory/hindsight/hindsight-setup-service.ts:213-228` | Existing-instance mode rejects a receipt and proceeds independently. Managed mode checks schema, matching endpoint, bounded age and an identity string not containing `latest`. | No installed-helper lookup, Host provenance, image digest verification, request binding, or persistent storage inspection is established here. Add trusted producer admission before claiming managed readiness. |
| `packages/core/src/memory/operations/memory-operation-kind-setup.ts:30` | Passes the requested receipt to the setup producer. | A durable operation does not make caller-supplied receipt content trustworthy. |
| `packages/core/src/config/hindsight-config.ts:18-36` | Non-secret desired connection and model projection. | It is intention, not application. The current per-operation fields hold model names; they do not independently encode per-operation providers or endpoints. |
| `packages/core/src/memory/hindsight/hindsight-secret-refs.ts:9-27` | Seven stable refs: connection key plus default/retain/reflect/consolidation/embedding/reranker keys. Only the connection key has a production trusted resolver. | A model ref is not a deployed secret. Add a Host-owned consumer with exact custody, not a general `secret.get` method. |

Important current snippet:

```typescript
// hindsight-setup-service.ts:223-228
const receipt = HindsightManagedDeploymentReceiptSchema.parse(params.managedReceipt);
const age = Date.parse(observedAt) - Date.parse(receipt.observedAt);
// Endpoint, age, and non-latest identity checks; then return connection.
```

This is a source gap in proof strength, not evidence of an exploited vulnerability. Authenticated Native compatibility and setup checks still run separately. Preserve them.

### 3. Host execution, package, and permission ownership

#### 3.1 Reusable production path

- `packages/core/src/capabilities/route-capability.ts:48-93` resolves the explicit Host, checks governance descriptor/classifier revisions, and dispatches through the broker with connection/catalog/policy generations and operator context. `:119-133` refuses ambiguous routing; it never selects the first Host silently.
- `apps/desktop/src-tauri/src/node.rs:50` lists default capabilities; `:103-110` registers screenshot, process list, clipboard, shell-open, exec and foreground-window executors. Exact source search under `src-tauri/src` found no Hindsight/managed-deployment handler.
- `apps/desktop/src-tauri/src/ws_client.rs:704-727` publishes the supported read/effect descriptors and classifier identity. A new deployment capability needs both its handler and catalog/governance registration; adding one Rust module alone is insufficient.
- `apps/desktop/src-tauri/src/capabilities_impl.rs:34-44,78-103` provides the blocking `CapabilityExec` registry and bounded response seam. Long deployment work must expose durable helper observation/reconciliation; a blocking response cache cannot prove recovery after restart.
- `apps/desktop/src-tauri/src/capabilities_impl/exec.rs:38-43,57-60` accepts a raw command and returns captured output. The command has an audit/detail path. Never put provider keys or database URLs into this generic channel.
- `.trellis/spec/backend/host-operation-lifecycle.md` requires exact Host/run/attempt/input identity, generation-bound settlement, `outcome_unknown` after unknowable effects, and explicit revalidation/resume rather than reconnect replay.

#### 3.2 Concrete ownership recommendation

1. **Shared contract owner:** strict operator deployment intent, Host capability input/result, helper status/receipt, error categories and TS/Rust fixtures. Carry non-secret settings and opaque refs only. Distinguish inspect/prepare/start/reconcile; arbitrary commands, arbitrary environment maps and arbitrary filesystem paths are not a deployment API.
2. **Rust Shell owner:** canonical permission enforcement, explicit target Host, installed helper resolution, bounded invocation, sanitized errors, local input classification, final check before dispatch. A dedicated operator-only deployment capability should not be advertised as a new model tool. Register its governance descriptor and Host catalog entry together.
3. **Helper owner:** all Docker/process/storage work, deployment-local lock and journal, resource ownership checks, config generation/application, Native startup and exact result inspection. New helper code belongs outside `packages/core`; a separate package/entrypoint may reuse narrowly extracted platform-neutral secret codecs without importing Core boot or gaining Core DB write access.
4. **Core owner:** authenticated connection/compatibility, operation admission/status, original request and receipt binding, safe reconciliation, desired-versus-observed configuration, existing setup and authority activation. Do not add a third general spawn exception to Core. `docs/adr/0006-mcp-processes-vs-no-os-invariant.md:11-16` grants the existing key-bootstrap exception only, not deployment management.
5. **Home owner:** select the target/deployment input, display real prerequisite and operation states, submit sensitive values only through a write-only path, and render original operation results after reconnect. `apps/desktop/src-tauri/capabilities/home.json:5-6` currently grants only event access; any local helper/secret IPC must add its exact permission deliberately. Browser operator WS can remain the normal non-secret control path.

#### 3.3 Installed artifact identity is a required deliverable

`apps/desktop/src-tauri/Cargo.toml:17-27` declares `taki-node` and `taki-secret-key`; it declares no deployment helper. `apps/desktop/src-tauri/tauri.conf.json` has no `bundle.externalBin` or helper resource entry. `package.json:16` delegates `desktop:build` to Tauri. These source declarations do not prove a working installed key-helper path.

Publish one explicit helper installation manifest with helper protocol/version, executable or entrypoint identity/digest, required runtime if any, supported platform, and supported Native artifact identities. Resolve from the installed application/helper location, not a development checkout or mutable PATH. Validate the actual installed artifact before advertising the capability. If the helper uses the existing Node/libsodium codec, ship its runtime/dependencies and identity as part of that manifest; do not assume the user's development Node installation exists.

Keep separate identities for the helper, Native image digest, Native public compatibility build/contracts, deployment, physical Host, catalog store, and configuration generation. A self-reported build string or helper ID is not interchangeable with an installed-artifact digest. Reuse the accepted Hindsight `0.9.0` compatibility line, then pin the actual reviewed artifact after 5A changes settle; no new external version/digest is selected by this report.

### 4. Secret custody: reuse exists, transport does not

Current facts:

- `packages/core/src/main.ts:142-143` creates `<dataDir>/secret-catalog.bin` bound to `coreHostId`. `packages/core/src/server/methods/secret-methods.ts:36-76` registers operator-only set/clear/presence/list against that local service; it has no target-Host field or secret read result.
- `packages/core/src/secrets/secret-catalog-service.ts:39-56,83-99` has internal `resolve`, encrypted readback, backup/restore and locked semantics. The whole-file catalog has one writer. A helper must not instantiate a second mutable catalog writer beside Core.
- `packages/core/src/secrets/master-key.ts:15-39` resolves systemd credential directory first, then explicitly configured key helper. `:63-82` uses the bounded framed get/create protocol. Windows assumes the same interactive user, not a Windows service account.
- `apps/desktop/src-tauri/src/bin/taki-secret-key.rs:47-59,68-99` brokers one 32-byte master key through get/create-only or systemd credential read. It does not fetch provider secrets, implement a secret catalog, or deploy containers.
- `.trellis/spec/backend/secret-catalog.md` fixes TSC1/libsodium `0.8.4`, encrypted at-rest values, write-only/presence-only public APIs, sanitized errors, same-user Windows custody, and Linux `LoadCredentialEncrypted=`. Live platform/keyring/package acceptance remains separate from source correctness.

**Minimum custody spike before real provisioning:** prove a same-host helper can resolve only the named model/connection refs just in time, without sending plaintext over normal Host-control/operation WS frames, persisting it in helper journals/configuration, or becoming a second catalog writer. Reuse the TSC1 implementation and master-key source behind a narrow read-only library/local service seam. A helper-owned read-only decoder must bind the real Core `storeId` and key version; it must not reinterpret the Shell `deviceId` as the catalog identity. Concurrent catalog replacement must yield one complete old/new generation and stale provenance must force revalidation.

A private authenticated local broker or a narrowly packaged read-only decoder are viable engineering approaches; no such production path currently exists. Choose and prove one in milestone 1. Do not invent cross-host secret transfer for the first Windows slice. Remote Core plus Windows helper is explicitly unsupported for managed deployment until a separate owning-Host sensitive path exists; existing-instance connection still works.

Native consumption also needs proof. Do not assume `docker -e KEY` becomes secret-safe merely because its value is absent from argv. Verify container metadata, generated config, helper output, process arguments and diagnostic collection. A mounted runtime secret/in-memory startup adapter is a candidate mechanism, but its restart and custody behavior must be proven on Windows Docker Desktop and Ubuntu; the current entrypoint does not supply that bridge. Never put plaintext into `.env` files or make raw `docker inspect`/logs part of Home output. Bootstrap the API authentication key explicitly as well as model keys.

### 5. Native deployment and model behavior

#### 5.1 Current standalone topology

| Native source | Actual behavior | 5C requirement |
| --- | --- | --- |
| `docker/standalone/Dockerfile:158-268` | API-only image target; unprivileged `hindsight` user; `/home/hindsight/.pg0`; API port 8888. | Can avoid shipping an unnecessary second Native Control Plane in the first Taki-managed topology. This is an engineering packaging recommendation, not an existing selected artifact. |
| `docker/standalone/Dockerfile:307-433` | Combined API/Control Plane image, ports 8888/9999. | Only enable/expose what the reviewed topology needs. Do not reuse upstream `latest` quick-start. |
| `docker/standalone/start-all.sh:46-87` | Checks pg0 writability; explains UID 1000 bind-mount ownership and recommends named volumes. | A new owned named volume is the least intrusive starting point. Do not chown, move or adopt existing directories implicitly. |
| `docker/standalone/start-all.sh:26-43` | A nonempty directory lacking `PG_VERSION` emits a warning, rather than proving recoverable storage. | Helper readiness must inspect expected owned storage and known instance identity, not treat process start as persistence proof. |
| `docker/standalone/start-all.sh:170-222,230-253` | Handles termination of child services and waits for API `/health`, with a bounded startup setting. | Reuse graceful stop/start behavior, but verify identity/configuration separately from health. |
| `hindsight-api-slim/hindsight_api/config.py:846,1261` | Default DB is `pg0`; API worker is enabled by default. | A single API process with its embedded poller is a viable minimal standalone topology. |
| `hindsight-api-slim/hindsight_api/api/http.py:3452-3473` | Embedded `WorkerPoller` executes `memory.execute_task` on the same engine. | Bind topology to that deployment and prohibit unaccounted external workers before claiming all managed execution uses the observed configuration. |
| `hindsight-api-slim/hindsight_api/worker/main.py:237-246` | Separate worker constructs and initializes its own engine; current startup prints the database URL. | Multi-process rollout needs per-process readback and secret-safe diagnostics. Do not forward raw worker stdout or claim 5A API observation proves a separate worker. |

Windows plan: preflight an already installed permitted Docker engine; create a new uniquely owned volume/container and bounded endpoint; do not install Docker, modify system services, migrate existing data, or pull/start a real image as an incidental test. Persist safe ownership metadata so interrupted attempts can be inspected without guessing. Use authenticated API access even on loopback.

Ubuntu/headless plan: document operator-installed Native under Docker or an externally managed service and Core under its normal headless runtime; load the catalog master key through systemd `LoadCredentialEncrypted=` and use existing-instance setup. For **managed Ubuntu** parity, ship a release-safe helper/CLI or Host service with the same typed receipt/permission model and noninteractive explicit operator authorization. `apps/desktop/src-tauri/src/bin/taki-node.rs:44-48` is not that service. Do not rely on desktop dialogs, session autoapproval or installing a GUI runtime on a server.

#### 5.2 Apply and readback matrix

Native model selection is static process configuration. `hindsight-api-slim/hindsight_api/config.py:2622-2625` explicitly excludes credentials, infrastructure and provider/model selection from Bank-config customization. `server.py:33-59` loads configuration and constructs the actual engine. A settings edit or Bank PATCH cannot replace the engine's clients.

| Slot | Apply mechanism to plan | Runtime proof and constraints |
| --- | --- | --- |
| Default LLM | Native `HINDSIGHT_API_LLM_PROVIDER`, `..._MODEL`, secret `..._API_KEY`, plus explicitly supported provider endpoint/config inputs. Constants: `config.py:148-151`; resolution: `:2968-3003`. | Restart/recreate the owned process with a new config generation; read supported actual `_llm_config`, not reparsed desired environment. Reuse 5A's bounded supported projection. |
| Retain / reflect / consolidation | Corresponding `HINDSIGHT_API_<OP>_LLM_PROVIDER/MODEL/API_KEY/BASE_URL` (`config.py:307-310,331-334,344-347`). | Native independently inherits absent provider/key/model/URL (`memory_engine.py:1473-1478,1514-1517,1553-1556`). Current Taki model-only overrides should inherit the default provider explicitly; do not assume an unrelated key implies a new provider. Expand desired schemas only with reviewed semantics. |
| Embeddings | Provider-specific mapping, not generic `EMBEDDING_MODEL`: local model, ONNX artifact/tokenizer/dimension, OpenAI model/key/URL, TEI endpoint, etc. `engine/embeddings.py:1607-1662`. | Read actual initialized implementation/model identity and dimension; use an explicit supported-adapter set. TEI/custom/opaque implementation may be unknown. Some initialization performs requests (`:560-574,701-713`). Full readback extends beyond 5A. |
| Reranker | Provider-specific model/config mapping; actual factory at `engine/cross_encoder.py:1831-1848` may return a failover chain. | Read actual initialized implementation; a chain is not one model. Support a concrete single-model adapter set first and reject unsupported managed inputs, while leaving existing-instance unknown states usable. |

Do not silently adopt a provider/model default or external artifact version chosen by this report. The operator's configured choice and the compatibility-supported matrix remain the input. Preserve environment override precedence: show when an external deployment override prevents an intended change, rather than claiming the stored configuration applied.

**Two hidden lifecycle hazards:**

1. Startup can use models. `memory_engine.py:3980-3988,4027-4036` verifies LLM connections unless disabled; failures are warnings and do not necessarily prevent server startup. Embedding/model initialization may contact a provider or download assets. Therefore `/health` is neither model success proof nor evidence of a zero-call run. Planning and unit tests must remain hermetic; a real apply/start action needs its explicit provider/download side-effect boundary and later authorized acceptance.
2. Embedding changes are data migrations. `migrations.py:423-441` returns early for matching dimension but refuses a new dimension when stored vectors exist; `:444-472` alters empty storage/indexes. It offers a destructive deletion suggestion in its error text, which Taki must not automate or echo as a normal repair. Even equal-dimensional vectors from different models are not proven semantically compatible. Existing populated deployments therefore need an explicit preserved-source re-embedding/candidate validation path, or a truthful refusal until that separately planned sub-slice is delivered. A config restart alone cannot close this requirement.

### 6. Incremental implementation and check plan

| Milestone | Concrete result / ownership | Check immediately at this boundary |
| --- | --- | --- |
| C1: installed helper and custody contract | Shared/Rust registry and exact input fixtures; installed helper identity; one same-host read-only secret path; public non-secret status. Serial owner for Shared/permission/secret refactoring. | TS/Rust wire parity; absent/tampered helper; wrong Host/store/user/key; locked catalog; no secret in argv, WS, logs or persisted helper/container config; policy generation change; release packaging path. No real models/services required. |
| C2: isolated managed deployment | Helper prepare/start/inspect/reconcile with resource labels/IDs, operation-local lock/journal, owned persistent storage and true installed artifact digest. Core admits a receipt only from the original authenticated execution and calls ordinary setup. Minimal Home prerequisite/result controls. | Hermetic process/Docker adapter tests; failure after each externally visible step; duplicate attempt and restart observation; unknown result without replay; foreign resource collision; storage persistence proof; stale/fabricated receipt; existing-instance setup when helper is absent. |
| C3: model application and readback | Explicit canonical apply plan, finite provider adapters for all six model slots, generation-bound restart/readback, 5A reuse plus embedding/reranker extension, model health separate from configuration status. | Inheritance/clear/fallback, unsupported provider/chain, wrong runtime generation, API/poller topology, failed start and recovered result, stale desired settings, silent environment override, no implicit model calls during observation. Isolated real deployment/model acceptance is separately authorized. |
| C4: populated deployment change | Explicit drain/backup/config-candidate/verification/rebind path; preserve existing authority and data on refusal or failed migration. Re-embedding plan where required, rather than ordinary connection revalidate. | Failure before/after publication, pending/source/derived-state preservation, embedding same/different dimension and model identity, missing retained sources, rollback limits, original operation recovery. Coordinate with 5D candidate infrastructure; do not falsely mark full active-model lifecycle complete after C3. |

A single cohesive implementation agent is reasonable per milestone because each crosses coupled schema/producer/consumer changes. Helper internals and Home UI can be separate owners only once the wire contracts are frozen. Native changes to readback or startup adapters must wait for the current 5A owner to hand off its files. Independent check C1 before feeding it real credentials, C2 before trusted managed receipts are consumed, and C3/C4 before calling the flow usable. Do not rerun the full unrelated Stage 4/Core suite after every small edit; combine relevant module tests/type checks/lint at these milestones and run one integration sweep when the complete vertical path exists.

### 7. Recovery and rollback rules

- Before creating anything, record the exact approved plan and original operation/attempt/Host/config identities. After each side effect, persist its actual resource identity. A timeout/disconnect is unknown until inspection proves the original result; no automatic create/restart replay.
- Reconcile only resources owned by the exact deployment. Foreign container/volume names, changed image digest, missing journal, changed helper identity, or unknown storage contents refuse automatic adoption.
- Before first activation, failed candidate setup must leave Local authority unchanged. Retain recoverable storage and bounded evidence; automatic deletion is not a shortcut for uncertain ownership or failure.
- Do not let browser closure cancel or reconstruct a deployment operation. Helper/Core can continue and the next observer reads the original operation.
- For an active deployment, prepare/verify a backup and drain the appropriate work before replacing configuration/runtime. Existing connection revalidation rejects model/deployment drift intentionally; do not weaken it to make settings appear live.
- Old config/artifact can be selected again only if its storage/schema remains compatible. Once candidate migration or authority publication commits, recover that committed identity; never blindly downgrade a schema or switch back by rewriting a pointer.
- A managed receipt must bind actual Host/helper/artifact/configuration/storage evidence and freshness to the admitted operation. Operator JSON re-submission is not an authenticated helper result. Its readiness still does not itself authorize memory authority activation.

### 8. Leader decisions versus genuine owner choices

**Leader can decide within the approved scope:** serial ownership/check cadence; dedicated typed capability instead of generic exec; source/module placement; immutable artifact identity format; explicit refusal/unknown/recovery semantics; provider adapter implementation order; installed-helper detection; same-host-first implementation; test fixtures and finite test budgets. These are engineering choices and do not justify repeatedly asking the owner to approve routine design work.

**Make concrete in the relevant task plan before real deployment:** actual supported helper packaging, accepted Native image digest, secret delivery and restart mechanism, local endpoint/port, resource ownership/storage plan, model-provider matrix, and the supported Ubuntu managed topology. They are engineering work still to do, not facts this report has proven.

**Owner decisions only if the product/deployment choice cannot be inferred:** installing Docker/system services or granting new OS privileges; selecting a real deployment host/storage location that affects the user's environment; choosing an external model/provider/key or paid/download activity; changing scope to remote-Host secret transfer or automatic service startup; a destructive existing-data repair, migration or cleanup policy. Stage 5 source implementation authorization alone does not choose those actual environment actions. No such action was performed here.

## Related specs and references

- `.trellis/workflow.md`: task routing, persisted planning, sub-agent self-exemption and implementation/check gates.
- `.trellis/spec/backend/index.md`: OS action/Shared-contract rules; `.trellis/spec/guides/index.md`: cross-layer and source-grounding rules.
- `.trellis/spec/backend/host-operation-lifecycle.md`: Host provenance, generation loss, non-replay and receipt semantics.
- `.trellis/spec/backend/secret-catalog.md`: TSC1, master-key backends, no-value public surface and locked behavior.
- `.trellis/spec/backend/memory-operations.md`, `memory-hindsight-activation.md`, `memory-hindsight-lifecycle.md`: existing operation, activation and drift/rebind boundaries referenced by the Stage 5 readiness report; preserve them during later implementation.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md`: precisely scoped Core spawn exceptions.
- `docs/adr/0007-capability-data-locality-split-machine.md:3-18`: Core placement does not relocate Shell-owned OS effects.
- External source dependency: local Hindsight `0.9.0` compatibility line and its standalone/API/worker/configuration code cited above. No network research, new dependency, image version selection, or installed-artifact inspection occurred.

## Caveats / Not Found

- One broad `jbcontext search` reported indexed revision `fccfc4fb7895`. It was used only to find the Host/Shell seam, then current named files and nearby code were read. No second broad search was used.
- The current sources contain no production Hindsight deployment helper, no proven installed helper packaging, no safe model-secret delivery to a helper, no trusted managed-receipt provenance, and no complete all-slot model apply/readback workflow in the bounded searched seams.
- 5A is changing concurrently; its optional API observation contract is deliberately not re-audited here. Reuse the final independently checked contract, not an intermediate source snapshot or the old compatibility identity.
- A release-safe Ubuntu managed Host, real Windows Docker/secret-custody proof, installed desktop helper smoke, and data-bearing embedding migration remain unverified. Source tests cannot close those platform/manual gates.
- This report writes only its assigned research file. It does not create/activate tasks, revise specs, implement code, grant OS/API authority, or claim any acceptance case passed.
