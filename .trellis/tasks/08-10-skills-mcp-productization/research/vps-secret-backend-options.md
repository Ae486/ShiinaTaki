# Research: Host-Bound Secret Backend Options for VPS and Local Execution Hosts

- Query: Which secure, writable secret-store architecture should each TakiAgent Execution Host use on Linux/VPS and
  Windows while preserving Core's global authority, operator-mediated runtime write/clear, restart recovery, no secret
  return over ordinary APIs, practical recovery, and open-source/self-hosted deployment?
- Scope: mixed
- Date: 2026-08-10

## Findings

### 1. Decision summary

Use a backend-neutral host-local `SecretStore` owned by the Execution Host that owns the MCP client or capability. The
MVP default should be an encrypted catalog local to that host, whose master key is supplied from outside that catalog:

- On a Linux/VPS Execution Host, pass only the catalog master key through `LoadCredentialEncrypted=`. The encrypted
  catalog remains writable by the host process at runtime.
- On a Windows Execution Host, keep only the catalog master key in Windows Credential Manager, reached by a host-local
  native adapter/helper. Do not route reads through a peer Desktop UI, Core, or remote Node.
- Encrypt the catalog with a reviewed high-level primitive from the official `libsodium.js` wrapper, not a Taki-designed cipher. `crypto_secretstream_xchacha20poly1305` is explicitly intended for authenticated file encryption and detects truncation, reordering, duplication, modification, and incomplete finalization.
- Keep an OpenBao provider as an optional managed/enterprise deployment profile. It is self-hostable, MPL-2.0, offers policy, audit, versioned KV, machine authentication, and Raft snapshots, but adds a service, TLS, unseal/bootstrap, token-renewal, backup, and availability obligations that are disproportionate for the personal MVP.
- Do not make Secret Service/gnome-keyring the default for headless Linux. The standard is explicitly a service in a user's login session and permits interactive unlock prompts. A system service has neither a guaranteed session bus nor an unlocked collection.
- Do not use systemd credentials as the writable store. They are secure bootstrap delivery, but systemd documents them as immutable during service runtime and acquired again only at activation.

This resolves the locality design blocker without treating a plaintext `0600` config or environment file as equivalent
security. File permissions remain defense in depth around encrypted data; environment variables remain
compatibility/bootstrap inputs only. Core still owns the registry, policy, and operator API, but it receives only
non-secret host metadata over host control.

### 2. Constraints already fixed by this repository

The local architecture narrows the answer substantially:

- Core and its DB/Workspace/MCP clients colocate in both topologies. In VPS mode the desktop can be offline while Core-side chat, memory, heartbeat, and MCP/network tools remain available (`docs/TECH-STACK.md:77-81`; `docs/adr/0007-capability-data-locality-split-machine.md:3-13`). Therefore a desktop-hosted credential broker cannot be authoritative.
- MCP configuration is operator-controlled, not model-controlled, and ADR 0006 already requires secret-marked env/header values to stay out of config (`docs/adr/0006-mcp-processes-vs-no-os-invariant.md:3-7`).
- The Core config plane explicitly is not a secret store. Secret rows expose presence only and values never enter logs (`.trellis/spec/backend/config-store.md:1-5,73-95,123-126`).
- Existing Rust `SecretStore` has exactly the useful semantic shape: missing is `Ok(None)` and `get/set/delete` are separate operations (`apps/desktop/src-tauri/src/secrets.rs:10-18,41-58`). Its actual `KeyringStore`, however, belongs to the Windows Node/Shell and cannot become a VPS Core dependency.
- The only file-backed secret implementation in live source is intentionally a debug-only plaintext harness store and explicitly never ships (`apps/desktop/src-tauri/src/bin/taki-node.rs:110-153`). It is test prior art, not a production backend.
- The current planning research already fixes write-only `secret.set`, idempotent `secret.clear`, presence/provenance metadata, stable secret references, just-in-time resolution, and no value in config/WS/log/cache/error surfaces (`.trellis/tasks/08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md:206-236`).

The host-local `SecretStore` abstraction is therefore not optional indirection. It is what prevents protocol and MCP
lifecycle code from depending on a particular OS keyring, Linux file paths, or an online peer host.

### 3. Threat model

#### In scope

The selected design should protect against:

