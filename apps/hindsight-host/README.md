# Installed Hindsight custody Host (C1a)

This helper authenticates the registered TSC1 Catalog read-only and returns bounded, non-secret preparation
status. Core is still the sole Catalog writer. `deploymentReady` is always `false`: neither preparation,
`inspect-installation` nor enrollment authorizes Native deployment or credential injection. C1b owns the fake
process bootstrap; C2a must separately prove the actual Docker delivery/restart path before real delivery.

## Artifacts and prerequisites

The installed payload contains compiled ESM in `app/`, narrow compiled Shared/codec packages, the full pinned
runtime dependency trees (including sodium assets and package metadata), and `manifest.json`. Windows also
contains `bin/taki-secret-key.exe`. Nothing resolves through a source checkout, pnpm store or TypeScript loader.
The runtime is an explicitly installed Node **24** executable registered by absolute path, exact version and
SHA-256. No command downloads or silently discovers a replacement runtime.

| Item | Required trust |
| --- | --- |
| External `installation.json` | Outside the payload; explicitly protected by the installer; pins manifest, Node runtime, Host/Core/store and credential owner. |
| Windows payload/runtime/adapter and every parent | Local NTFS with persistent ACLs, actual token-user binding, accepted owner/DACL and no reparse point. Artifacts have one link and retained read handles that deny write/delete sharing. Directory handles request list access to prevent rename. |
| Linux payload/runtime and every parent | Root or the registered effective UID owns the object, no group/other writes, no symlink; files have one link. Descriptor hashes and identities are captured together and parent identities are rechecked. |
| Linux launcher and systemd unit | Installer-protected trust root outside the payload. The builtin-only launcher checks the complete payload before importing any of it. |
| Catalog | `<coreDataDirectory>/secret-catalog.bin`, actual owner/DACL/path validation with protected parent handles on Windows. Its directory guard allows write sharing for Core rename publication and denies delete sharing to prevent parent rename; temporary read-only leaf handles close after inspection. Current file ID and sealed digest are checked again after helper execution. No alternate file or key source is searched. |

Windows permits current user, SYSTEM, Administrators and TrustedInstaller writers. An ancestor may permit
creation of an unrelated sibling directory but must not permit untrusted deletion, redirection or metadata/DACL
changes. Unknown ACL forms fail closed. Do not repair existing directory permissions as a side effect of launch.
The registered UID/user and OS administrator remain trusted; this is not isolation from a compromised same-user
process. JavaScript secret strings are not securely erasable.

## Windows desktop build and registration

`pnpm desktop:build` builds the existing key adapter with `cargo --locked --offline`, compiles the Host payload,
and passes its complete directory map to the real Tauri build. The installed resource path is
`hindsight-host/payload`. The Node runtime remains an explicit installation prerequisite. `--debug` selects
the debug profile; `--prepare-only` produces the real adapter/payload/resource JSON without making an installer.
All Rust output stays in `apps/desktop/src-tauri/target`. No generated resource placeholder is needed for normal
`cargo check` or desktop development.

The installer must protect the payload and runtime, then create a strict `HindsightHostRegistration` (see
`packages/shared/src/hindsight-installation-schema.ts`). Important fields are:

- `installationId`: the installer's new opaque lowercase SHA-256-shaped identity; `manifestSha256`: the hash of
  the exact built manifest, recorded outside the payload.
- `installationRoot`, `runtime.path`, `runtime.version`, `runtime.sha256`: actual installed artifacts.
- `executionHostId`: the existing paired Shell device identity; `coreHostId` and `catalogStoreId`: the actual
  Catalog store/Core identity; `coreDataDirectory` and `catalogKeyVersion`: that one existing store.
- `custody.kind = "windows-keyring"`, `tokenUserSha256`: SHA-256 over the **binary actual token-user SID**,
  `service = "TakiAgent"`, `account = "secret-catalog-master-key-v1"`, and the fixed installed adapter path/hash.

Place the protected registration at `<Shell data directory>/hindsight-host/installation.json` and the same
registration at `<Core data directory>/hindsight-host/installation.json`. The Shell verifies it before advertising
the capability and pins its contents for that Host lifetime. Changed registration needs a new verified Host
lifetime. A missing/unsafe install omits only `hindsight-custody`; ordinary capabilities and existing-instance
Hindsight setup remain available.

