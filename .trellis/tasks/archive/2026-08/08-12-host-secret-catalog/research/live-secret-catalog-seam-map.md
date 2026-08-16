# Research: Live Seam Map for the Host-Local Encrypted Credential Catalog

- Query: map the live-code seams (protocol surface, secret touchpoints, storage conventions, spike plan, testing seams, risks) needed to implement the Host-Local Encrypted Credential Catalog without re-discovering the repository
- Scope: mixed (live code read in this session + npm registry evidence for the spike)
- Date: 2026-08-16
- Frozen product decision: `.trellis/tasks/08-10-skills-mcp-productization/research/vps-secret-backend-options.md` (libsodium secretstream envelope; Windows Credential Manager versioned master key via host-local helper; Linux `LoadCredentialEncrypted=`; OpenBao out of scope). Not reopened here.

## 1. Host-control protocol surface

### 1.1 Canonical wire contract (TypeScript truth)

| Anchor | Fact |
| --- | --- |
| `packages/shared/src/host-control-schema.ts:8-15` | `HOST_CONTROL_METHODS` = `host.catalogPublish` (Node→Core RPC), `capability.request`/`challenge`/`resume`/`cancel` (Core→Node notifications), `capability.respond` (Node→Core RPC) |
| `packages/shared/src/host-control-schema.ts:17-18` | `HOST_CONTROL_PROTOCOL_VERSION = 3`, `HOST_CATALOG_SCHEMA_VERSION = 2` — bump protocol only for incompatible Host-control changes; catalog additions ride the catalog schema version |
| `packages/shared/src/host-control-api.ts:6-36` | the focused re-export surface from `host-control-schema.ts`; a new secrets schema module must be added to this export list (POS comment: keeps the package entry within source size limits) |
| `packages/shared/src/host-control-schema.ts:163-180` | `HostOperationControlSchema` — the sealed control tuple (runId/operationId/attemptId/targetHostId/connection/catalog/policy/approval generations, governanceProjection, inputDigest, idempotencyKey, deadlines) any new sensitive Core→Host command frame must carry |
| `packages/shared/src/host-control-schema.ts:101-116` | `HostFrameRejectReason` union (`wrong_host`, `stale_generation`, `unsupported_version`, `invalid_catalog`, `unknown_request`, `duplicate`, `late`) + `HostFrameAck` discriminated union |

### 1.2 Version negotiation pinning (currently v3)

- Core side: `packages/core/src/server/methods/connect.ts:115-128` — `negotiateHost()` picks `HOST_CONTROL_PROTOCOL_VERSION` only if it lies in the Node's declared `host.protocol.{min,max}`, and `HOST_CATALOG_SCHEMA_VERSION` only if present in `host.catalogSchemaVersions`; failure → `AUTH_FAILED` "Host protocol versions are not supported" (validated before pairing mints credentials, `connect.ts:77-79`).
- Node side: `apps/desktop/src-tauri/src/ws_client.rs:104-139` — `perform_handshake` sends `connect` with the declaration and persists the issued token via the injected `SecretStore` (`ws_client.rs:124`).
- Rust mirrors: `apps/desktop/src-tauri/src/host_control_protocol.rs:9-10` (`HOST_CONTROL_PROTOCOL_VERSION: u64 = 3`, `HOST_CATALOG_SCHEMA_VERSION: u64 = 2`); all DTOs use `#[serde(deny_unknown_fields)]` to mirror Zod `strictObject` (e.g. `host_control_protocol.rs:109-133` for `HostCatalogPublish`). `protocol.rs` is the re-export module the rest of the crate imports through (`ws_client.rs:23-30`).

### 1.3 Method registry — what a new operator method must reuse

