# C1 managed Host and custody design

Status (2026-10-13): final independent artifact confirmation PASSED for all six readiness findings. Stage 5B
source ownership is released and the post-5B source refresh found no new blocker. The owner authorized C1
continuation. C1a and C1b independent source reviews now pass, including the admission-versus-observation
deadline correction. The original technical boundaries below remain in force. The separately authorized
2026-10-14 Linux process run passed all eight cases after test-fixture timing corrections, without production
changes; see `research/c1b-linux-check-2026-10-14.md`. Service, installer and deployment acceptance remain
distinct from these source/process verdicts.

## 1. Responsibility and dependency boundary

Core is the sole Secret Catalog writer, policy authority and admitted-operation owner. The registered execution
Host owns installed artifacts, OS credential access and future process/storage effects. Home is a disposable
operator client. No deployment spawn is added to Core's narrow existing key-bootstrap exception.

Reuse the existing Node 24 and locked libsodium-wrappers 0.8.4 codec implementation. Extract its format/schema and
open/seal logic into a supported boot-free workspace module. Core retains the mutable Catalog service; helper
imports the decoding surface and never creates/restores/rotates the catalog. Preserve TSC1 bytes, AAD, key version,
error categories and existing Core tests. This requires no new third-party cryptography dependency.

The helper is trusted as the local credential-owning user and can transiently decrypt the whole encrypted JSON
envelope. Selecting fixed refs limits its public behavior; it does not provide per-entry cryptographic isolation
or protection against a compromised program already controlling that user. Do not promise perfect JS memory erasure.

Compile helper, codec and required pure Shared modules to ESM with rewritten extensions. Ship complete pinned
runtime dependencies, sodium/Wasm assets, package metadata and licenses. Do not export sodium through the broad
Shared/frontend barrel, depend on `.ts` stripping inside installed `node_modules`, workspace symlinks or a pnpm
development store. Use the locked compiler without adding a bundler. An empty-cwd copied-install smoke must decode
a fake envelope with checkout/store access unavailable and prove Core boot/server ownership is not imported.

## 2. Installed artifact and custody registration

Use a release-safe `apps/hindsight-host` Node application with a versioned manifest and explicit resource tree.
The manifest records contract/build/platform identity and all consumed entrypoint/dependency digests. Windows also
pins the get-only `taki-secret-key` executable; Ubuntu uses the protected systemd credential adapter directly.
Require an explicitly registered compatible Node 24 executable with actual path/version/digest. No mutable PATH
fallback, automatic runtime download, source-checkout imports or dependence on debug-only `taki-node`.

An expected installation identity must originate in trusted packaging or explicit protected registration. A
self-consistent manifest and payload from the same writable directory are not their own trust root. Resolve the
registered installation once, inspect actual owner/ACL and opened-file identities, reject redirects/reparse points,
and guard replacement between verification and consumption. Final platform primitives and the executable-open
handoff follows the concrete platform requirements below.

Windows Rust checks final local path, volume/file IDs, owner and effective DACL through actual file/directory
handles. Reject reparse points, UNC/device/ADS ambiguity, unsupported filesystem/unsafe writable parents and
unregistered symlink/hard-link arrangements. Hold verified runtime, adapter and complete consumed JS/metadata/
sodium/dependency files with write/delete sharing denied, including required parent replacement guards, until
execution finishes using them. Verify the objects execution actually resolves. If supported Windows primitives
cannot establish this, installation remains unavailable; do not fall back to hash-before-spawn.

Launch with an explicit allowlisted environment and fixed argv, hidden on Windows, without a shell. Clear Node
preload/module search and equivalent execution-affecting environment settings; the manifest does not protect an
otherwise injected Node process. Add outside-checkout packaged smoke tests with malicious preload sentinels.

Non-secret registration binds helper manifest/root, runtime/adapter identities, local Core data/store identity,
execution Host, actual OS owner and fixed credential backend/account/version. Request input cannot choose a path,
master-key helper, username, Core URL or arbitrary secret ref. Unsafe registration refuses; no automatic repair.