Only the Rust post-gate executor invokes `app/main.js prepare`. It retains all artifact/parent handles, clears
the environment before the first Node instruction, sets `WS_NO_BUFFER_UTIL=1` and `WS_NO_UTF_8_VALIDATE=1`, disables
native addons/global search paths and uses a private bounded stdin request. Node and its adapter descendants
belong to a kill-on-close Job. Deadline/cancel closes that lifetime and reaps it. The adapter gets only the fixed
`get --account secret-catalog-master-key-v1` invocation, never a create/rotate operation. Manually supplied stdin
or a diagnostic result cannot mint Core's process-local accepted handle.

## Ubuntu release and explicit enrollment

Build with `pnpm --filter @taki/hindsight-host build:linux --output <new-directory> --architecture x64` (or
`arm64`). This creates `payload/`, `launcher.mjs` and `taki-hindsight-host.service`. The build may be inspected on
Windows, but it does not establish Linux service/UID/filesystem evidence.

Installation is an explicit operator action. Use a system service on the same credential-owning UID as Core:

1. Install the payload at a protected `/opt/taki-hindsight-host/payload`, an explicit Node 24 binary at
   `/opt/taki-hindsight-host/node24/bin/node`, and the launcher at
   `/usr/local/libexec/taki-hindsight-host/launcher.mjs`. Protect every parent; do not execute payload `main.js`
   directly as the service entrypoint.
2. Create `/etc/taki-hindsight-host/installation.json` outside the payload with actual hashes/identities and
   `custody = { "kind": "systemd", "uid": <numeric UID>, "service": "taki-hindsight-host.service",
   "keyCredential": "taki-secret-catalog-master-key", "nodeCredential": "taki-hindsight-host-node" }`.
   Copy the same registration to Core's fixed registration location. The launcher runtime path must exactly
   match the registered real executable; symlink-based version selectors are unsupported.
3. Enroll the configured `executionHostId` through Core's existing Node pairing route. Run the protected launcher
   under `/usr/bin/env -i WS_NO_BUFFER_UTIL=1 WS_NO_UTF_8_VALIDATE=1 <registered-node> --no-addons
   --no-global-search-paths <protected-launcher> enroll --registration <registration> --credential-output
   <new-protected-0600-file>`. Feed one bounded JSON enrollment request over stdin, containing `coreUrl` and,
   after Core issues its pairing prompt, the exact `pairingCode`. The initial request without a code may create
   that prompt; it does not enroll or output a token. Rerun with the operator's code and a still-new destination.
4. Provision that separate Node-token JSON and the existing **32-byte Catalog master key** into the two named
   `LoadCredentialEncrypted=` inputs using the installation's approved systemd credential tooling. Enrollment
   never reads or creates the Catalog key. Treat the temporary enrollment file as a credential and remove it
   through the operator's approved credential provisioning procedure, not through the running helper.
5. Replace `@CUSTODY_USER@` / `@CUSTODY_GROUP@` in the unit and review all absolute paths. Verify the unit on the
   actual systemd version, install it in the protected system unit directory, then explicitly enable/start it.
   These actions are not performed by repository build scripts.

The unit clears injection variables **before Node starts**, passes systemd's fresh `%d` credential directory and
uses the protected launcher. At each start the Host checks the actual effective UID, service-local credential
names, protected paths and private key mode. No token/key is in argv, the unit, public responses or helper cache.
It authenticates as `role=node`, publishes one complete capability catalog and enforces Core's canonical
`ask / ask / auto` policy. An unattended ask returns `approval-required`; it never opens a desktop dialog.
Disconnection ends the Host generation and exits for systemd to restart. Pending requests/results are discarded
and never replayed. Home closure does not own this service lifetime.

## Checks and platform boundaries

`pnpm --filter @taki/hindsight-host test -- --maxWorkers=1` covers exact controls, late/cancel/duplicate behavior,
read-only fake Catalog handling and the real paired Core WebSocket route. The integration fixture substitutes
only OS installation/key preparation; it does not claim OS provenance.

Windows primitive tests exercise actual SID, DACL, hard-link and retained-handle replacement behavior. The four
ignored `hindsight_windows::tests::copied_installation_*` tests additionally require an explicitly created,
protected FAKE-only root. `scripts/copied-install-fixture.ts` requires its marker; the test adapter source is
`test-fixtures/fake-key-adapter.rs`. It emits only a fixed fake key and never accesses Credential Manager.
The fixture records a copied Node runtime and real built dependency closure, malicious preload sentinels,
missing/tampered artifacts, version mismatch and a real fake TSC1 read through the production Rust invoker.
The fixture also creates an owned Catalog junction for redirect refusal. Its Catalog tests reject unsafe
leaf/parent DACLs and prove same-directory Core publication remains possible while the old file snapshot is stale.