- `packages/core/src/server/method-registry.ts:60-78` — `createMethodRegistry()`; one `registry.register(def)` call per method (no switch statements; "invariant 7" pluggable seam).
- `packages/core/src/server/method-registry.ts:31-39` — `MethodDefinition` = `{ method, roles, paramsSchema, onInvalidParams?, handler }`. Zod validation happens before the handler (`method-registry.ts:89`); role gate after (`method-registry.ts:92-94`: authenticated connection role must be in `roles` else `FORBIDDEN`).
- `packages/core/src/server/method-registry.ts:24-29` — `MethodContext` = `{ notify, connection, close, onClose }`; `ctx.connection.state` is the authenticated provenance (`{ status, deviceId, role, capabilities, host? }`).
- Operator-method exemplar: `packages/core/src/server/methods/permission-methods.ts:31-68` — `roles: ["operator"]`, method-name constants from `@taki/shared` (`PERMISSION_METHODS`), optimistic-generation params, sanitized log fields only (`permission-methods.ts:89` logs `{ level }`, never values).
- Registration wiring: `packages/core/src/main.ts:260-272` (connect), `:338-370` (all operator methods incl. `registerConfigMethods`, `registerPerceptionMethods`), `:378-389` (env-double-gated dev trigger precedent for anything that must have zero production surface).
- Node-role RPC exemplar with provenance binding: `packages/core/src/server/methods/host-catalog-publish.ts:16-38` — `roles: ["node"]`, handler checks `ctx.connection.state.host` + `connections.isCurrentHost()`; `onInvalidParams` retires the invalid candidate only when provenance matches (`host-catalog-publish.ts:40-58`).

### 1.4 How Desktop and CLI call operator methods

- Desktop: `apps/desktop/src/lib/ws-client.ts:174-224` composes `JSONRPCServerAndClient`; `apps/desktop/src/lib/ws-client-methods.ts:109-158` — every outbound call goes through `requestMethods()` and every result is parsed through a `@taki/shared` schema (the zod boundary holds for every inbound frame; header comment `ws-client-methods.ts:5-7`). Grouping helpers like `permissionMethods(request)` (`ws-client-methods.ts:61-72`) are the pattern a `secretMethods(request)` group would follow.
- CLI: `apps/cli/src/main.ts:30` builds a one-shot operator call from `--call`/`--params`; `:93` runs it via `runOperatorCall` (`apps/cli/src/operator-call.ts`); the REPL also parses operator calls per line (`main.ts:126-134`). `requestWithDeadline` (rpc-deadline) wraps every request (`ws-client-methods.ts:110`).
- Roles today: `connect` accepts `operator` and `node` (`connect.ts:61`); `Role` comes from `@taki/shared` `RoleSchema`. A secret.set/clear/presence method registers with `roles: ["operator"]` only; the dispatch gate at `method-registry.ts:92-94` is the single enforcement point.

### 1.5 Where a sensitive operator→Core→Host command path lands

The frozen decision puts the catalog on the owning Execution Host; today every MCP client is Core-side (`packages/core/src/main.ts:183-192` — `createMcpManager` in the Core process; `ownerHostId: coreHostId`), and Core itself is an Execution Host with a stable identity (`main.ts:86`, `loadOrCreateHostIdentity(<dataDir>/host-identity.json)`). Therefore:

- MVP `secret.set/clear/presence` = Core operator methods over the existing WS registry, writing the Core-local encrypted catalog (TypeScript, `packages/core`). No new wire frame is needed for the Core-owned case.
- If/when a Host-owned MCP/capability needs its own catalog, the command rides the existing Core→Node notification path: Rust dispatch table `apps/desktop/src-tauri/src/ws_client.rs:225-234` (`"capability.request" | "capability.cancel" | "capability.resume"` match arms) extended with a new method string mirrored from `HOST_CONTROL_METHODS`, carrying `HostOperationControl` and settling through `HostSession` (`apps/desktop/src-tauri/src/host_session.rs:48-78`) with the per-generation terminal cache. Anything weaker (payload hostId as provenance) is forbidden by the spec (`host-operation-lifecycle.md` §3, §7 wrong-vs-correct).

## 2. Existing secret/credential touchpoints (live code)

