# Research: Stage 5C / C1 implementation readiness

- Query: Review the proposed installed Hindsight Host, read-only Secret Catalog custody and fake-secret bootstrap; identify the minimum engineering resolutions and independent check gates before implementation.
- Scope: Internal source/design review; external runtime/version facts are limited to the supplied source-research reports. No network or environment execution.
- Date: 2026-10-07
- Active task supplied by the leader: `.trellis/tasks/10-07-hindsight-template-lifecycle` (B1 remains the production owner).
- Reviewed planning task: `.trellis/tasks/10-07-hindsight-managed-host-custody` (`prd.md`, `design.md`, `implement.md`).

## Findings

### Verdict and change boundary

The proposed direction is viable for implementation planning: reuse the existing TSC1 codec, retain Core as its sole writer, introduce a real release Host/helper, and use an authenticated Host operation rather than an operator receipt. The new C1 draft already incorporates the main earlier findings. **Readiness is conditional on freezing the concrete contracts below; this report is not an implementation or installed-platform PASS.** No additional product decision is needed for these engineering corrections.

Do not reopen the completed Stage 5B design review. Do not overlap its current Shared/Core/Native/migration owners. Recheck the relevant source interfaces after B1/B2 release them, because this review records the currently observed production seams, not a reserved future migration number.

| Priority | Remaining decision to freeze | Failure if omitted | Minimum resolution |
| --- | --- | --- | --- |
| P1 | Trusted invocation and accepted-result producer | Plausible JSON can acquire custody/deployment authority; Core and Host attempts can be confused. | Internal per-pending issued/accepted evidence and an explicit Core-to-Host ID map; only the gate supplies execution context. |
| P1 | One-owner catalog snapshot and final check | Same-millisecond change, restore ABA, or fresh disk bytes combined with stale cached metadata can admit the wrong credentials. | Core boot + private publication revision + owner-consistent sealed digest, checked at acceptance and fresh injection authorization. |
| P1 | Installed Windows execution boundary | Hash-then-spawn, writable parents, reparse points or Node preload variables can execute an unverified program. | External expected identity, actual handle/DACL/owner checks, held replacement guards and an allowlisted process environment. |
| P1 | Ubuntu release Host and credential custody | An operator CLI or a token alone gets mistaken for an authorized same-host executor. | Actual `role=node` enrollment, canonical Host gate, effective-UID registration and service-local protected credentials. |
| P2 | Offline JS/dependency closure | A development checkout passes while the installed helper cannot resolve TypeScript, sodium/Wasm or adapters. | Compiled ESM and a complete pinned installation tree tested without checkout/store access. |
| P2 | C1/C2 bootstrap evidence split | Process mocks are presented as Docker restart/confidentiality proof, or a persistent observer is left ownerless. | C1 owns protocol/process prototype and release Host lifetime; C2 owns real resource observer and mandatory isolated Docker proof before real delivery. |

### 1. Preserve authority through the real broker and executor

**Trigger and evidence.** `packages/core/src/server/methods/capability-respond.ts:22` obtains authenticated current Host provenance before calling the broker. `capabilities/capability-broker.ts:133` verifies the pending control and provenance; `capability-response.ts:19` rejects a wrong Host/generation/control, and `:45` reduces a successful response to `{ ok: true, output }`. That returned JSON does not retain its provenance. A protocol-level `{accepted:true}` is also not sufficient: `responseOutcome` can produce a governance denial from a terminal frame. The custody consumer must require an actually successful verified outcome.

`capabilities/route-capability.ts:39` has no `operationId` request field and forwards `attemptId` as `coreAttemptId` at `:93`. The broker creates a separate `requestId` at `capability-broker.ts:115`, defaults `operationId`, and always creates a new Host `attemptId` at `:167-173`. Rust `apps/desktop/src-tauri/src/capabilities_impl.rs:38` currently exposes `run(&Value)`, not trusted Host operation context.