- Theft or accidental publication of the Core data directory, ordinary backups, public MCP config, logs, diagnostics, crash reports, analytics, and UI caches.
- Another unprivileged local account reading the store or bootstrap material.
- A compromised or stale operator UI reading secrets back through list/status/config methods.
- The agent or an MCP tool invoking secret-management mutations. Set, clear, provider selection, recovery, and export remain operator/admin actions.
- Partial writes, process crashes during update, wrong keys, truncated/corrupt ciphertext, and failed MCP reconnects causing silent credential loss.
- Over-broad child environments. A stdio MCP child receives only the declared resolved variables, not the complete Core environment, matching the useful Hermes orchestrator boundary (`references/hermes-agent-main/website/docs/developer-guide/secret-source-plugin.md:15-27,91-116`).

#### Out of scope, but must be stated

No local secret store can protect a value from:

- Root/Administrator, arbitrary code execution as the Core service account, debugger/process-memory access, or a compromised Core binary.
- The destination MCP server/provider after Core legitimately supplies the credential.
- A malicious stdio MCP server that receives its configured environment secret.
- Upstream credential misuse after a local `clear`. Local deletion does not revoke an API key at its issuer.
- Historical copies in filesystem snapshots or backups. Logical deletion and retention policy are achievable; guaranteed forensic erasure on SSD/copy-on-write storage is not.

OpenBao states the same practical boundary: memory analysis, malicious host code, compromised clients, and arbitrary storage-backend control are outside its threat model, even though it protects storage confidentiality/integrity (`https://openbao.org/docs/internals/security/`, Version 2.6.x).

### 4. Required public and internal contract

The ordinary operator API should be intentionally asymmetric:

| Operation | Ordinary operator API result | Secret value allowed in result? |
| --- | --- | --- |
| `secret.set(fieldId, value)` | success/failure, `present: true`, sanitized backend/error category | No |
| `secret.clear(fieldId)` | idempotent success/failure, `present: false` | No |
| `secret.presence/list` | stable field id, presence, provider/provenance, last update time, health | No |
| MCP list/status/test/reconnect | configured/missing/rejected/unavailable classification | No |

The write request necessarily contains the new value. Its schema must be operator-role only, excluded from request logging and durable request history, and protected by loopback or the VPS transport security selected for the deployment. The handler must not echo the input in validation errors.

Internally, Core needs a non-WS resolver used only by connection/provider code. A defensible interface is conceptually:

```typescript
interface SecretStore {
  has(ref: SecretRef): Promise<boolean>;
  set(ref: SecretRef, value: Uint8Array): Promise<void>;
  clear(ref: SecretRef): Promise<void>;
  resolveForUse(refs: readonly SecretRef[]): Promise<ResolvedSecretLease>;
}
```

`ResolvedSecretLease` is an in-process lifetime boundary, not a serializable DTO. It should expose only the requested fields, support best-effort zeroing after candidate construction, and never be registered as a JSON-RPC result. JavaScript cannot guarantee that every engine copy is wiped, so this reduces lifetime but is not a memory-protection claim.

Public MCP config stores stable opaque references such as a server-id/field-id mapping, never a keyring account, filesystem path, provider token, or secret value. Editing public config preserves references unless clear was explicit.

### 5. Option comparison

| Option | Headless Linux/VPS | Runtime write/clear | Restart recovery | Backup/rotation | Packaging and operations | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Windows Credential Manager / Linux Secret Service directly | Windows: yes for a Core running as the same interactive user. Linux: conditional on a D-Bus user session, a Secret Service implementation, and an unlocked collection | API supports create/update/delete once service is available and unlocked | Windows: yes for same user/token context. Linux: may prompt or remain locked after unattended restart | Platform-specific; entries are not naturally bundled with Core backup; Linux collection backup/unlock is implementation-specific | Native bridge plus Windows helper; Linux libsecret/D-Bus/daemon/PAM/session integration | Keep Windows as a bootstrap/direct adapter. Do not use Secret Service as the VPS default. |
| systemd credentials as the secret store | Excellent headless bootstrap on supported systemd | No. Credentials are immutable for the service lifetime | Yes after service activation/restart | Operator can replace encrypted credential and restart; TPM/host binding complicates cross-host recovery | No Node package; requires systemd baseline and deployment tooling | Use only for the master/bootstrap key, not application-secret CRUD. |
| Encrypted local catalog plus external master key | Yes | Yes, because Core writes ciphertext catalog independently of immutable bootstrap key | Yes if catalog and matching master key are available | Straightforward encrypted backup; app-secret rotation is a normal set; master-key rotation needs staged dual-key procedure | One new reviewed crypto wrapper plus atomic-file code and per-OS key bootstrap | Recommended MVP default. |
| OpenBao KV v2 adapter | Yes, if locally deployed or reachable over TLS and unsealed | Yes, with ACL-controlled write/delete/destroy | Yes after machine re-authentication | KV versions/CAS, Raft snapshot save/restore, policy/audit; bootstrap credentials and unseal/recovery keys need separate handling | Separate service, TLS, storage, unseal, AppRole/token renewal, audit and monitoring | Optional managed/enterprise provider; not the personal MVP default. |
| Infisical adapter | Yes; documented self-hosting includes Docker, Kubernetes, VM/Linux package and air-gapped deployments | Yes through its API/SDK | Yes after Universal Auth machine login | Product advertises versioning, recovery, and rotation | Separate service; some controls are paid in self-hosted editions | Potential later provider. Exact license/feature boundary was not verified enough to select it over OpenBao. |

