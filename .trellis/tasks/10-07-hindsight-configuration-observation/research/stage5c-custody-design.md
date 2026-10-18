# Research: Stage 5C C1 custody and credential boot design

- Query: Choose the smallest current-dependency fit for same-host Hindsight credential delivery, and define its installation, identity, restart and Docker boot boundaries.
- Scope: internal; current Taki source/manifests, current Native source/lock and installed python-dotenv library source. Sole write: this report. No tests, builds, new dependencies, services, processes, image operations, real credentials, `.env` content or databases were accessed.
- Date: 2026-10-07.
- Active task: `.trellis/tasks/10-07-hindsight-configuration-observation`, explicitly supplied by the leader. The legacy pointer is empty; session-scoped routing is documented in workflow.
- Context: follows `research/stage5c-host-boundary-research.md`. 5A production files are concurrently owned by another agent. Paths below marked proposed are design targets, not existing implementation.

## Findings

### 1. Recommended decision

Choose a **packaged Node helper with a narrowly shared, read-only TSC1 decoder** for C1. Keep Core as the only catalog writer. Windows Shell invokes the helper behind its existing Host permission path; Ubuntu uses the same release-safe Node helper/CLI and systemd credential backend. Do not implement a new plaintext-secret broker over normal WS or add a private local socket service merely to avoid sharing the already implemented codec.

This is the smallest dependency-compatible choice, not a claim that helper installation or Docker secret boot is already implemented. C1 needs a real helper artifact, a boot-free codec export/package, a fixed same-host binding, and a proven container credential bootstrap. The last item remains a **mandatory technical spike**: current Native startup has no secret-file or private injection lifecycle, and Docker automatic restart cannot reconstruct an in-memory secret by itself.

### 2. Why decoder fits the current code better than a broker

| Evidence | Decoder consequence | Broker consequence |
| --- | --- | --- |
| `packages/core/package.json:13-28` already depends on `libsodium-wrappers` exactly `0.8.4`, Zod and Shared. Root `package.json:7-10` requires Node >=24. | Reuse the tested JS/Wasm crypto implementation and existing Node runtime prerequisite. No new crypto package is needed. | Still needs a secret-valued server, authentication, framing, permissions and lifecycle. |
| `packages/core/src/secrets/secret-catalog-envelope.ts:1-10,110-153` is pure crypto/format code; `openCatalog` authenticates store and key version. | Extract a boot-free codec module/package, preserving byte format and existing tests. | Core could call its existing resolver, but the transport would be entirely new. |
| `packages/core/src/index.ts:1-6` exports nothing; Core is currently a process, not a reusable library. | Do not import `main.ts`, deep-link an installed source checkout, or instantiate `SecretCatalogService` in a second process. Introduce a supported narrow package/build entry. | There is no hidden exported local broker to reuse. |
| `apps/desktop/src-tauri/Cargo.toml:30-64` has serde, sha2, Tokio, keyring and Windows APIs, but no libsodium/secretstream dependency. | Keep TSC1 decoding in Node; do not implement secretstream in Rust or infer AES/HMAC transitive crates can read it. | Windows named-pipe peer/ACL machinery is also absent. Some APIs could be enabled in the pinned `windows` crate, but using them from Core would require a new platform adapter. |
| `packages/core/src/server/ws-server.ts:35-66` owns a TCP WebSocket server. Bounded source search found no production Unix-domain/named-pipe secret listener or peer-credential validation. | No new secret-valued socket or ticket issuer is required. | A loopback address is not process identity. ACL/peer identity or securely provisioned one-use credentials, deadlines and revocation would all be new work. |
| `apps/cli/package.json:1-21`, `apps/cli/src/main.ts:88-96` show a release-safe Node CLI and stdin-oriented commands. | Use the same deployment shape for a separate helper application, without depending on the debug Rust node. | The existing CLI only authenticates as an operator; it is not a Host or a private secret channel. |