| Touchpoint | Anchor | Current behavior |
| --- | --- | --- |
| Rust `SecretStore` trait | `apps/desktop/src-tauri/src/secrets.rs:13-18` | `get/set/delete`; missing = `Ok(None)` — the semantic shape the frozen research explicitly preserves |
| Windows Credential Manager adapter | `apps/desktop/src-tauri/src/secrets.rs:20-60` | `KeyringStore`, service `"TakiAgent"` (`secrets.rs:11`); keys in use: `node-token` (`ws_client.rs:34`), `device-id` (`node.rs:29`). `keyring = "4.1"` at `apps/desktop/src-tauri/Cargo.toml:43`. Idempotent delete (`secrets.rs:54-58`) |
| Debug-only plaintext store | `apps/desktop/src-tauri/src/bin/taki-node.rs:117-177` | `FileSecretStore` — plaintext `secrets.json` under the node data dir; `#[cfg(debug_assertions)]` and header says never ships (`taki-node.rs:117-118`) |
| MCP server config (plaintext secret channel today) | `packages/core/src/mcp/mcp-config.ts:12-30` | `<dataDir>/mcp-servers.json`: stdio entries carry `env: record<string,string>` (`:14`), http entries carry `headers: record<string,string>` (`:23`) — these maps are where plaintext credentials can sit today and are the migration source |
| Sanitized MCP metadata | `packages/core/src/mcp/mcp-config.ts:38-41` | `mcpPublicConfig()` fingerprints only `command/args/cwd` or `url` — deliberately excludes `env`/`headers`; consumed by `mcp-manager.ts:194` (`cfg.<sha256>`) as the subject revision. This is the seam stable secret references must keep sanitized |
| Legacy permission files | `apps/desktop/src-tauri/src/node.rs:86-87` | `permission-level.json` read exactly once at boot via `load_level` + `load_legacy_constraint`; `gate-decisions.json` loaded at `node.rs:82` (read-only compatibility input per `permission-authorization.md` §Legacy compatibility — do not delete legacy files early) |
| Legacy MCP deny | `packages/core/src/main.ts:179-182` | `mcp-approvals.json` read through `createLegacyMcpDenyReader` |
| Device tokens | `packages/core/src/devices/paired-device-store.ts:15`, `device-registry.ts:58,90-100` | only `tokenHash` (base64 digest) is persisted in `devices.json` — at-rest sanitization precedent |
| Config store | `.trellis/spec/backend/config-store.md` (spec, verified read) | secret rows expose `value: null` + `secretSet` presence only; writes refused with `CONFIG_REFUSED reason:"secret"`; "the required durable target remains the OS credential backend" (spec header) — this task is that backend |
| Bootstrap env | `packages/core/package.json:8-9` | `node --env-file-if-exists=../../.env.local src/main.ts`; `.env.local` intentionally absent, minimum-only rule in `docs/ZCODE-HANDOFF.md` §3.3; `TAKI_PROVIDER_API_KEY` read via e2e `e2e/src/fixture/paths.ts:25` |
| Pairing code logging exception | `packages/core/src/main.ts:257-271` | the one sanctioned secret-ish value in a log (short-lived pairing code); tokens never logged |

## 3. Host-side storage conventions the catalog must mirror

### 3.1 The identity create-only/fsync pattern (the strongest precedent)

`packages/core/src/hosts/host-identity.ts:28-52` — `loadOrCreateHostIdentity`:

1. try strict read; ENOENT → create; malformed/unreadable → **throw** (never mint a replacement, `host-identity.ts:78-89`);
2. stage into `<file>.<pid>.<uuid>.tmp` opened `"wx"` (create-only), write, `fsyncSync` (`host-identity.ts:54-68`);
3. publish with same-directory `linkSync`; `EEXIST` (concurrent winner) → read the winner without overwrite (`host-identity.ts:44-47`);
4. staged file always cleaned up (`host-identity.ts:48-50`).

This is exactly the "never initialize over existing ciphertext" and atomic-publication discipline the catalog envelope needs (frozen research §5.3 bullets; PRD AC2). The test precedent for fail-closed identity is `apps/desktop/src-tauri/src/node.rs:236-258` (invalid/unreadable identity never silently replaced, `set_calls == 0`).

### 3.2 Rust Host persistence layout and atomic write