#### 5.1 OS keyring and Secret Service feasibility

Windows Credential Manager is a good same-host primitive. Microsoft documents that `CredWriteW` creates or replaces a credential in the current user's credential set and associates it with the current token's logon session. `CRED_TYPE_GENERIC` is stored securely, and persistence is explicitly represented by the credential record. This matches the existing Rust `keyring` 4.1 use (`apps/desktop/src-tauri/Cargo.toml:40`; `apps/desktop/src-tauri/src/secrets.rs:20-58`).

There are two limitations for Core:

1. The current Rust store is in the Shell/Node process. Reusing its interface does not authorize a remote desktop round
   trip. A local adapter must access Credential Manager on the same Windows Execution Host even when no Home window is
   open.
2. The archived Node `keytar` package is not an acceptable new Node 24 foundation. Its own repository is archived, and
   its Linux build requires libsecret development packages. No current maintained Node 24 cross-platform keyring
   package was verified in this research. Reusing the already-shipped Rust `keyring` crate through a minimal helper on
   the owning Windows host is the most grounded path, subject to a packaging/security spike.

Linux Secret Service is materially different from Windows Credential Manager for this deployment. The freedesktop specification says the service runs in the user's login session. Collections/items may be locked, and create/modify/read can require a prompt. Lookup attributes are not secret and may be unencrypted. GNOME's daemon guidance ties normal start/unlock to PAM and desktop session startup; without PAM start, the user may need to provide an unlock password on first use.

It can work for a Linux desktop or a deliberately provisioned lingering user service, but making it reliable on a headless VPS means owning:

- a user D-Bus session and Secret Service daemon lifecycle;
- creation and selection of the collection;
- non-interactive unlock at boot;
- behavior when the collection locks later;
- implementation-specific backup and recovery;
- distro packages and native bindings.

Injecting an unlock password to make this unattended merely creates another bootstrap-secret problem. Therefore Secret Service should be an opt-in adapter after an integration test on a named distro/service implementation, not the supported VPS default.

#### 5.2 systemd credential feasibility and runtime-write limit

systemd credentials are a strong answer to secret-zero delivery, not to a mutable database:

- They are acquired at service activation and released on deactivation.
- They are immutable during service runtime.
- The service reads them as files beneath `$CREDENTIALS_DIRECTORY`; access is restricted to the service user and credentials can be placed on non-swappable `ramfs`.
- `LoadCredentialEncrypted=` decrypts/authenticates the value at activation. `systemd-creds encrypt` can bind encrypted data to a TPM2 key, `/var/lib/systemd/credential.secret`, or both, using AES-256-GCM.
- The documented total size limit is 1 MiB per service. Size is not the blocker here; immutability is.

Consequently, replacing an application API key through Home cannot mutate the credential visible to the running Core. Updating an encrypted credential file requires deployment tooling plus service restart, and a service account normally should not have the privilege to replace its own unit credentials or host credential key.

Recommended use: one 32-byte catalog master key named for its purpose. Core loads it at boot, writes application secrets to its encrypted catalog at runtime, and zeroes its original read buffer after initializing the store. Keep service hardening (`PrivateMounts=` or stronger filesystem namespacing) so another service cannot see the runtime credential directory.

Cross-host recovery requires planning. TPM/host-key binding intentionally makes copied ciphertext insufficient on a new host. The operator should retain the original catalog master key in an offline password manager/recovery process, then re-encrypt that same key with `systemd-creds` on the replacement host. Backing up only the systemd-encrypted credential and catalog can make disaster recovery impossible.

#### 5.3 Encrypted local catalog with a proven library