The decoder's trust tradeoff is explicit: it is a trusted local program running as the catalog owner and can transiently decrypt the whole TSC1 payload before selecting allowed refs. The single encrypted JSON envelope has no per-entry ciphertext isolation. It must never expose a general secret-reading command, dump mode, network listener or arbitrary ref resolver. If protection against a malicious program already running as that credential-owning user becomes a requirement, the decoder does not provide that isolation; neither does the current keyring helper boundary. Do not silently claim least-privilege cryptographic isolation.

### 3. Concrete C1 package and installation contract

Proposed ownership and paths:

| Component | Proposed source/package | Responsibility |
| --- | --- | --- |
| Pure codec | `packages/secret-catalog-codec/` | Move the current TSC1 open/seal/schema implementation into one boot-free package used by Core and helper. Preserve `TSC1`, AAD and error categories exactly. Helper entry imports only decoding/schema functions; no catalog writer/master-key creator API. Existing libsodium/Zod versions remain pinned by the same lock. |
| Host helper | `apps/hindsight-host/` | Release-safe Node entrypoints for `inspect-installation`, `check-custody`, and later typed owned-deployment work. The CLI prints only bounded non-secret results. No generic `get`, shell, env-file or debug-dump command. |
| Windows key adapter | Existing `apps/desktop/src-tauri/src/bin/taki-secret-key.rs` | Reuse framed **get** only for catalog reads. Add a separate versioned non-secret identity/provenance command if needed; keep existing get/create framing compatible. Never call create on the helper's behalf. |
| Windows invoker | New dedicated module under `apps/desktop/src-tauri/src/` | Resolve the installed artifact, verify identities, derive current token-user binding, pass a typed non-secret request on stdin, and retain process handle/result ownership. Spawn hidden with no shell interpolation. |
| Native bootstrap | New minimal module shipped with the accepted managed Native image | Receive bounded credentials privately, launch Native with process-local environment, supervise lifecycle, and emit only sanitized state. No keys or catalog master key in the image. This is not yet implemented. |

**Installation layout (proposal):** the desktop bundle includes `hindsight-host/<bundleId>/manifest.json`, helper JS/module tree and its locked runtime dependencies as explicit Tauri resources, resolved through Tauri's resource directory. `manifest.json` lists contract version, helper build/source identity, OS/architecture, SHA-256 of each executable/entrypoint/dependency artifact, and supported bootstrap versions. The Windows `taki-secret-key.exe` is an explicit packaged artifact with its own digest; the current Tauri config does not package it automatically.

For Ubuntu, install that same helper module artifact under an explicit administrator-selected installation prefix, with its `hindsight-host/<bundleId>/manifest.json`. The Node CLI runs without importing the Tauri crate or needing a GUI. C1 can require an already installed compatible Node 24 runtime: a local registration records its canonical executable path, actual version and digest. No mutable PATH lookup and no automatic runtime download. Packaging a Node binary later is a separate release-artifact choice, not a reason to assume a particular unapproved external version now.

An application-owned, **non-secret** registration file identifies the accepted installation and local Core binding. Proposed desktop path: `<Shell app_data_dir>/hindsight-host/installation.json`; proposed Ubuntu path: the helper service's explicit state directory plus `installation.json`. It names the canonical helper manifest/root, Node executable, expected `coreHostId`, local Core data directory, Shell/helper Host ID, key source kind/account/version and owning-user binding. OS ACL/ownership checks must be implemented at installation, not assumed from JSON or POSIX mode bits on Windows. Refuse redirected paths, unsafe ownership, absent/tampered artifacts and stale registrations; never search for a replacement silently.

Current packaging evidence: `apps/desktop/src-tauri/tauri.conf.json` has bundle targets/icons but no `resources`/`externalBin`; `build.rs:1-3` only calls `tauri_build::build`; root `desktop:build` only invokes Tauri. `packages/core/package.json` starts TS source directly, and `.github/workflows/ci.yml` tests Node 24 on both platforms but does not package a release helper. Therefore installation layout above is a concrete implementation deliverable, not an existing supported path.

### 4. Exact same-host identity and request binding

Keep these identities separate:

- `coreHostId` / `catalogStoreId`: the live Core's persisted identity and TSC1 AAD identity. `packages/core/src/hosts/host-identity.ts:19-48` defines the create-only identity; `main.ts:142-143` binds the catalog to it.
- `executionHostId`: the authenticated Shell on Windows, or the release helper Host on Ubuntu. It is not automatically equal to `coreHostId`.
- `ownerBinding`: Windows token-user SID hash plus fixed keyring service/account, or Ubuntu effective UID plus protected credential-source registration. Do not derive it from an operator-supplied username or `HOME`.
- `installationIdentity`: helper manifest digest + verified Node and key-adapter identities.
- `configurationIdentity`: original operation/attempt, immutable deployment plan digest, desired-config fingerprint, exact ref set, catalog envelope digest, key version and selected-entry provenance.

Current Windows token-user extraction exists privately in `apps/desktop/src-tauri/src/secrets.rs:132-186`; keyring uses service `TakiAgent` and Local persistence (`:23-24,45-50`). Expose a narrow non-secret fingerprint through the trusted adapter rather than adding a Node FFI dependency or relying on Windows `uid == -1`. Ubuntu can use Node's real effective UID and file ownership; the master-key file must come from the registered systemd credential directory, not a path supplied in a deployment request.

**Proposed strict request, containing no secret values:**

```text
CustodyPrepareV1 {
  operationId, attemptId, executionHostId, coreHostId,
  installationIdentity, ownerBinding, deploymentId,
  planDigest, desiredConfigFingerprint,
  catalogStoreId, catalogEnvelopeDigest, catalogKeyVersion,
  selectedRefs: [{ slot, secretRef, expectedUpdatedAt }],
  coreBootGeneration, requestNonce, expiresAt
}
```

Schema limits and deadlines should come from the relevant deployment operation plan; this report does not invent a new global timeout. Slots are the seven fixed Hindsight refs already declared in `hindsight-secret-refs.ts:9-16`. An absent optional override has explicit inheritance semantics; a missing required ref fails before Native startup. There is no arbitrary path, environment-variable map, Core URL, key-helper command or secret ref supplied by the UI/model.

The request is issued by the admitted Core operation and delivered over the existing authenticated Host control path. Shell validates its current generation/policy/input tuple before invoking the pinned helper. Stdin is an inherited private pipe, not a shell command or public listener. The helper validates registration, actual user/key source, exact local file identities and the request. Core's current handshake does not expose `coreHostId` (`packages/shared/src/connect-schema.ts:36-42`); add a narrowly scoped **non-secret** custody/status/admission contract to bind the live local Core to this registration. Do not claim that existing `connect` already proves the local catalog path.

A future Ubuntu managed helper must provide a release-safe Host/control client with the same generation and exact-input rules, using Shared schemas and explicit operator approval. The existing operator CLI's token is not Host provenance. A documented Node helper `serve`/one-shot Host mode with an explicitly provisioned Node identity/token in systemd encrypted credentials is the concrete direction; its Host client is new code and belongs in C1/C2 packaging, not in `taki-node`. A plain CLI `check-custody` command may inspect local custody, but its JSON output must never be accepted by Core as a trusted deployment receipt.

There is deliberately **no new local secret broker** in this recommendation, so there is no bearer ticket that authorizes fetching secrets from Core. Nonces bind an operation; they do not turn receipt text into a credential or replace authenticated Host provenance. The trusted same-user helper and OS credential owner remain the local trust boundary.

### 5. One-writer read path and state transitions

