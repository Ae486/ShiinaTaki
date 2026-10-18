# C1 independent readiness excerpt 2

Source: `.trellis/tasks/10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md`; SHA-256 `7589003217c782fa3904e6a097c14212edbb48c73d351e057dd8c51aabeb3562`.
This is source/design evidence, not code or installed-platform acceptance.

### 3. Windows: verify the actual installation and process, not just strings

**Evidence.** `apps/desktop/src-tauri/src/secrets.rs:132-186` reads actual token-user SID, but its existing use is credential-creation locking rather than a general installation DACL verifier. `tauri.conf.json` has no demonstrated C1 helper/dependency installation. `packages/core/src/secrets/master-key.ts:63-82` launches a configured helper; it does not verify a C1 installation. `taki-secret-key.rs:35-45` reads stdin even for `get`, so a caller that leaves stdin open can hang until timeout. POSIX `0600` in catalog publication is not a Windows DACL proof.

Freeze these checks in the Rust adapter/installed launcher:

- Expected manifest/build identity comes from trusted packaging or protected explicit registration outside the replaceable payload. Self-hashing a manifest and payload in the same attacker-writable tree is not a trust root.
- Use actual file/directory handles to inspect final local paths, volume/file IDs, owners and effective DACL constraints. Reject reparse points, UNC/device/ADS path ambiguity, unsupported filesystems and unsafe writable parents. A `realpath`/`stat` pair alone does not close a subsequent replacement race.
- Verify the complete consumed tree: entrypoint, JS/package metadata, sodium/Wasm and transitive dependencies, Node runtime and get-only adapter. Reject unregistered symlinks/hard-link/redirection arrangements that invalidate the protected-tree assumption. Do not claim package-manager symlinks are a safe installed tree by default.
- Keep read handles with write/delete sharing denied for verified executable/artifact files, plus necessary parent replacement guards, until the corresponding process has finished using that tree. Verify the exact objects that later execution resolves. Add supported-Windows race tests for Node launch and lazy module reads; if the chosen primitives cannot establish this, leave installation unavailable instead of reducing the check to hash-before-spawn. Core's catalog is the separate rename-tolerant read case above.
- Use actual process-token user identity, never `USERNAME`, `HOME`, request JSON or helper-reported SID. Check registered keyring service/account/version against this identity. The trusted local account and administrator remain trusted boundaries; this does not protect against that same principal deliberately compromising the helper.
- Fixed absolute executable paths, fixed argv/cwd, no shell, hidden Windows process. Construct an allowlisted environment; do not inherit `NODE_OPTIONS`, `NODE_PATH`, preload/loader/inspector/coverage/debug settings or arbitrary search paths. Pin actual Node executable digest/version, not just `node --version` from PATH.
- Key adapter is `get` only: close stdin immediately, require exactly `[u32 LE 32][32 bytes]` (36 bytes total), bound/consume stdout and stderr, discard raw diagnostics, enforce the existing 10-second adapter deadline or remaining parent deadline if shorter, and kill/reap on failure. No automatic `create`, ACL repair or credential migration.

Readiness needs supported-Windows execution evidence for these primitives. Unit mocks alone prove only decision logic. Adding required features to the already locked Rust Windows crate is distinct from introducing a new dependency; the final implementation owner must account for that build change.

### 4. Ubuntu: ship and enroll an actual release Host

**Evidence.** `packages/core/src/server/methods/connect.ts:81-107` requires a paired/token-authenticated node; loopback auto-trust is operator-only. `packages/core/src/devices/device-registry.ts` provides the existing role-bound enrollment/token mechanism. `apps/cli/src/main.ts:74-83` uses the operator role. `apps/desktop/src-tauri/src/bin/taki-node.rs:44-48` refuses release execution. `capability-challenge.ts:113` refuses an unattended ask without an operator. `master-key.ts:29-56` reads a fixed filename from the service credential directory and cannot create it.

Minimum implementation:

1. `apps/hindsight-host` includes a real release-safe Node Host client using existing protocol/catalog versions, explicit node enrollment and the canonical descriptor/classifier/challenge/execute/resume/cancel lifecycle. Advertise only implemented C1 capability cells. Do not relabel an operator CLI as a Host or bypass `ask` because the platform is headless.
2. Enrollment uses existing node pairing/token issuance. Provision the resulting token through protected installer/service input and the systemd credential mechanism; do not echo it, put it in argv or directly edit Core's device database. A no-GUI controller may use the existing operator approval channel. No new token authority is needed.
3. Register a fixed service, install prefix, Core store and effective UID. Run as the same credential-owning UID as Core for the current read-only catalog model; an arbitrary separate service user cannot be assumed able to read Core's `0600` catalog. Use fixed `ExecStart` Node + compiled entrypoint, protected service configuration and no request-selected paths.
4. Keep Node enrollment credentials and Catalog master key separate. Register the logical credential name and service policy, **not another service's current `CREDENTIALS_DIRECTORY` path**. systemd may allocate a fresh private credential directory on every start. Resolve the running service's source, validate actual regular-file identity/ownership/mode and read the fixed `taki-secret-catalog-master-key` name through a bounded descriptor. Reject unsafe symlink parents, group/world writable custody paths and group/world readable master-key material; allow only the registered UID/root ownership policy.
5. Same-host custody means the registered trusted local executor plus OS/account/file boundary. A WS token, localhost address or JSON `coreHostId` does not itself attest co-location. Refuse incompatible registration rather than scan for another catalog.
6. C2 maintenance uses a fresh authorized operation. Unattended restart needs an applicable canonical `auto`/explicitly bounded standing policy; `ask` with no live operator remains `APPROVAL_REQUIRED`. Do not add a script that approves its own challenges.

