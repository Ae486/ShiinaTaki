# C1 source research excerpt source-host-2

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md`. SHA-256: `e9cab382d8754a55516c31310aaaf0ccbf8fe45b368ea27ea028d63b7c6fc1dd`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

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