The catalog should use `libsodium-wrappers`, the official WebAssembly/pure-JavaScript wrapper for libsodium. The official README lists Node.js support, prebuilt CommonJS/ESM distributions, and a `crypto_secretstream_xchacha20poly1305` example. The standard wrapper is about 290 KB minified/gzipped and avoids a native Node build. The high-level secretstream API was introduced in libsodium 1.0.14 and is documented specifically for authenticated streams and file encryption.

This is not permission to invent cryptography:

- Use the documented key generator/key size, header, `push/pull`, and `TAG_FINAL` behavior exactly.
- Store a minimal, versioned envelope containing public format/key identifiers plus the secretstream header and ciphertext. Do not design a new cipher, nonce schedule, KDF, or MAC.
- Use a randomly generated binary master key. Do not turn a human password directly into an encryption key. If password-derived recovery is later required, use libsodium's documented password-hashing API in a separately reviewed design.
- Authenticate the catalog schema/store identity as additional data or within the encrypted payload so ciphertext cannot be silently repurposed between stores.
- Reject wrong key, invalid header, authentication failure, missing final tag, duplicate ids, and unsupported versions without rewriting the file.
- Serialize writes under one Core mutex. Write a candidate in the same directory, fsync it, atomically replace the active file, and fsync the directory where supported. Preserve the last known good in memory until publication succeeds.
- Keep parent directory permissions restrictive (`0700`) and the encrypted file `0600`. Encryption protects backups/snapshots; permissions reduce local exposure and tampering.

For the expected small secret count, encrypting one catalog is simpler and safer than maintaining a custom encrypted record database. It also produces one atomic backup artifact. The tradeoff is whole-file rewrite per set/clear, which is negligible at this scale.

The encrypted catalog does not eliminate a bootstrap key. It reduces the bootstrap surface from every provider/MCP secret to one random master key that each platform can deliver well. The catalog and master key must never be stored together in the same unprotected backup.

#### 5.4 OpenBao and Infisical as external providers

OpenBao is the strongest verified optional provider for the stated open-source/self-hosted requirement:

- Repository license is Mozilla Public License 2.0 and the project states an OSI-approved open-source/community-governed intent.
- KV v2 stores arbitrary versioned secrets, supports check-and-set, configurable retained versions, soft delete, undelete, destroy, and metadata deletion.
- AppRole is designed for machines/services. RoleID plus secret SecretID obtains a renewable, policy-scoped token; SecretID can have TTL/use limits and CIDR constraints.
- The security barrier encrypts storage with AES-GCM; policy is default deny; audit devices can record API requests/responses with string values HMACed by default.
- Integrated Raft storage is documented as production ready. `bao operator raft snapshot save/restore` and `GET/POST /sys/storage/raft/snapshot` provide backup/restore primitives.

The Core adapter should use a narrow path policy for its own secret namespace. Its AppRole SecretID or agent token is still a bootstrap secret and belongs in systemd credentials on Linux or Windows Credential Manager on Windows. Core should renew short-lived tokens in memory and surface `auth-expired`, `sealed`, `unreachable`, and `permission-denied` separately without falling back to plaintext.

OpenBao changes the availability model. A local catalog survives with only Core and disk; OpenBao requires the server to be reachable and unsealed. A last-good in-memory value may keep an already-running client alive, but a restart or reconnect must fail closed if the provider cannot resolve the secret. Do not add an implicit plaintext or undeclared disk cache.

Infisical is viable provider prior art, not the recommendation frozen here. Its official docs verify self-hosting and Universal Auth with Client ID/Client Secret -> short-lived access token. They also state that some trusted-IP controls require an enterprise license for self-hosting. The GitHub repository's current license was reported as `Other` by the fetched metadata, and exact open-source vs enterprise feature boundaries were not audited. An Infisical provider should remain optional until licensing and required-feature checks are explicit.

HashiCorp Vault was not selected because the requirement asks for open-source/self-hosted deployment and current Vault licensing was not audited here. OpenBao provides the relevant Vault-compatible operational model under a verified MPL-2.0 repository license.

### 6. Recommended architecture

#### 6.1 Provider-neutral layers

Use four boundaries on every Execution Host, with Core coordinating registry and policy across them:

1. `SecretRegistry`: stable field ids, classification, provider binding, presence/provenance/error metadata. It contains no values.
2. `SecretStore`: internal set/clear/resolve contract with implementations selected per owning host.
3. `BootstrapKeySource`: Windows Credential Manager, systemd credential, or explicitly provisioned recovery input. This source supplies only a local catalog key or external-provider machine credential.
4. Operator methods: write-only set, clear, presence/status, and backend health. The Agent tool registry has no path to them.