`packages/core/src/memory/hindsight/hindsight-setup-service.ts:213-228` still parses `params.managedReceipt` and validates endpoint/time/image naming. `packages/shared/src/hindsight-setup-schema.ts:58-70` describes ordinary receipt JSON. Neither is an installed managed-resource producer.

**Recommended minimal API contract.** Exact names can follow local style; preserve these semantics:

1. Add an internal per-request broker observer/options path, such as `onIssued({requestId, control})` and `onAccepted({requestId, control, provenance, authorization, outcome})`, held on that pending entry. Register it before `notify`, never via append-only global listeners. Existing `request()` and ordinary output shapes keep their behavior. These callbacks are code-owned and never parsed from WS.
2. `onIssued` records the exact mapping `{coreOperationId, coreAttemptId, brokerOperationId, hostAttemptId, requestId, inputDigest}` in the live custody admission owner before external execution. Add explicit `operationId` routing only where needed; do not infer equality between Core and Host attempt IDs. A naming choice that deliberately reuses `operationId` must still record the separate `hostAttemptId`.
3. Mint accepted evidence only after terminal lineage/governance checks, current target/generation/policy validation and the original deadline check. Invoke at most once; timeout, cancellation, wrong control, duplicate and replay produce no successful custody evidence. The consumer performs its own final snapshot check before publishing custody acceptance. If persistence involves `await`, recheck after it at the final state transition; checking only before an asynchronous operation reintroduces a gap.
4. Treat evidence as an internal opaque handle or branded value backed by a Core-owned live admission record. A TypeScript cast or parsing the same JSON must not construct it. Persist only sanitized accepted evidence where recovery requires it; invalidate transient preparation on Core boot change.
5. Introduce a narrow `TrustedHostInvocationContext` at the Host executor boundary, after the actual permission gate has validated the issued request. A compatibility default `run_with_context(input, context) -> run(input)` can preserve existing capabilities. The custody executor consumes actual control/request identity; it never copies a purported trusted Host/user field from user input.
6. Windows Shell adds the verified local OS/install identity to the private helper envelope. Ubuntu supplies it from its release Host implementation. Helper output is decoded as an ordinary bounded result and wrapped with real broker evidence by Core; the helper cannot declare its own trust level.
7. C1 exposes diagnostic/custody status only. It cannot mint `ready` deployment receipts. Gate the old raw `managedReceipt` admission path so it cannot bypass the new boundary. C2 consumes a `receiptRef` looked up in a Core-owned accepted deployment ledger; it never accepts operator JSON as evidence. Preserve the existing-instance path independently. Historical recovery reads the previously accepted owner record, not re-parsed user receipt text.

The accepted Host is a trusted local executor; this protocol does not remotely attest the physical machine against a malicious credential-owning user. Its contribution is exact current provenance and ownership, not protection from a compromised admitted Host.

### 2. Snapshot the catalog through its owner, including restore ABA

**Trigger and evidence.** `packages/core/src/secrets/secret-catalog-service.ts:43,85` already exposes private `revision()`. `:143-151` increments it after successful publication, `:199-214` after rotation, and `:223-229` after restore. `:178-189` reads cached metadata. `backupOf` at `:218` combines current file bytes with the cached key/version state; it is not an owner-consistent admission snapshot API. `.trellis/spec/backend/secret-catalog.md:3-7` explicitly keeps revision process-local and outside public metadata. `hindsight-configuration-context.ts:60` already uses it privately.

Envelope digest detects different bytes but not `A -> B -> restore exact A`. Timestamps can repeat; key version need not change on set/clear. `catalog-publication.ts:17-43` publishes by staged write/fsync/link/rename, so a complete old open file is not necessarily the current registered file.

**Recommended API and invariants.** Add an owner-internal read-only capture/validate pair, e.g. `captureCustodySnapshot(fixedSelection)` and `validateCustodySnapshot(snapshot)`. The live admission owner stores:

```text
coreBootId, privateCatalogRevision, custodySnapshotId,
catalogStoreId, catalogKeyVersion, sealedEnvelopeSha256,
fixedSlotSelection, desiredConfigIdentity,
installationIdentity, executionHostId,
originalCoreAndHostAttemptMap, issuedGenerations, deadline
```

The service records the digest of the exact successfully loaded/published/restored envelope alongside cached plaintext state. Capture reads a bounded current envelope and requires it to match that owner-published identity before combining it with cached presence/provenance. Do not independently call `backup()` and `presence()` and assume they describe one state. Every successful writer path updates the owner identity; failed writes do not. Uncoordinated external replacement yields unavailable/stale, not an implicit reload or silent adoption.

The Host receives an opaque `custodySnapshotId`, store/key version, sealed digest and fixed selection as non-secret request context. Private revision stays Core-internal; do not extend `secret.set/presence/list`, historical connection fingerprints or public telemetry with it. `coreBootId` scopes both revisions and live nonce/admission state.

Read one complete envelope through a bounded read-only handle. Verify the registered path/handle identity before and after the read and recheck current registration at final acceptance. An old descriptor surviving an atomic rename does not grant permission to use old credentials. Do not hold a no-delete catalog lock across the whole operation, because that would prevent the legitimate Core writer's rename publication.

At final custody acceptance check the original boot/revision/digest/store/key/config/install/Host/policy/deadline tuple again. In C2, obtain fresh **non-secret** reauthorization from this owner before injection, using the existing authenticated Host channel; do not turn it into a secret retrieval service. Check again before accepting a deployment-ready result. Disconnection, Core reboot and exhausted deadline invalidate the old admission; a new request cannot silently upgrade the old attempt.

There is necessarily a bounded cross-process interval between last authorization and use. This contract prevents stale acceptance and blind reuse; it does not provide instantaneous revocation. An already running Native child keeps its old credentials until a later controlled restart/rebind. A catalog/key-source rotation mismatch is locked and must never trigger fallback to another key or catalog.

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

### 7. C1 and C2 ownership; bootstrap evidence cannot be deferred invisibly

Current Native source facts are detailed in `stage5c-custody-design.md`: `config.py:25-41` enables dotenv override; the lock and inspected python-dotenv 1.2.2 source support `PYTHON_DOTENV_DISABLED=true`; `start-all.sh:170-222` has the shutdown/cleanup behavior and `:228-245` directly starts Native. A new PID1 bootstrap changes those process and log relationships and therefore needs execution proof.

| Checkpoint | Owner and deliverable | Acceptance boundary |
| --- | --- | --- |
| C1a | One cohesive implementation owner: pure codec, compiled install tree, actual Windows/Ubuntu Host invocation, private snapshot + accepted-evidence seam, registered release Host lifetime. | Independent custody/provenance/installation review before bootstrap integration or C2 consumption. Supported-OS checks stay explicitly unverified where no fixture exists. |
| C1b | Same owner after Native source handoff: Python bootstrap/submitter protocol and fake-secret process fixture; prototype restart observer interface with a fake resource adapter. | Prove private framing, signal/reaping, bounded logs, fresh startup identity and failure states. C1 may close source/process deliverables while explicitly blocking deployment readiness on missing real-Docker evidence. Update C1 AC wording accordingly; do not mark the original full Docker AC passed from process evidence. |
| C2a | Managed-resource owner: durable non-secret owned-resource registry, exact-container observer/supervisor adapter, startup maintenance authorization, inspect/reconcile/create behavior. | An actual isolated Docker fake-sentinel test must prove inspect/config/log/file behavior, full container restart, tmpfs freshness, helper death and daemon restart before this mechanism can deliver real credentials or mint trusted deployment receipts. |
| C2b | Core consumes accepted deployment ledger references; supervisor binds actual resource generation/readiness. | Lost replies are inspected by original IDs, never replayed. Missing Core/helper/key leaves Native unstarted. C3 model readiness remains separate. |