The Windows get-only adapter closes stdin immediately, accepts exactly `[u32 LE 32][32 key bytes]`, bounds and
discards stderr, and kills/reaps on failure within min(10 seconds, remaining parent budget). Never call `create`.
The catalog itself is rename-tolerant read-only input: do not hold a no-delete catalog lock that blocks Core writes.

Ubuntu registers an explicit service/install prefix/Core store and the same credential-owning effective UID as
Core. Register a logical credential name/service policy, not another service's temporary `CREDENTIALS_DIRECTORY`.
Resolve this running service's directory each start, open the fixed `taki-secret-catalog-master-key` regular file
through a bounded descriptor, and validate UID/root ownership, mode and parent identity. Reject unsafe symlinks,
group/world writable custody paths and group/world readable key material. Node enrollment credentials remain
separate from the Catalog key. Enrollment uses existing pairing/token issuance, never direct device-DB edits.

## 3. Exact authenticated execution and result acceptance

Keep Core memory operation/attempt identity and actual Host broker attempt identity distinct. Persist their exact
mapping at admission. A typed custody request contains only safe operation/config/installation identities and
fixed slot refs; the execution Host receives authority from the real authenticated broker context, not fields
asserted by request JSON. Windows derives token-user provenance using the trusted Rust adapter. Ubuntu uses actual
effective-user/credential ownership plus an explicitly enrolled `role=node` control identity.

The current generic capability output must not become a trusted receipt just because its JSON contains a Host ID
or `trusted` flag. Introduce a narrow internal accepted-result seam that preserves the actual issued request, Host
session/generation, control result and exact-input association through broker validation to the custody consumer.
Supply that same trusted invocation context to the Host execution implementation through an internal typed path.
Leave ordinary capability results and operator diagnostics unchanged. Implement these narrow internal semantics
at the existing `capability-broker`, `capability-response`, `route-capability` and Rust executor boundaries:

- Per-pending-request `onIssued({requestId, control})` and
  `onAccepted({requestId, control, provenance, authorization, outcome})` observers are installed before notify.
  They are code-owned options, never global append-only listeners or WS-deserialized callbacks.
- `onIssued` records `{coreOperationId, coreAttemptId, brokerOperationId, hostAttemptId, requestId, inputDigest}`
  in the live admission owner before external execution. If recording fails, do not notify. Route an explicit
  operation ID only where needed; Host attempt IDs remain separate even if operation IDs deliberately match.
- Accepted evidence requires an actually successful terminal outcome, current lineage/governance/Host/control/
  policy and deadline checks. Protocol-level `accepted:true` alone is insufficient. Mint at most once; cancellation,
  timeout, wrong control, duplicate and replay cannot produce success. Clean observers with their pending entry.
- Evidence is an internal handle backed by a Core-owned live admission record; JSON parsing or a TypeScript cast
  cannot mint it. The consumer validates that owner record and performs the final snapshot check after every
  asynchronous persistence boundary. Boot invalidates transient preparations; later C2 persists sanitized
  accepted deployment evidence for original-operation recovery.
- Rust `TrustedHostInvocationContext` is created after the real Host permission gate. A compatibility
  `run_with_context(input, context)` method may delegate to existing `run(input)` for ordinary capabilities;
  custody consumes the real request/control tuple. Ubuntu's release executor follows the same gate semantics.

Public diagnostics expose safe availability/refusal and identities only. Their JSON cannot be re-submitted as
managed deployment proof. Disconnect/timeout is unknown until the original attempt is inspected; reconnect never
reissues a secret preparation or future OS effect automatically.

C1 status cannot mint a deployment-ready receipt. Refuse fresh raw `managedReceipt` setup JSON as a substitute
for the missing trusted producer; retain ordinary existing-instance setup and historically accepted owner records
without inventing new provenance. C2 accepts a `receiptRef` resolved through its Core-owned accepted deployment
ledger. Caller-supplied helper IDs, diagnostics or parsed old receipt text never become new execution evidence.

Ubuntu advertises only actually implemented C1 capability cells and implements descriptor/classifier/challenge/
execute/resume/cancel over an explicitly paired `role=node` connection. A token does not bypass canonical `ask`.
Unattended maintenance needs applicable `auto` or an explicitly bounded standing policy; with `ask` and no operator,
return `APPROVAL_REQUIRED`. The helper cannot approve its own challenge or assume loopback operator auto-trust.