MCP candidate construction asks the owning host's registry for only the referenced fields, resolves them immediately before
connect/spawn, passes only declared env/header values, then drops the lease. Core Approval, config, and status code see
references and state, never values.

#### 6.2 Owner-selectable deployment options

**Option A - Recommended MVP: encrypted local catalog on both OS families**

- Windows bootstrap: one versioned master-key credential in Windows Credential Manager through a host-local Rust
  helper/adapter.
- Linux bootstrap: one versioned master-key credential via `LoadCredentialEncrypted=` on the owning host.
- Data: encrypted catalog in the owning host's data directory using official libsodium secretstream.
- Benefits: identical semantics, runtime writes, restart recovery, host isolation, simple encrypted backup, no extra service.
- Cost: one new JS crypto dependency, a small reviewed envelope/atomic-write implementation, and a Windows helper seam.

**Option B - No local envelope: Windows Credential Manager plus OpenBao on VPS**

- Windows local Core stores each secret directly in Credential Manager.
- Linux/VPS requires operator-deployed OpenBao; no Secret Service support claim.
- Benefits: no Taki-managed encrypted file format and strong managed VPS controls.
- Cost: different backup/migration behavior per topology and OpenBao is mandatory for every VPS user. This is secure but heavier than the product's personal-MVP posture.

**Option C - Optional managed/enterprise profile: OpenBao everywhere**

- Both Windows and Linux Cores use one OpenBao adapter; only the machine bootstrap credential is OS-local.
- Benefits: central policy, audit, revocation, HA, versioning, and fleet operations.
- Cost: network/service dependency, operational ownership, and a secret-zero/unseal story. Keep it optional and do not block MVP on it.

Option A is the only recommendation that satisfies all requested MVP behavior without requiring a desktop login session or a second server. Option B is the conservative alternative if the owner rejects any application-managed encrypted envelope. Option C is for operators who already want a managed secrets service.

### 7. Operational UX and lifecycle

#### Initial provisioning

1. Generate a random master key with the chosen library/tooling.
2. Save a recovery copy outside the VPS/Core backup boundary in an operator-controlled password manager or offline recovery system.
3. Windows: store it under a versioned Credential Manager target. Linux: encrypt it with `systemd-creds` for the service credential name and configure `LoadCredentialEncrypted=`.
4. Start Core. If the key is absent/wrong, report `secret-store-locked`; do not create a replacement store over existing ciphertext.
5. The operator sets each application secret through the write-only surface. Presence updates only after durable store commit.

#### Application-secret set/rotation

`set` writes the new encrypted catalog atomically and makes it authoritative. MCP then builds a candidate generation with the new credential. Candidate success publishes the new generation; candidate failure retains the previous live client generation but status clearly reports that the stored current credential was rejected. This matches the already selected last-good MCP generation rule without maintaining two silent credential authorities.

Upstream rotation should be: create new upstream credential -> `secret.set` -> successful candidate/test -> revoke old upstream credential. Reversing that order creates avoidable downtime.

#### Clear

`clear` removes the value from the current catalog and publishes presence false. Future candidates must fail as `credential-missing`. An already-created MCP client/child may still hold the old value, so clear must also trigger disable/reconnect/drain according to the MCP generation contract. In-flight generation drain means the old secret can remain usable briefly; a security-emergency clear needs a named forced-close path plus upstream revocation.

#### Master-key rotation

Use versioned key ids and a two-key transition; never overwrite the only bootstrap key first.

1. Provision new key id alongside old.
2. Restart/reload bootstrap so Core can access both keys (systemd credentials themselves are immutable during the old process lifetime).
3. Decrypt current catalog with old, encrypt candidate with new, verify full read, atomically publish, and mark new key id.
4. Restart and verify recovery using new alone.
5. Remove old bootstrap credential and retire its recovery material according to policy.

On Windows the credential API is writable at runtime, but the same staged procedure protects against crash windows. On systemd, expect service restarts at key-rotation boundaries even though ordinary application-secret changes remain live.

#### Backup and restore

For Option A, back up public config/database plus the encrypted catalog. Keep the recovery master key in a separate trust domain. Restore into a quarantine path, verify decryption/schema/secret-reference coverage, then start consumers. A catalog backup without its recovery key is unrecoverable; a catalog plus leaked recovery key exposes every contained secret.