Deliver Ubuntu service/enrollment artifacts and supported-platform tests in C1. Do not report installed Ubuntu parity from Windows source compilation alone. Actual installation and privilege changes remain owner environment actions.

### 5. Release-safe codec and dependency closure

**Evidence.** `packages/core/src/secrets/secret-catalog-envelope.ts:8-10` imports locked libsodium-wrappers, zod and pure Shared schemas; the codec itself is independent of Core boot/filesystem ownership. `packages/shared/package.json` currently exports source `.ts`; Core is not an existing independently built public codec package. Root TypeScript configuration already supports extension rewriting. `pnpm-lock.yaml` pins libsodium-wrappers/libsodium 0.8.4.

Extract `packages/secret-catalog-codec` with one-way imports of only pure Shared contracts. Keep Core's mutable service and all file/key/process code outside it. Do not export the codec through a broad Shared barrel that makes frontend consumers load sodium. Preserve TSC1 bytes/AAD/key version/error behavior and the existing format tests; moving functions is not a format migration.

Build helper, codec and required Shared modules as compiled JS with correct ESM exports. Ship their complete pinned runtime dependencies, sodium/Wasm assets and package metadata/licenses. Do not depend on Node stripping `.ts` inside installed `node_modules`, pnpm workspace symlinks, a development store or source-checkout imports. Use the already locked compiler/toolchain; no new bundler is necessary to establish this contract.

Validation must launch from an empty unrelated cwd against a copied install tree with checkout/store access unavailable, exercise sodium readiness and decode a fake envelope, and prove no Core boot/server/process owner is imported. Tampered dependency/package metadata and malicious Node preload sentinels must refuse. This is functional install closure, not a startup-performance project.

### 6. Finite request, result and secret-delivery contract

These are **recommended C1 v1 limits**, not claims that the existing TSC1 store already enforces aggregate limits. Freeze them in Shared/Rust/Python fixtures before dispatch; reject before allocation/read growth and never echo rejected payloads.

| Surface | Recommended boundary |
| --- | --- |
| Identity fields | Existing strict UUID/Host/control schemas; SHA-256 as exactly 64 lowercase hex characters; positive safe-integer generations; existing ISO timestamps. No unconstrained identity objects. |
| Selection | At most the seven fixed Hindsight credential slots, no duplicates or unknown refs. Resolve their concrete ref mapping in Core from `packages/core/src/memory/hindsight/hindsight-secret-refs.ts:9-17`; no arbitrary caller resolver. Optional inheritance is an explicit enum/source choice, not an omitted value silently interpreted as success. |
| Non-secret helper invocation | Versioned strict object; at most 32 KiB UTF-8 including the bounded trusted control projection. Fields: custody snapshot/store/key/digest, fixed selection/config/install identity, nonce/deadline, and actual issued operation/request/Host context. No paths, commands, Core URLs, environment maps or arbitrary ref strings. |
| Result/status | At most 16 KiB UTF-8; fixed state/reason enums and admitted non-secret identities only. No free-form provider errors, subprocess output, secret values or encrypted envelope dump. C1 status contains no deployment-ready authority. |
| Envelope read | 16 MiB sealed bytes maximum for this helper version; check file size then enforce cumulative streaming/read cap as well. Reject oversize as a typed custody limitation without truncation or rewriting. This adds no global catalog migration or public `secret.set` limit change. |
| Selected secret strings | At most 65,536 UTF-16 code units each, matching public `secret.set` at `secret-catalog-schema.ts:49`; apply the check to imported/restored values too. Bound encoded transport separately; this limit is not 65,536 UTF-8 bytes. |
| Future private injection frame | Four-byte unsigned length prefix + strict UTF-8 JSON, maximum 4 MiB payload, seven fixed slots only, one frame/EOF, no trailing data. This accommodates JSON escaping of seven maximum-sized strings. Header binds startup/config and the newly authorized Host attempt. Never put this frame on WS. |
| Adapter output | Exactly 36 bytes for the existing master-key frame; bounded discarded stderr, immediate stdin EOF for `get`. |
| Deadlines | Never exceed the original admitted Host deadline (current default broker budget is 90 seconds). Local key call uses min(10 seconds, remaining budget). New startup requires a new bounded authorization; no extension or renewal silently upgrades an old attempt. Model downloads/health and graceful shutdown have separately owned C2 budgets. |

Use allowlisted typed failures such as unsupported installation, unavailable Host, unsafe owner/path, locked key/catalog, oversized envelope, stale snapshot and unknown outcome. Exact spelling should follow existing error conventions. An oversize existing catalog must be honestly unavailable to C1 while existing-instance functionality remains available; do not treat it as corruption or delete entries.

