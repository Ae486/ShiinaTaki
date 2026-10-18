# C1 source research excerpt source-custody-1

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-custody-design.md`. SHA-256: `b9d867a35b1fb41d573d831cf13d21be2e39d848eb9421508e733d458f97fc4a`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

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