For OpenBao, use storage-native atomic backups. Integrated Raft exposes snapshot save/restore, but snapshots still require correct unseal/recovery material and tested restore procedures. Backups are not HA and restores can roll secret state backward; rotate/revoke externally if rollback could resurrect an old credential.

### 8. Failure modes and required behavior

| Failure | Required behavior |
| --- | --- |
| Master/bootstrap key missing | Store is locked; secret-dependent integrations unavailable; never initialize over existing catalog. |
| Wrong key or tampered/truncated ciphertext | Authentication failure; preserve bytes for diagnosis/recovery; no partial values and no rewrite. |
| Disk full, permission, fsync, or rename failure | `set/clear` fails with sanitized storage category; old durable catalog and presence remain authoritative. |
| Crash between candidate write and publish | Atomic replace yields old or new complete generation, never half JSON/ciphertext. |
| Secret set succeeds but MCP candidate rejects it | New stored secret remains authoritative; old live client may drain, status says configured credential rejected without echo. |
| Secret clear while a client is active | Block future resolves, trigger generation close/drain; disclose that upstream revocation is separate. |
| Secret Service locked/no D-Bus | Adapter unavailable; no prompt on headless startup and no fallback to plaintext. |
| systemd too old or credential absent | Packaging preflight fails before claiming secure persistence; explicit provisioning error. |
| OpenBao sealed/unreachable | Fail closed for new resolution; existing in-memory client may continue only under explicit lifecycle policy. |
| OpenBao token renewal/auth expires | Sanitize and classify; re-authenticate through machine flow; never log token/SecretID. |
| Backup restored with mismatched public refs | Quarantine/report orphan/missing refs; do not guess mappings or expose values. |
| Legacy plaintext MCP config migration partially fails | Keep server disabled/error-visible; do not delete the only plaintext source until encrypted write and internal read/use verification succeed. |

### 9. Dependency and packaging implications

- `libsodium-wrappers` is not currently declared in `packages/core/package.json`; adding it is a new dependency requiring owner confirmation. Its official distribution is WebAssembly/pure JS and supports Node, avoiding platform-native compilation. Exact package version, TypeScript declarations, bundler behavior, and Node 24 CI behavior still require an implementation spike.
- The existing Rust `keyring = "4.1"` dependency is shipped in the Tauri crate. Reuse for a Windows Core helper avoids adopting archived `keytar`, but the helper executable/protocol, account identity, installer lifecycle, and behavior when Core runs as a Windows service rather than the interactive user must be designed and tested.
- systemd service credentials were added in version 250; user-scoped credential encryption options appeared later (documented as version 256). The supported Ubuntu/VPS baseline must assert a sufficient systemd version or provide an explicit provisioning fallback. A plaintext fallback is degraded compatibility, not the same security tier.
- Secret Service would add D-Bus, daemon, unlock, and distro package requirements and is not part of the MVP packaging recommendation.
- OpenBao adds a server/agent binary or container, TLS, storage, unseal/bootstrap, ACL, token renewal, snapshot, audit, monitoring, and upgrade procedures. The Core can use its HTTP API; no TypeScript SDK was selected or verified.
- Infisical adds its self-hosted service and machine identity bootstrap. Its exact self-hosted license and which recovery/rotation controls are free must be reviewed before an adapter is advertised.

### 10. Local prior art: useful shape, insufficient security answer

Hermes 0.18.2 demonstrates a good provider-orchestrator split:

- Backends fetch; the central orchestrator owns precedence, conflict handling, protected bootstrap variables, timeouts, provenance, and applying values (`references/hermes-agent-main/website/docs/developer-guide/secret-source-plugin.md:15-27`).
- Startup fetch must never prompt, and child CLI environments are allowlisted rather than inheriting every credential (`references/hermes-agent-main/website/docs/developer-guide/secret-source-plugin.md:91-116`).
- Its contract is explicitly read-only, startup-only, and has no write-back or mid-session API (`references/hermes-agent-main/agent/secret_sources/base.py:1-28`).

Taki should borrow those ownership and error-isolation patterns. It cannot copy the storage result: Hermes documents the secret-manager bootstrap token in `.env`, and its source contract lacks runtime write/clear/reconnect (`references/hermes-agent-main/website/docs/user-guide/secrets/index.md:1-18`; `references/hermes-agent-main/hermes_cli/secrets_cli.py:156-178`).

## Files Found