C1 supplies the release Host's lifetime and restart state-machine contract now, including Home closure independence. C2 owns the real persistent deployment list and Docker event/polling adapter. Do not leave both tasks waiting for the other to define the observer. Windows custody is available in the logged-in registered user's session; pre-login unattended custody is not promised by the existing account model. Ubuntu uses the explicitly installed service. A fake adapter verifies transition logic, not actual Docker behavior.

The bootstrap candidate remains: PID1 waits without secrets, generates fresh `startupId`, creates a protected tmpfs socket, accepts one exact-startup private frame via fixed no-TTY `docker exec -i` submitter, and starts the existing wrapper with child-only in-memory credentials. It must discard/bound raw output before Docker logs, disable dotenv, preserve process-group termination and wait/reaping, and reject old ACKs. The database shutdown window must allow the existing wrapper's graceful work rather than immediately killing it at a short adapter timeout. A container administrator or same-UID malicious in-container process remains trusted; mode bits do not isolate it.

No current environment action occurred. If the isolated Docker/Ubuntu fixture is unavailable, preserve a named unsupported/unverified gate and proceed with other source work. Do not silently start the owner's stopped daemon, use real keys/providers, or substitute `--env-file` / `docker exec -e` when the private-channel experiment fails. Revise the mechanism based on evidence instead.

### 8. Bounded independent validation matrix

Evidence levels: **S** = source/design; **U** = unit/contract; **P** = actual child process; **W/L** = supported Windows/Linux OS; **D** = actual isolated Docker. Only S was gathered by this review. Run focused checks after each cohesive checkpoint, then one integrated C1 check; do not combine this custody boundary with unrelated template work. Heavy tests remain serialized and Vitest uses at most two workers.

| Cases | Required assertion | Evidence needed / gate |
| --- | --- | --- |
| Known TSC1 fixture; wrong key/store/AAD/magic/version/final tag/truncation | Existing codec behavior preserved; no catalog/key writes or partial value output. | U; C1a |
| Installed empty-cwd run, unavailable checkout/store, missing sodium asset, modified package export, injected preload | Complete compiled closure works; unsafe or incomplete closure refuses. | P plus W/L; C1a |
| Copied operator receipt/status; forged helper trust fields; wrong Host/control/input/attempt; duplicate terminal | No successful accepted evidence/receipt; ordinary capabilities and existing-instance setup still work. | U plus real in-process broker/Host integration; C1a |
| Core attempt differs from broker operation/Host attempt; response arrives immediately at notify | Correct map exists before execution and is retained through acceptance. | U; C1a |
| Fixed Date set/clear; A-B-restore-A; rotation mismatch; failed publication; externally replaced envelope | Private owner revision/digest identify current state; stale attempts fail even when old bytes/timestamps return. Failed publication does not advance owner state. | U plus file integration; C1a |
| Rename after helper open; replacement during final read; Core restart or policy/config/Host change before acceptance | Old descriptor/prepared output cannot become current; final guard occurs after asynchronous boundaries. | P plus W/L; C1a |
| Reparse/unsafe parent/DACL/owner; replacing runtime/module/adapter between verification and use | Actual objects remain protected or refusal occurs; no alternate path/key/account fallback. | W, not mocks alone; C1a |
| Wrong service UID; stale other-service credential directory; symlink credential; wrong role/token; unattended ask | Correct service-local source and role=node gate; unavailable rather than bypass. | U plus L; C1a |
| Oversize/partial/trailing/duplicate frame, wrong startup, EOF timeout, raw secret-bearing error | Bounded allocation/lifetime; no sentinel in WS/argv/stdout/stderr/status/fixture files. | U/P; C1b |
| Helper/Core loss before delivery; lost ACK after delivery; restarted bootstrap; changed custody | Native remains unstarted or original startup is inspected; no blind injection/create replay. | P plus fake observer U; C1b; D at C2a |
| Stop signal during bootstrap and running wrapper | Signal reaches owned process group, children are reaped, graceful DB shutdown is actually observed where a DB fixture exists. | P; DB/D proof at C2a |
| Actual no-TTY exec delivery, inspect/config/log/file scan, full container/daemon restart, tmpfs reset | No fake sentinel in persisted surfaces; fresh startup requires fresh authorization; old ACK refuses. | D; blocking C2a gate before real delivery/receipt |