## 4. Read-only catalog snapshot and final validation

Capture Core boot identity, private successful-publication Catalog revision and actual sealed-envelope digest,
plus store/key/config/installation/Host identities. The revision closes restore A -> B -> A within one boot even
if the exact ciphertext is restored. The digest binds bytes read by the separate helper; the boot scopes the
process-local revision. Neither timestamps nor digest alone replace this tuple. Keep it internal and do not
broaden public Secret Catalog metadata or persisted historical fingerprints.

Add owner-internal `captureCustodySnapshot(fixedSelection)` and `validateCustodySnapshot(snapshot)`. The service
records the exact successfully loaded/published/restored envelope digest beside its cached plaintext/key metadata.
Capture reads bounded current bytes and requires that owner identity before combining presence/provenance. Every
successful writer updates revision/digest together; failed publication does not. Do not compose `backup()` plus
`presence()` as independent reads. Unexpected external replacement becomes stale/unavailable, never implicit reload.

Store an opaque snapshot ID with the boot/private revision/digest/store/key/config/installation/Host/attempt map/
generation/deadline in the live owner. Send only its opaque ID and admitted non-secret byte/selection context to
the Host; private revision stays in Core. Validate handle identity across the read and current registration at
acceptance. C2 obtains fresh non-secret injection authorization over the authenticated Host path and checks again
before deployment-ready publication. This is not a secret retrieval service or an instant revocation guarantee.

The helper reads one bounded complete registered envelope through a read-only handle, obtains the existing key
using get/systemd-read, authenticates TSC1 and selects only fixed admitted Hindsight refs. The same-user trust
boundary is explicit. No catalog/key creation or writes, arbitrary ref resolver, secret WS message, plaintext file,
debug dump or public secret listener. Missing required refs refuse; optional inheritance remains explicit.

Before accepting preparation, and later before injection and ready publication, the original live owner checks
operation/attempt, Host/policy/boot, config, installation and current Catalog revision/digest again. The helper
cannot advance an old attempt to new values. Rotation/key-source mismatch is locked/stale; it must not choose an
alternate key or emit plaintext diagnostics. An already running Native process retains old credentials until a
controlled later restart; stored clear/rotation alone does not establish runtime revocation.

## 5. Fake-secret bootstrap experiment and C2 handoff

The target managed Native bootstrap starts without secrets, creates a fresh startup identity and protected tmpfs socket,
and waits. A fixed helper-controlled `docker exec -i` submission to the exact owned container uses private stdin
without a TTY, shell interpolation or secret environment arguments. The frame binds startup/operation/config and
the fixed credential slots. Bootstrap launches the existing graceful Native wrapper with credentials only in
child memory/environment, dotenv disabled, and controlled bounded status output instead of raw provider logs.

The C1b process prototype now implements private framing, independent grants and an explicitly test-only fixed
seven-slot consumer. Actual Native wrapper/provider start wiring and the real deployment adapter remain C2/C3;
the fake Host observer is not reachable from the installed entrypoint. Process and deployment evidence stay
separate. Use only generated fake sentinels and isolated storage. Validate frame bounds,
wrong startup, duplicates, replacement, private delivery, stdout/stderr, argv, inspect/config/files, helper death,
restart with fresh tmpfs, absence/rotation of custody, signal propagation and graceful database shutdown. A pure
process fixture proves only its exercised boundary; Docker daemon/restart claims require an actual isolated Docker
fixture when that environment is explicitly available. Do not start the user's stopped Docker service incidentally.

C1a owns codec, installed tree, real Windows/Ubuntu Host invocation, owner snapshot/accepted evidence and the release
Host lifetime; it receives an independent custody/install check. C1b owns Python bootstrap/submitter process
behavior and a fake-adapter observer state machine; it receives a separate process/framing/shutdown check. Its
source/process PASS explicitly leaves Docker deployment readiness unavailable.