1. Core snapshots the admitted operation's desired configuration and **digest of the actual sealed catalog bytes**, not only timestamps. Current per-entry `updatedAt` uses wall-clock milliseconds (`secret-catalog-service.ts:153-160`); key version alone does not change on every write. Envelope digest prevents accidental acceptance of a different same-version payload.
2. Helper opens only the registered catalog file read-only, reads one bounded complete envelope, obtains the current master key using **get**/systemd-read, and authenticates `storeId`, format and key version using the shared codec. It does not instantiate the mutable service, create missing key material, rotate/restore, or write any catalog bytes.
3. Verify envelope digest and selected-ref provenance against the admitted request, select only its approved slots, and place those values in short-lived memory. The existing codec decrypts the complete payload, so both key and unused entry references should be released as soon as possible. JS strings/Wasm buffers do not establish guaranteed secure erasure; do not promise it.
4. Before credential injection and before accepting a ready receipt, revalidate original operation/attempt, live Core boot/generation, config fingerprint and current catalog digest. Do not accept a supplied old ciphertext as the authoritative current file. File publication is old-or-new via staged fsync/link/rename (`catalog-publication.ts:17-43`); verify that read-only handles behave correctly under concurrent replacement on each platform.
5. If the snapshot changes during external work, mark the result stale/unknown and reconcile the exact owned candidate. Never silently switch to new secrets inside the original attempt. Publication of ready/active state requires the final current-generation checks; prior process launch alone is not the commit point.

This is snapshot-bound delivery, not immediate global revocation. An already running Native process has its own credentials; catalog clear/rotation does not retroactively erase that process. A later controlled restart/rebind is required. Product status must expose pending/stale application rather than claim a stored clear immediately affected Native. An instant-revocation contract would require a stronger runtime design and is not present today.

| Event | Required behavior |
| --- | --- |
| Missing key/helper, unreadable or wrong-user credential source | `locked`/unavailable; zero value output, no create/fallback, no Native start. |
| Wrong store, tampered/truncated envelope or unsupported version | Bounded refusal; file bytes untouched; do not try alternate catalog paths. |
| Catalog set/clear or same-version replacement during prepare | Digest mismatch; discard prepared values and require a new admitted snapshot. |
| Catalog key rotation | Fresh key+envelope read on the next attempt; old request/key version becomes stale. A key-source/envelope publication mismatch fails closed, never restores an old key. |
| Core restart | Old boot generation/nonce cannot authorize injection/readiness. Reconcile the original helper/container state through a new operation observation; no automatic request replay. |
| Helper crash before injection | No credentials have been persisted by helper; next attempt reopens the catalog and key source. |
| Helper crash during/after injection | Outcome unknown until the bootstrap's exact startup/generation receipt is queried. No second blind injection/start. |
| Container restart | New bootstrap startup identity; previous acknowledgement invalid. Re-inject only after current ownership/config/custody checks; unavailable helper leaves Native unstarted. |

Current `rotateKey` reseals and swaps in-memory state (`secret-catalog-service.ts:194-209`); the caller owns external key provisioning. This research does not invent an atomic key-source rotation protocol. C1 must test and truthfully refuse the mismatch window.

### 6. Docker credential boot: concrete candidate and missing proof

#### 6.1 Current source cannot satisfy the requirement by itself

- `docker/standalone/Dockerfile:183-199,268` copies and runs `start-all.sh` as unprivileged `hindsight`. `start-all.sh:228-245` invokes `hindsight-api` directly and checks `/health`; it has no stdin credential protocol or runtime-secret supervisor.
- Native config reads credentials from process environment (`hindsight_api/config.py:3003-3006`). `server.py:33-59` loads dotenv and constructs the engine before requests.
- `config.py:25-41` explicitly calls `load_dotenv(find_dotenv(usecwd=True), override=True)`. The managed launcher must disable this. The pinned `uv.lock` python-dotenv package is `1.2.2`; installed matching library source `.venv/Lib/site-packages/dotenv/main.py:22-29,409-416` implements `PYTHON_DOTENV_DISABLED=true`. This source evidence supports using that flag; the final image still needs a locked artifact check.
- Existing compose/test scripts pass keys as container environment. There is no source-backed promise that those values avoid Docker configuration/inspection. Neither an env-file nor an inherited `-e KEY` is an acceptable substitute for proving custody.
- Native daemon support detaches with stdin closed and redirects logs to a file (`hindsight_api/daemon.py:63-108`). It is not the proposed private credential bootstrap.

#### 6.2 Proposed minimal bootstrap lifecycle

Use the Python standard library already present in the accepted Linux image; no Docker SDK or extra runtime dependency is required for the design. The following modules/protocol do **not** currently exist:

1. A small PID1 bootstrap starts with only safe non-secret config in Docker `Config.Env`, and a configured tmpfs runtime directory. It creates a fresh `startupId` and a mode-restricted local Unix socket there, then reports `waiting_for_credentials`. It does **not** start Native or expose model operations yet.
2. The host helper addresses the **exact inspected owned container ID** and fixed bootstrap submission program via Docker exec with stdin enabled and **no TTY**. Only non-secret operation/startup/config IDs occur in argv. The framed secret payload is written to that exec process's private stdin; it is not shell-interpolated, sent to Docker `Env`, written to a host file, echoed to stdout or placed in a docker command string.
3. The short-lived Python submitter forwards the frame to the bootstrap's protected Unix socket, verifies the startup challenge, and receives a bounded acknowledgement. Payload fields are the fixed approved slot set plus operation/startup/config identities. The bootstrap rejects extra keys, wrong/old startup IDs, oversize frames and a second conflicting configuration. The container owner/Docker administrator is a trusted boundary; a same-UID malicious process inside the container is not isolated by Unix file mode alone.
4. Bootstrap builds the child's environment in memory, sets `PYTHON_DOTENV_DISABLED=true`, and starts `/app/start-all.sh` (or a reviewed equivalent preserving its shutdown behavior) with a fixed argv. Provider credentials live only in the Native child environment/client memory. Do not use `docker exec -e`, `env KEY=value`, a shell script containing values, or write `.env` inside the container.
5. Bootstrap owns child stdout/stderr pipes and emits only bounded structured state/reason events. Raw Native output must not reach Docker logs or a persistent daemon log by default. This matters because the standalone worker currently prints its database URL (`worker/main.py:246`), and startup verification can log underlying provider exceptions. A future raw diagnostic export needs its own sanitization contract, not incidental passthrough.
6. Bootstrap supervises termination and reaps children. Preserve the existing graceful stop behavior (`start-all.sh:170-222`) and prove signal propagation when it is no longer PID1; forwarding only to the wrapper without its children is insufficient. It records no plaintext credentials on disk. Its acknowledgement binds startupId/config digest and actual child lifecycle; API `/health` and 5A observation remain separate checks.

This avoids deliberately placing provider values in Docker creation/exec environment fields. It does **not yet prove** how Docker daemon/CLI attach streams, logs, container checkpointing, or crash dumps behave on the supported installation. Ordinary process memory remains sensitive; the design does not claim protection against the OS/container administrator.

#### 6.3 Restart contract must be explicit

After Docker restarts the container, the bootstrap has no credentials and a new startupId. It must wait. Restoring a named database volume or setting Docker `restart: always` cannot regenerate the missing values.

A release-safe helper supervisor must inspect registered owned deployments and, for an already admitted unchanged configuration, perform a new generation-bound credential delivery from the current catalog. This is a narrowly authorized restart-maintenance action, not replay of setup/create or an old pending Host request. An uncertain prior effect is inspected first. If configuration, key version, Host policy or resource ownership changed, stop at a visible stale/locked state and require revalidation.

- **Windows:** the observer must survive Home closure and use the same logged-in user's credential scope. Starting it only as a short-lived child of a dialog does not meet the restart requirement. A hidden installed helper supervisor associated with Shell/user session is a candidate; unattended restart before that user's login is not supported by the current Credential Manager account model. A Windows service-account solution is a different installation/custody choice.
- **Ubuntu:** the same Node helper can run as a dedicated release service/CLI with explicit `LoadCredentialEncrypted=` inputs and a persisted non-secret deployment registry. It must never depend on `taki-node`, desktop approval dialogs or a Tauri-linked Linux helper. Required Node/Host token credentials and service authorization are provisioned explicitly at installation.
- **Helper/Core/key source unavailable:** the container remains alive in `waiting_for_credentials` or exits with a typed failure according to the finalized supervisor contract; Native stays unstarted and no `ready` receipt is issued. This is fail-closed recovery, not automatic availability. Existing-instance connections remain usable.