- Node data dir layout: `apps/desktop/src-tauri/src/node.rs:33-44` — `NodeConfig.data_dir` holds `gate-decisions.json`, `audit.jsonl`, `exec-policy.json`, `permission-level.json`; Tauri app resolves it via `handle.path().app_data_dir()` (`apps/desktop/src-tauri/src/lib.rs:137`); headless node via `TAKI_DATA_DIR` (`bin/taki-node.rs:58-61`).
- Rust atomic write: `apps/desktop/src-tauri/src/gate/decisions.rs:127-134` — `write_atomic()`: `create_dir_all` parent → write `<path>.json.tmp` → `fs::rename`. Note: **no fsync** — weaker than the Core identity pattern. The catalog must follow `host-identity.ts` (fsync before publish), not `write_atomic`.
- Crash/tamper recovery precedents: corrupt `gate-decisions.json` → warn + `legacy_closed = true` (fail the affected Host closed, `decisions.rs:99-125`); duplicate keys → `LEGACY_SHELL_DECISIONS_AMBIGUOUS` + fail closed (`decisions.rs:111-115`); corrupt identity file → boot failure with repairable diagnostic (spec `host-operation-lifecycle.md` §4 last row).

### 3.3 Core data dir contents (where the catalog file lands)

`serverConfig.dataDir` (from `bootstrapCore(process.env)`, `packages/core/src/main.ts:84-86`) already hosts sibling flat-file state: `host-identity.json` (`main.ts:86`), `devices.json` (`main.ts:159`), `mcp-servers.json` (`main.ts:184`), `mcp-approvals.json` (`main.ts:180`), `skills-state.json` (`main.ts:173`). The encrypted catalog (e.g. `<dataDir>/secret-catalog.bin`) joins this family; permissions `0700` dir / `0600` file per frozen research §5.3.

## 4. Spike verification plan

### 4.1 Wrapper recommendation: `libsodium-wrappers` (0.8.4)

**Recommendation: `libsodium-wrappers@0.8.4`** (with its single transitive dep `libsodium@^0.8.0`).

Evidence:

1. Frozen research already selected it: official jedisct1/libsodium.js wrapper, Wasm/pure-JS, `crypto_secretstream_xchacha20poly1305` documented for authenticated file encryption, detects truncation/reordering/duplication/modification (`vps-secret-backend-options.md` §5.3).
2. npm registry (fetched 2026-08-16): latest `0.8.4` published 2026-04-19; ISC license; single dependency `libsodium ^0.8.0`; dual CJS (`dist/modules/libsodium-wrappers.js`) + ESM (`dist/modules-esm/libsodium-wrappers.mjs`) with an `exports` map; **bundled TypeScript declarations** (`dist/modules/libsodium-wrappers.d.ts` + `.d.mts`); `sideEffects: false`.
3. Repo fit: root `package.json` pins `node >= 24` + `pnpm >= 10`; Core runs TypeScript in-place via Node's type stripping with **no bundler** (`packages/core/package.json:8-9`, `docs/devlog/manual-checks.md` bare `node src/main.ts`) — a Wasm/JS package with bundled `.d.ts` requires zero toolchain change on Windows dev, Linux VPS, and CI, and behaves identically everywhere.
4. Why not `sodium-native`: latest `sodium-native@5.1.0` has moved to the Holepunch **Bare** runtime model — registry metadata shows `engines: {"bare": ">=1.16.0"}`, dependencies `require-addon`/`bare-assert`/`which-runtime`, no install script, and **no Node engines declaration** (fetched 2026-08-16). Whether 5.x loads on stock Node 24 is unverified; staying on it means pinning the older 4.x Node-native line (node-gyp-build/prebuildify, per its 2.x–4.x metadata), which reintroduces native build/prebuild matrix risk on Windows dev + Linux deploy for zero MVP benefit (the catalog is tiny; Wasm throughput is irrelevant). Native also complicates any future packaged-Core distribution.
5. Size: standard wrapper ≈ 290 KB min+gz (frozen research §5.3) — acceptable for a Node server package.

The dependency addition is pre-authorized conditionally (PRD Dependencies + `docs/ZCODE-HANDOFF.md` §3.3: "explicitly allowed new dependencies … update lockfiles, document the reason, check platform packaging, and verify the merged result").

### 4.2 Exact spike commands (run from repo root `H:\TakiAgent-worktrees\t4`)