- `docs/TECH-STACK.md` - Node 24 Core stack, Windows Credential Manager target, all-local/VPS topology, and the currently under-specified Linux file/env note.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` - operator-only MCP configuration and requirement that secret env/headers stay out of config.
- `docs/adr/0007-capability-data-locality-split-machine.md` - Core/data locality and the requirement that VPS Core remains useful while desktop Nodes are offline.
- `apps/desktop/src-tauri/src/secrets.rs` - current `get/set/delete` abstraction and Windows Credential Manager implementation, owned by the Node/Shell.
- `apps/desktop/src-tauri/src/bin/taki-node.rs` - debug-only plaintext `FileSecretStore`, explicitly non-shipping.
- `apps/desktop/src-tauri/Cargo.toml` - installed Rust `keyring` 4.1 dependency.
- `packages/core/package.json` - no Core secret/crypto/keyring provider dependency currently declared.
- `.trellis/spec/backend/config-store.md` - Core config is non-secret, masked presence only, and secret writes are refused.
- `.trellis/spec/backend/permission-authorization.md` - agent-inert operator-only policy mutation and fail-closed authorization precedent.
- `.trellis/spec/backend/server-push-and-connection-auth.md` - operator connection/auth boundary and remote-VPS fail-closed posture.
- `.trellis/spec/guides/source-grounding-guide.md` - dependency and external API claims must be sourced from installed artifacts or primary docs.
- `.trellis/tasks/08-10-skills-mcp-productization/prd.md` - secure credential lifecycle is an MVP gate and secret values must not return through ordinary APIs.
- `.trellis/tasks/08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md` - pre-4A locality
  baseline, current host-bound amendment, and write-only/presence-only API.
- `.trellis/tasks/08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md` - D0 credential dependency, migration ordering, and secret lifecycle test gaps.
- `references/hermes-agent-main/agent/secret_sources/base.py` - read-only startup secret-source contract and centralized orchestration boundary.
- `references/hermes-agent-main/website/docs/developer-guide/secret-source-plugin.md` - no-prompt startup, protected bootstrap variables, provenance, and child environment isolation.
- `references/hermes-agent-main/website/docs/user-guide/secrets/index.md` - external provider prior art and explicit `.env` bootstrap-token limitation.

## Code Patterns

- Minimal backend seam: `apps/desktop/src-tauri/src/secrets.rs:13-18` defines missing/get/set/delete without leaking storage details.
- Idempotent absence semantics: `apps/desktop/src-tauri/src/secrets.rs:41-58` maps missing get to `None` and missing delete to success.
- Test-only plaintext is visibly fenced: `apps/desktop/src-tauri/src/bin/taki-node.rs:110-153` uses `#[cfg(debug_assertions)]` and says it never ships.
- Core config masks secrets: `.trellis/spec/backend/config-store.md:73-95` returns presence only and prohibits values in logs.
- Agent cannot mutate authority: `.trellis/spec/backend/permission-authorization.md:102-120` restricts policy writes to the human/operator arm; secret mutation should use the same source-swept posture.
- Hermes centralizes sensitive orchestration: `references/hermes-agent-main/agent/secret_sources/base.py:9-34` keeps provider fetch separate from precedence/application and forbids prompting/raising.
- Hermes narrows child environments: `references/hermes-agent-main/website/docs/developer-guide/secret-source-plugin.md:114-116` passes only allowlisted auth variables and closes stdin.

## External References