Supported Ubuntu/systemd execution and final Windows MSI/NSIS installation need their own platform acceptance.
Source checks, a debug resource build or a fake-key copied install never mark those manual gates passed.

## C1b fake restart observer

`src/restart-observer.ts` is an internal fake-adapter prototype. It is not imported
by `main.ts`, so the installed payload's reachable-import build does not include
it. It has no release entrypoint, Native launch wiring or persistent registry.

The adapter can only inspect the original resource ID, obtain an independent
startup grant and submit that exact grant. It cannot create, delete or replace
resources. Each restart retains the original operation/resource/configuration,
requires fresh startup/attempt/authorization IDs and rechecks current custody
after asynchronous observation. Observation is single-flight and bounded; closing
the observer cancels its waits. Home closure does not define Native ownership.

Submission is fenced before the adapter call. A lost reply, helper death, stale
grant or timeout retains an unknown outcome and recovers by inspecting the
original IDs; it does not blindly repeat injection. A supplied recovery record is
in-memory prototype input, not proof of a durable authenticated registry. At most
64 startup records are retained; reaching the bound refuses new work rather than
forgetting consumed IDs. All public states keep `deploymentReady: false`.

The focused test is
`pnpm exec vitest run apps/hindsight-host/src/restart-observer.test.ts --maxWorkers=1`.
It uses no Docker, real credentials or model calls. Native C1b protocol/process
fixtures live in the Native checkout under `docker/standalone/managed_bootstrap`
and `docker/standalone/tests`. Their seven-slot mapping is fake-only; actual
provider startup, installed observer lifecycle and C2a container/daemon/tmpfs/
database evidence remain separate gates.

## C2a installed fake deployment

The production `deployment-host --registration <C1-registration> --deployment-registration
<C2-registration>` entry is a bounded resident reached only by the authenticated Rust capability
handler. Its import closure includes `deployment-owner`, `deployment-registry`, `deployment-injection`
and `FixedDockerAdapter`. It is separate from the older internal `FakeRestartObserver` above.

Core exposes `memory.hindsight.deployment.start`, `.observe` and `.resumeStartup` to the operator.
Start admits one durable Run using `hindsight-deployment:start:v1:<caller-uuid>` and uses that Run's
UUID as the original deployment/operation. Create, start and inject have separate once-only canonical
Effect permissions; read-only C1 preparation cannot authorize any of those effects. Repeated starts
look up the original Run before fresh snapshot/custody admission and observe its original resource.

A protected sibling `deployment-registration.json` pins the installation, Core/Host, fixed Docker
executable/hash/version, Linux-engine endpoint, immutable fixture image ID and mutable state root.
Provision `deployment.lock`, an empty `docker-config/` and the strict initial `deployment.json` value
`{"version":1,"revision":0,"state":"vacant"}` explicitly outside the immutable payload. There is no
automatic initializer: missing/corrupt state refuses. Shell retains protected object handles and an
exclusive state lock for the resident lifetime. Node publishes flushed atomic registry replacements
and durable fences before engine, grant or private-frame dispatch; Windows process recovery is not a
power-loss guarantee.

The adapter uses only fixed no-pull commands, no network/ports, UID/GID 1000, one new data volume and
one bounded tmpfs. It has no delete, adoption or arbitrary-command path. Host validates every selected
value against `C2A_FAKE_[0-9a-f]{64}` before the final live Core checkpoint or any private frame. Native
independently validates that restriction and obtains its one-use startup grant through owner control,
not from the credentials. Observation may outlive the original deadline; only a genuinely new startup
can request fresh authority. Lost replies or post-dispatch drift retain an unknown outcome without replay.

Source checks use actual temporary registries, SQLite Run/Effect repositories, real Node helpers and
real Python owner/child processes with a finite engine substitute. The opt-in
`TAKI_C2A_INSTALLED_FIXTURE=1` test `src/deployment-installed.test.ts` creates its own protected
`C:/taki-c2a-fixture-<uuid>` tree, pairs a real operator and headless Rust Node, runs a copied payload
through the unchanged fixed adapter, and substitutes only the registered Docker executable with
`test-fixtures/fake-docker.rs` and a private named pipe. It records safe logs under `TAKI_C2A_TEMP` and
removes only its marked temporary tree. It never starts Docker or reads the user's credentials.

Every C2a result keeps `deploymentReady: false`. The running fake child is not database/model readiness
or a trusted managed-setup receipt. Actual Docker delivery/restart/tmpfs/database persistence and C2b
receipt consumption require their separate acceptance; existing managed setup remains refused.