```bash
# 1. add + lockfile
pnpm --filter @taki/core add libsodium-wrappers@0.8.4

# 2. types resolve with no tsconfig change
pnpm --filter @taki/core exec tsc --noEmit

# 3. Node 24 runtime smoke (Windows Git Bash; uses Core's ESM + TS-strip runtime style)
cd packages/core && node --input-type=module -e "
import sodium from 'libsodium-wrappers';
await sodium.ready;
const key = sodium.crypto_secretstream_xchacha20poly1305_keygen();
const { header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
let s = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
const c1 = sodium.crypto_secretstream_xchacha20poly1305_push(s.state, new Uint8Array([1,2,3]), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
const c2 = sodium.crypto_secretstream_xchacha20poly1305_push(s.state, new Uint8Array([4]), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
s = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
const p1 = sodium.crypto_secretstream_xchacha20poly1305_pull(s.state, c1, null);
const p2 = sodium.crypto_secretstream_xchacha20poly1305_pull(s.state, c2, null);
console.log('ok', Buffer.from(p1.message).toString(), Buffer.from(p2.message).toString());
"

# 4. full gates after wiring tests
pnpm -r typecheck && pnpm lint && pnpm -r test

# 5. Linux side (deploy target or WSL): repeat step 3 under Node 24; Rust side untouched:
cd apps/desktop/src-tauri && cargo build --bin taki-node   # proves no Rust impact

# 6. Windows packaging check: desktop build unaffected (Shell does not import the core package)
pnpm desktop:build
```

### 4.3 Wrong-key / tamper / truncation / crash test shapes (vitest, `packages/core`)

All of these are pure unit tests around the envelope module plus an fs-backed temp-dir test (mirroring `host-identity.test.ts` style):

1. **Wrong key**: seal with key A, `init_pull` with key B → first `pull` throws; the on-disk file bytes must be byte-identical before/after the failed open (no rewrite).
2. **Tamper**: flip one byte in a ciphertext chunk → `pull` throws; assert file unchanged and error is a sanitized category (no partial plaintext returned).
3. **Truncation**: drop the final `TAG_FINAL` chunk (and separately: cut the last chunk mid-bytes) → open fails on missing final tag; no rewrite.
4. **Reorder/duplicate**: swap two message chunks / duplicate a chunk → rejected (secretstream guarantees; pin it with a test anyway).
5. **Crash between candidate write and publish**: staged `<catalog>.<pid>.<uuid>.tmp` exists while the active file is untouched → active catalog still opens; stale staging files are ignored/cleaned. Crash after `rename` → new generation complete (atomic replace yields old-or-new, never half).
6. **Envelope version/store identity**: an envelope with an unsupported `version` field or a mismatched store-id AAD → rejected without rewrite (frozen research §5.3: bind schema/store identity as additional data).
7. **Concurrent open** (create-only race): two processes create simultaneously → `EEXIST` loser reads the winner, mirroring `host-identity.ts:44-47`.

### 4.4 Windows Credential Manager helper: separate binary vs in-process