Record command, source/artifact identity, actual exit result and exercised platform for every eventual check. Fake model adapters must fail on an unexpected external call. Secret sentinel scans should test failure output and crash paths as well as success. None of these checks was run by this reviewer.

## Files found and related specs

| Path | Role in the review |
| --- | --- |
| `.trellis/tasks/10-07-hindsight-managed-host-custody/{prd,design,implement}.md` | Current C1 planning artifacts; major recommendations already acknowledged, exact contracts still open. |
| `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md` | Prior current-source Host/model boundary inventory. |
| Same directory, `stage5c-custody-design.md` | Decoder/bootstrap proposal and Native/library source references. |
| `.trellis/tasks/08-09-memory-operations-ui/research/stage5-execution-map-2026-10-07.md` | Stage sequencing and producer dependencies. |
| `packages/core/src/capabilities/{capability-broker,capability-response,route-capability,capability-challenge}.ts` | Actual issued identity, terminal acceptance, route mapping and permission challenges. |
| `packages/core/src/server/methods/{capability-respond,connect}.ts` | Authenticated Host provenance and node enrollment. |
| `packages/core/src/secrets/{secret-catalog-service,secret-catalog-envelope,catalog-publication,master-key}.ts` | Owner state/revision, TSC1 codec, atomic publication and existing key adapter. |
| `packages/core/src/memory/hindsight/{hindsight-setup-service,hindsight-configuration-context}.ts` | Current raw managed receipt consumer and private observation identity. |
| `packages/shared/src/{hindsight-setup-schema,secret-catalog-schema}.ts` | Existing JSON receipts and public secret limits/projections. |
| `apps/desktop/src-tauri/src/{capabilities_impl,secrets}.rs`, `src/bin/{taki-secret-key,taki-node}.rs` | Executor context gap, actual token SID, get framing and debug-only node limit. |
| `packages/shared/package.json`, root `tsconfig.base.json:13`, `pnpm-lock.yaml` | Source exports, extension rewriting and pinned build/runtime closure. |
| `.trellis/spec/backend/secret-catalog.md` | One writer, private revision, public no-value projections and locked semantics. |
| `.trellis/spec/backend/host-operation-lifecycle.md` | Original Host/input/generation ownership and unknown outcomes without reconnect replay. |
| `.trellis/spec/backend/permission-authorization.md` | Core canonical governance and stricter-only Host execution. |
| `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` | Narrow key-bootstrap exception is not a Core deployment-spawn authorization. |

## External references and versions

No network research or new dependency selection. The supplied custody report records Node 24, locked libsodium-wrappers/libsodium 0.8.4, Native Python 3.11 base and python-dotenv 1.2.2 source. Its Native `config.py`, `start-all.sh`, Dockerfile and installed dotenv references support the proposed spike, not an installed-image attestation. Exact release OS/runtime/image hashes are intentionally not invented and must come from the later trusted artifact/fixture.

## Caveats / Not Found

- This is a readiness review, not code verification. No tests, services, processes under test, Docker, network, Git, dependency installs, real credentials or original data were used.
- The legacy `.trellis/.current-task` file was empty on the read after compaction. The leader explicitly supplied the active B task/output location; no task binding or state was changed by this reviewer.
- Only this research report was written. C1 remains planning-only and B1 retains its assigned production files. Source line numbers describe the observed snapshot and may move with B1 changes.
- No current installed custody helper, Ubuntu release Host, accepted managed-deployment producer or verified Docker secret bootstrap was established by this review. Their absence is not repaired by strict JSON schemas.
- The helper shares the trusted local credential owner's access and transiently decrypts the whole catalog. This does not provide per-entry cryptographic isolation, reliable JavaScript secure erasure, protection against the owning OS/Docker administrator, or instantaneous revocation of a running Native process.
- The proposed protocol caps are new helper safety limits. The existing TSC1 catalog has no aggregate size guarantee; imported/restored entries need explicit checks. Fail safely and document unsupported size rather than silently changing storage format.
- Supported-platform installation and real Docker evidence must remain named gates. They cannot be claimed from source review, mocks or a successful Windows-only build, and cannot all be postponed to Stage 6 while enabling real managed delivery in C2.