Admission expiry does not end an already running process or hide its original safe status. A read-only status
exchange has its own bounded I/O deadline after consumption; it never renews the original grant or permits a
second injection. Keep the Linux process proof separate from Windows socket/peer test substitutes.

C2a owns the durable non-secret real deployment registry, exact-container observer/Docker adapter, startup
maintenance authorization and resource reconciliation. It must pass actual isolated Docker fake-sentinel checks
for inspect/config/logs/files, no-TTY stdin delivery, full container and daemon restart, helper loss and fresh tmpfs
before real delivery or trusted deployment receipts can be enabled. C2b consumes accepted ledger references and
actual resource-generation/readiness evidence. A missing fixture does not authorize switching to env-files or
claiming this gate from mocks. Keep graceful database shutdown on its own C2 budget, not the short key-call timer.

Home closure does not own the restart observer. Windows uses an installed hidden supervisor in the logged-in
credential owner's session; before that user's login the current account model cannot provide unattended custody.
Ubuntu requires an explicitly installed release Host/service with protected Node/control credentials. New container
startup requires new custody validation and a new acknowledgement. Missing helper/Core/key leaves Native unstarted.

## 6. Validation and migration boundaries

Preserve existing-instance setup when helper/capability is absent. C1 status is not deployment/model readiness or
memory authority approval. Relevant test groups are codec equivalence, outside-checkout artifacts, authenticated
Core-to-Host result provenance, platform identity/path/environment checks, catalog race/ABA and fake-secret crash
lifecycle. Independent C1 review is required before C2 consumes the foundation.

Registration is versioned, non-secret and fails closed on incompatible identity. No automatic re-enrollment or
destructive migration of installations/catalogs. Core/Native schema additions, if actually required by the final
reviewed ownership model, are allocated only after 5B releases the then-current heads. No old migrations change.

Actual Node/Docker/service installation, OS privilege changes, real provider keys/images/models and original user
data are separate environment actions. Stage 6 owns final installed/original-environment and owner/manual acceptance.

## 7. Frozen C1 v1 finite contract

These are helper limits, not a TSC1 storage migration or a change to public secret-setting semantics. Reject before
unbounded allocation/read growth, never truncate, echo rejected input or delete entries to fit a cap.

| Surface | Contract |
| --- | --- |
| Identities | Existing strict UUID/Host/control schemas; 64 lowercase hex SHA-256; positive safe-integer generations; existing ISO timestamps. |
| Selection | At most seven fixed Hindsight slots resolved from `hindsight-secret-refs.ts`; no duplicate/unknown/arbitrary ref; explicit optional inheritance. |
| Helper request | Strict versioned non-secret UTF-8 JSON <=32 KiB including trusted control projection; no paths/commands/URLs/env maps. |
| Public status/result | <=16 KiB UTF-8; fixed reason/state enums and admitted safe identities; no raw errors, output, envelope or ready-deployment authority. |
| Sealed envelope | <=16 MiB, checked by size and cumulative bounded read; oversize means custody unavailable, not corruption. |
| Selected strings | <=65,536 UTF-16 code units per value, including restored/imported values; bound encoded bytes separately. |
| Private frame | One 4-byte little-endian unsigned length plus strict UTF-8 JSON <=4 MiB, seven fixed slots, startup/config/newly authorized attempt, EOF and no trailing data; never sent over WS. |
| Key adapter output | Exactly 36 bytes `[u32 LE 32][key]`, immediate stdin EOF and bounded discarded stderr. |
| Deadline | No later than original admitted Host deadline (current default 90 s); key call min(10 s, remaining). New startup needs new authorization; no silent extension. |

Error enums follow existing conventions: unsupported/unsafe installation, unavailable Host, locked custody,
oversize input, stale snapshot and unknown outcome. Preserve existing-instance use when C1 is unavailable.

## Sources

The PRD links the completed current-source Host/custody reports. Their untruncated excerpts are under `research/`.
The [independent readiness report](../10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md)
supplies exact source references and the six corrections incorporated above. Its final confirmation passed;
the [post-5B refresh](../10-07-hindsight-template-lifecycle/research/stage5c-post5b-readiness-2026-10-13.md)
records the current interfaces and migration/build heads for implementation.