Constraint discovered in live code: **Core is today an operator-launched Node process, separate from the Tauri Shell** (`docs/devlog/manual-checks.md:20` runs Core with bare `node`; `apps/desktop/src-tauri/src/lib.rs` only builds the Shell's own Node — no Core sidecar exists). The Tauri app is therefore NOT guaranteed to be running when Core boots.

- **Option A (recommended): a small release-safe Rust helper binary in the existing Tauri crate** (a new `[[bin]]` beside `taki-node` in `apps/desktop/src-tauri/Cargo.toml:17-19`), reusing the shipped `keyring = "4.1"` (`Cargo.toml:43`). Core spawns it on boot (master-key bytes over stdout with length-prefixed binary framing), and the operator provisioning flow uses it to write/rotate the versioned credential (account names like `secret-catalog-master-key-v1` under service `TakiAgent`, extending the existing `node-token`/`device-id` convention at `secrets.rs:11`). Both processes run as the same interactive user, so the current-token credential-set semantics (Microsoft docs, frozen research §5.1) hold. Tradeoffs: one more artifact to ship; one process spawn per Core boot; the helper must NOT copy the `#[cfg(not(debug_assertions))]` refusal gate of `taki-node.rs:49-54` (that bin is debug-only because of its approver bypass; a credential helper has no such bypass and must ship in release).
- **Option B (rejected): Tauri IPC from the Shell process** — couples Core boot to an open Home window and gives VPS-mode Core no path; the frozen research explicitly forbids routing reads through a peer Desktop UI (§1, §5.1 limitation 1).
- **Option C (rejected): a Node-native keyring package** — `keytar` is archived; no maintained Node 24 cross-platform keyring package was verified (frozen research §5.1 limitation 2 / Caveats).

Linux side needs no helper: the master key arrives via `systemd LoadCredentialEncrypted=` and is read from `$CREDENTIALS_DIRECTORY` (frozen research §5.2); assert systemd >= 250 (256 for user-scoped encryption) during packaging preflight (frozen research §9).

## 5. Testing seams

### 5.1 `e2e/src/fixture/with-stack.ts` capabilities

- `StackOptions` (`with-stack.ts:28-48`): `provider`, `startNode`, `devTrigger`, `execPolicy`/`gateDecisions` pre-boot seeding, `seedTimeline`/`seedMemory`, `nodeWsRelay` (a test-only relay with an armable next-request mutator — directly reusable for corrupting/truncating a Core→Node secret frame in a process-level test).
- `Stack` helpers (`with-stack.ts:61-90`): `startNode(feedPairing)`/`killNode()` for **Node restart smoke** (`:254-259`), memoized paired `operator()` socket (`:222-235`), `setPermissionLevel` (generation-matched mutation driver, `:263`), `l1()` dev capability trigger (`:261-262`), `waitForCoreLog`/`countCoreLog` for asserting sanitized log lines (`:249-253`), `timeline()`, `audit()`.
- Core restart is NOT currently supported by the fixture (Core is spawned once at `with-stack.ts:157`); a catalog restart-survival e2e needs either a small fixture extension (kill/spawn core preserving `coreDataDir`) or stays at the vitest fs level. UNVERIFIED: no existing core-restart helper anywhere in `e2e/`.
- Drivers live in `e2e/src/fixture/operator-drivers.ts` (`pairOperator`, `setPermissionLevel`, `triggerCapability`, `sayToAgent`, imported at `with-stack.ts:13`).

### 5.2 Core operator-method test harness (the pattern for secret method tests)

`packages/core/src/server/methods/permission-methods.test.ts:16-30`: build an in-memory SQLite (`openDatabase(":memory:", MIGRATIONS)`), `createMethodRegistry()`, register the methods under test, fabricate a `Connection` (`{ state: { status: "authenticated", deviceId, role, capabilities } }`) plus a no-op `MethodContext`, and drive everything through `registry.dispatch({ jsonrpc, id, method, params }, ctx)` — including role-denial cases by passing `role: "node"`.

### 5.3 Rust test layout

Inline `#[cfg(test)] mod tests` at the bottom of each module (19 modules, e.g. `host_session.rs:313`, `gate.rs:335`, `secrets.rs:94`); `tempfile = "3"` is the dev-dependency (`Cargo.toml:57-58`); repo convention: production source-scan tests split at `"\nmod tests"` (`gate.rs:875-876`) — keep test-only helpers below `mod tests`. Shared wire truth is pinned by golden fixtures in `packages/shared/src/protocol-fixtures.test.ts` (spec `host-operation-lifecycle.md` §6).

### 5.4 Full gate set

Per `permission-authorization.md` §6: `pnpm -r typecheck`, root `pnpm lint`, `pnpm -r test`, full E2E, Rust tests, Clippy `-D warnings`, locked `taki-node` build, `git diff --check`.

## 6. Risk register

1. **Plaintext migration order** — today's only secret value channel into MCP is `mcp-servers.json` `env`/`headers` (`mcp-config.ts:14,23`) plus bootstrap `.env.local` (`TAKI_PROVIDER_API_KEY`). Migration must: keep the server disabled/error-visible on partial failure, and never delete the plaintext source until encrypted write + internal read/use verification succeeds (PRD AC4; frozen research §8 last row). Also `.env.local` remains a live plaintext source — do not remove it as part of this task's migration claims.
2. **Offline Host semantics** — `whenHostOffline` defaults to `fail`, no queue (`host-operation-lifecycle.md` §2/§4: "Host is offline and handling is omitted or `fail` → `failed` + `host_offline`; no queue is created"). A `secret.set` targeting an offline owning Host must fail closed immediately; nothing may buffer secrets for later delivery (buffering would itself become an unauthorized secret store).
3. **Secret-echo surfaces to audit** (PRD AC1):
   - `method-registry.ts:113-121`: INVALID_PARAMS responses include zod `issues` — the secret schema must be shaped so issues never embed the value (plain `z.string()` field errors carry path/message, but any `superRefine`/transform must not interpolate it).
   - `method-registry.ts:100-103`: uncaught handler errors become `INTERNAL_ERROR` with `error.message` verbatim — the secret handlers must convert storage failures to sanitized app exceptions (`appException`, as `permission-methods.ts:92-100` does) before they reach this boundary.
   - `ws-server.ts:91`: only the method name is logged for notifications; keep params out of any new server-side request logging (frozen research §4: the write request must be excluded from request logging and durable request history).
   - Config read-back: keep the `secretSet` presence-only contract (`.trellis/spec/backend/config-store.md` §3) — secret rows must never gain a value-returning path as part of catalog work.
   - Sanitized MCP fingerprint: `mcpPublicConfig` (`mcp-config.ts:38-41`) already excludes env/headers; when stable secret references move into config, they must not leak presence-irrelevant material into the subject revision.
   - CLI echo: one-shot `--call secret.set --params '{"value":"..."}'` (`apps/cli/src/main.ts:30,93`) puts the secret into shell history and the process list; the CLI surface for secret writes should read the value from stdin (like `askOnce`) rather than argv, or document the limitation.
   - Timeline/log precedent: migration `016-timeline-input-scrub` (`permission-authorization.md` Slice 4 notes) is the existing scrub pattern if any secret-bearing frame ever touches persisted input.
4. **Windows account model must be frozen** — Credential Manager entries are bound to the current token's logon session (frozen research §5.1); a Core later run as a Windows service/different account would not see interactive-user credentials. The all-local user-process model must be stated before the helper is built (frozen research Caveats; UNVERIFIED for service accounts).
5. **Never initialize over existing ciphertext** — mirror `host-identity.ts` (unreadable/malformed → throw, no mint-over) and the Rust identity tests (`node.rs:236-258`); missing key + existing catalog = `secret-store-locked` report, not a fresh store (frozen research §7 provisioning step 4).
6. **fsync discipline** — the Rust `write_atomic` (`decisions.rs:127-134`) skips fsync; do not copy it for the catalog. Use the staged-write + fsync + atomic-rename (+ directory fsync where supported) sequence from frozen research §5.3 and `host-identity.ts:54-68`.
7. **Role widening** — secret methods are `roles: ["operator"]` only; the agent/MCP tool registry has no path to them (frozen research §4; `permission-authorization.md` agent-inert posture). The single enforcement point is the dispatch role gate (`method-registry.ts:92-94`).
8. **Dependency/packaging gate** — lockfile update + documented reason + Windows/Linux packaging smoke are pre-authorized conditions (PRD Dependencies; `docs/ZCODE-HANDOFF.md` §3.3). The 4.2 command list is the smoke.

## Caveats / Not Found (UNVERIFIED)

- No production TypeScript secret backend exists today (confirmed: `packages/core/package.json:13-24` has no crypto/keyring dependency) — every statement above about the catalog itself is design guidance from the frozen research, not existing code.
- `sodium-native@5.1.0` runtime behavior on stock Node 24 was NOT tested (metadata only: `engines.bare`, `require-addon`, no install script, no Node engines field). This is negative-selection evidence, not a claim that it fails.
- Whether a future packaged Core (sidecar) would need to bundle `node_modules/libsodium*` Wasm assets is unanswerable today: no Core sidecar/packaging exists in the repo (no `sidecar` in `tauri.conf.json`; Core is operator-launched).
- Windows Credential Manager behavior for service-account Cores is unverified (primary docs tie credentials to the interactive token; frozen research records the same gap).
- Minimum Ubuntu/systemd version for `LoadCredentialEncrypted=` is not frozen anywhere in the repo (frozen research §9 records systemd 250 / user-scope 256; deployment baseline TBD).
- No core-restart helper exists in `e2e/src/fixture/with-stack.ts` (Core spawned once at `:157`); restart-survival e2e needs a fixture extension or stays unit-level.