**Mandatory spike before C1/C2 is dispatch-ready for real credentials:** implement a fake-secret bootstrap fixture and validate frame delivery, exact-container/startup binding, no sentinel in Docker inspect/environment/config/logs/host files, abrupt helper death, full container restart with tmpfs reset, daemon restart, host-user session loss, duplicate injection, locked/rotated catalog and graceful database shutdown. It must use fake providers/isolated storage and no paid/model calls. A source review alone cannot mark this path proven; none of those runs occurred here.

### 7. Proposed C1 implementation/check boundary

1. Freeze strict request/result/registration schemas and installation manifest; extract the existing codec without format changes. Add read-only custody helper with Windows get-only and Ubuntu credential-directory adapters. Public output: slot presence, source/key/config identity, refusal category; no values.
2. Add installed-path/digest/user-binding validation and helper invocation behind the canonical Host path. Provide a release-safe Node CLI; define Ubuntu Host registration rather than accepting operator-generated receipt JSON. Keep existing-instance setup independent of helper availability.
3. Implement and test the fake-secret Native bootstrap spike above. Only after that proof select the precise observer/service packaging and permit real credential delivery. If proof fails, revise this mechanism; do not default to Docker env-file storage.
4. Independent check should cover artifact tampering, wrong user/store/Host, generation/digest drift, one-writer behavior, secret sentinels across every boundary, and crash/restart. This warrants its own check before C2 provisioning or C3 model lifecycle work.

The helper's read-only codec is small; its **custody plus restart boundary is not**. One implementation owner can own Shared/codec/helper packaging initially, while Native bootstrap changes wait for the 5A source handoff. Combining C1 with unrelated template work would make its acceptance harder to assess.

### 8. Engineering choices versus owner environment choices

The leader can choose the decoder approach, module/package split, manifest layout, fixed slot protocol, generation/digest checks, stdin framing, hermetic fixtures and check cadence. Those derive from current code and approved scope.

Still unresolved technical proof: packaged dependency resolution outside a checkout, Windows ACL/user provenance, release-safe Ubuntu Host control integration, Docker stdin/attach handling, bootstrap signal/log behavior, and restart observer lifecycle. These should be engineering spikes, not vague product questions.

Actual owner decisions are needed only for selecting/installing a real Docker/Node/system service, granting OS/Docker privileges, choosing the deployment host/state directory, choosing unattended Windows service-account behavior, supplying real provider keys/models, permitting downloads/paid calls, or touching existing data. This research neither performs nor requests those actions.

## Related specs / references

- `.trellis/spec/backend/secret-catalog.md`: encrypted at-rest format, one writer, get/create framing, locked behavior and no-value public results.
- `.trellis/spec/backend/host-operation-lifecycle.md`: exact Host/input/generation ownership and no reconnect replay.
- `.trellis/spec/backend/permission-authorization.md`: canonical Core governance and stricter Host enforcement.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md`: key-bootstrap spawn exception does not authorize deployment spawn in Core.
- Prior report `research/stage5c-host-boundary-research.md`: R9/R10, existing managed receipt consumer, Stage 5C milestones and model/data migration limits.
- Local library/version evidence: Node >=24 repository requirement; libsodium-wrappers `0.8.4` already pinned; Native Python base `3.11-slim`; python-dotenv `1.2.2` lock and installed source. No external version or artifact digest was invented and no network research was used.

## Caveats / Not Found

- No private secret broker, read-only installed decoder, deployment helper package/manifest, safe Docker secret bootstrap or production Ubuntu managed Host currently exists in the inspected source.
- The suggested decoder shares the local credential owner's trust and transiently opens the whole catalog. It does not isolate secrets from a compromised same-user helper, promise perfect memory erasure, or revoke an already running provider client instantly.
- Current secret rotation requires coordinated external key provisioning; the mismatch window must fail closed. Current timestamps alone are not a sufficient catalog-generation identifier.
- The recommended Docker mechanism is a concrete candidate with source-grounded required changes, **not a verified solution**. Missing restart/custody proof is named above and must be completed before real deployment claims.
- Only this report was written. No code/spec/task mutation, test/build, process/service start, credential read, dependency installation or original-data access occurred.