## Final artifact confirmation — 2026-10-07

**PASS: C1 planning artifacts consistently close all six readiness findings. No remaining design correction was identified in this bounded confirmation.** This supersedes the earlier conditional planning verdict for the exact artifact snapshots below; it is not implementation, installation or Docker acceptance.

Scope was limited to rereading C1 `prd.md`, `design.md`, `implement.md` and `research/design-review-resolution.md` against this completed report. No new source discovery, test, environment action or task-state change was performed. Context-manifest validation was reported by the leader and was not rerun by this reviewer.

| Original finding | Confirmation |
| --- | --- |
| Trusted invocation/result and ID mapping | Design section 3 now specifies per-pending `onIssued`/`onAccepted`, mapping before notify, actual successful current terminal checks, owner-backed handles, post-gate Host context and refusal of fresh raw managed receipts. Post-async final validation and ordinary-capability/existing-instance compatibility are preserved. |
| Owner-consistent catalog snapshot | Design section 4 freezes capture/validate, exact loaded/published/restored digest aligned with cached state, boot/private revision/digest, stale external replacement and fresh C2 non-secret reauthorization. No public secret-metadata expansion is introduced. |
| Windows installation boundary | Design section 2 requires the independent expected identity, actual handles/file IDs/owner/DACL/parent checks, held write/delete denial for consumed artifacts, rename-tolerant catalog reads, sanitized Node execution and strict get-only frame/deadline. Unsupported assurance remains unavailable. |
| Ubuntu release Host and custody | Design sections 2/3 require real paired `role=node`, service-local logical credentials resolved each start, correct UID/source protection, separate node token and canonical unattended-ask refusal. |
| Packaged closure | Design section 1 and the implementation plan require compiled ESM, complete pinned runtime assets/metadata, outside-checkout operation and no broad frontend crypto/Core boot import. |
| Bootstrap/check ownership and evidence | PRD now separates C1b process acceptance from pending Docker acceptance. Design section 5 and implement steps 3-5 freeze independent C1a/C1b checks, C1 release lifetime/fake observer ownership, C2a actual registry/observer and mandatory Docker gate, and C2b accepted ledger consumption. |

Design section 7 also freezes the recommended finite caps and makes private frame byte order concretely **u32 little-endian**. The public secret-value limit remains expressed in UTF-16 code units; helper byte caps do not change TSC1 storage. The original Host deadline and short key-read budget remain distinct from later database shutdown/model budgets.

### Confirmed artifact hashes

SHA-256 values are for the files read in this confirmation. Paths are relative to `.trellis/tasks/10-07-hindsight-managed-host-custody/`.

| Artifact | SHA-256 |
| --- | --- |
| `prd.md` | `57d4dfba773eb5b204e3540a60a94f1c29bd7ec0b42a2d3e65467f5fe793f786` |
| `design.md` | `2f8ae83fc2838b575d50f59ce329731e95890feb71a458453a3d0a6aaefa1e1b` |
| `implement.md` | `bcc1bfc83f6eb1654c9b35d71015d96e0dd2eca59d4b0ad5ca63d0940294d114` |
| `research/design-review-resolution.md` | `7a542a751614d03b567abe79cd1bdffd392ec6074cb6322652e7ae344d576594` |

Activation still waits for release of overlapping 5B source ownership and a focused check of the actual post-5B interfaces/migration/compatibility heads. This is an execution dependency, not a request for another product approval. Supported-platform evidence and the real isolated C2a Docker fake-secret/restart gate remain future verification obligations; process/mock success must not enable real credential delivery or trusted deployment receipts.