- `https://specifications.freedesktop.org/secret-service/latest-single` - Secret Service API Draft; user login-session service, locked collections/items, prompting, D-Bus sessions, and non-secret lookup attributes. No numbered stable release was shown; accessed 2026-08-10.
- `https://wiki.gnome.org/Projects(2f)GnomeKeyring(2f)RunningDaemon.html` and `.../Pam.html` - archived GNOME operational notes tying normal daemon start/unlock to user login/PAM and first-use prompts. Archive status limits their authority for future implementations.
- `https://systemd.io/CREDENTIALS/` - systemd service credential model: activation lifetime, runtime immutability, `$CREDENTIALS_DIRECTORY`, access restrictions, ramfs, 1 MiB limit, and encrypted credential settings.
- `https://www.freedesktop.org/software/systemd/man/latest/systemd-creds.html` - `systemd-creds` encryption/bootstrap details; host key/TPM binding, AES-256-GCM, and directives added from systemd 250 onward.
- `https://doc.libsodium.org/secret-key_cryptography/secretstream` - high-level authenticated stream/file encryption, final tags, tamper/truncation detection, and API introduction in libsodium 1.0.14.
- `https://github.com/jedisct1/libsodium.js/blob/master/README.md` and `API.md` - official JS/Wasm wrapper, Node support, package/distribution shape, readiness contract, and secretstream wrapper calls.
- `https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew` and `.../ns-wincred-credentialw` - Windows current-token credential set, create/replace semantics, generic credential security, and persistence fields.
- `https://github.com/atom/node-keytar` - archived MIT Node keychain package; Windows Credential Vault/Linux libsecret behavior and Linux native dependency. Used as negative dependency evidence.
- `https://github.com/openbao/openbao` - OpenBao repository, MPL-2.0, self-hosted open-source secret manager.
- `https://openbao.org/docs/secrets/kv/kv-v2/` - Version 2.6.x KV v2 versioning, CAS, delete/destroy, retention, and arbitrary secret operations.
- `https://openbao.org/docs/auth/approle/` - Version 2.6.x machine/service authentication, SecretID handling, TTL/use/CIDR constraints, and renewable tokens.
- `https://openbao.org/docs/internals/security/` and `https://openbao.org/docs/audit/` - Version 2.6.x threat model, storage barrier, policies, and audit behavior.
- `https://openbao.org/docs/configuration/storage/raft/`, `https://openbao.org/docs/commands/operator/raft`, and `https://openbao.org/api-docs/system/storage/raft` - integrated storage and snapshot save/restore operations (fetched pages reported 2.5.x/2.6.x).
- `https://infisical.com/docs/self-hosting/overview` and `https://infisical.com/docs/documentation/platform/identities/universal-auth` - self-hosted deployment modes and machine Client ID/Secret -> short-lived token flow, including paid self-hosted trusted-IP caveat.

## Related Specs

- `.trellis/spec/backend/config-store.md` - Core-owned config authority, secret exclusion, masked presence, and zero value logging.
- `.trellis/spec/backend/permission-authorization.md` - operator-only mutation, stricter-wins, and agent-inert control surfaces.
- `.trellis/spec/backend/server-push-and-connection-auth.md` - connection authentication and VPS/public-Core fail-closed behavior.
- `.trellis/spec/backend/error-handling.md` - backend failures must become stable, sanitized application errors rather than leaked exceptions.
- `.trellis/spec/backend/logging-guidelines.md` - secret values and sensitive request payloads must not enter logs.
- `.trellis/spec/backend/directory-structure.md` - new Core secret modules should have a narrow domain boundary and index maintenance during implementation.
- `.trellis/spec/guides/source-grounding-guide.md` - external/provider behavior and installed-version claims require direct evidence.

## Caveats / Not Found

- `.trellis/.current-task` still points to `.trellis/tasks/08-09-hindsight-compatibility-extensions`, not this planning task. It was not changed.
- No production TypeScript Core secret backend exists today. This file is a selection recommendation, not implementation evidence.
- No tests, builds, package installs, provider instances, D-Bus/keyring sessions, systemd units, or Windows Credential Manager writes were run.
- The exact `libsodium-wrappers` version, TypeScript declaration strategy, Node 24 behavior, and final package-size impact were not verified in this repository. A dependency/packaging spike is required before lock-in.
- The encrypted envelope/atomic replacement format needs focused security review and wrong-key/tamper/truncation/crash tests. Using libsodium avoids custom primitives; it does not make surrounding storage code automatically correct.
- No actively maintained Node 24 keyring package was verified. `keytar` is archived. The recommended Windows Rust helper is architecturally grounded by the existing `keyring` crate but is not implemented or packaged.
- Windows Credential Manager behavior for a Core installed as a Windows service account was not verified. The primary docs tie credentials to the current token/logon session; the all-local user-process account model must be frozen before implementation.
- Secret Service is a draft API with multiple implementations. GNOME operational pages used here are archived. No named Ubuntu release plus daemon/PAM/systemd-user configuration was tested.
- The minimum supported Ubuntu/systemd version is not frozen. `LoadCredentialEncrypted=` requires a sufficiently new systemd; user-scoped encryption is newer still.
- OpenBao TypeScript SDK choice was not verified; its HTTP API is the stable adapter fallback. Single-node unseal/auto-unseal, token renewal, audit device, and snapshot restore must be exercised before the provider is advertised.
- Infisical's exact repository license and free/self-hosted feature boundary were not fully verified, so it is not selected as the open-source default.
- Secure local clear cannot erase historical filesystem snapshots/backups or revoke upstream credentials. Product copy and runbooks must not claim otherwise.
- Master-key backup is a security/recovery tradeoff: no recovery copy can mean permanent loss; an exposed recovery copy defeats encrypted-catalog confidentiality. The operator procedure must make that explicit.
