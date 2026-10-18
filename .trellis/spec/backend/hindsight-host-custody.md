# Hindsight installed Host custody and private bootstrap (C1)

## Scope and contracts

`hindsight-custody` / `hindsight-custody:prepare` is a read/cooperative capability with classifier
`hindsight-fixed-custody` revision 1. Governance registry revision 3 retains `ask / ask / auto` and only one-use
approval. Shared's narrow `hindsight-custody` / `hindsight-installation` subpaths and the Rust mirrors own the
strict protocol. Requests/status never carry values; every public result has `deploymentReady: false`.

Core's Catalog remains the sole writer. The extracted `@taki/secret-catalog-codec` preserves TSC1 and has no
storage, key-source, Core boot or logging dependency. Do not export sodium from the general Shared entrypoint.
Snapshots bind one Core boot, the existing successful-publication revision, opened/current file identity and
sealed-byte digest. No timestamp-only revision and no lazy refresh of a stale snapshot after publication/ABA.

The per-pending broker observer records issued control **before** notification and accepted provenance only
after final effect settlement. Core's owner maps original operation/attempt, broker/Host attempt and request ID,
revalidates after awaits and creates a WeakMap-backed handle. Operator JSON, status diagnostics and old managed
receipt shapes cannot create a new handle. Existing-instance setup and historical owner-record recovery remain
compatible when the helper is absent. C1a never authorizes Native starts/injection or trusted deployment receipts.

## Installed trust boundary

- An external protected registration pins complete manifest/runtime/adapter identity, platform/architecture,
  actual credential owner and the registered Catalog location. The payload manifest cannot attest itself.
- Windows validates the actual process token SID, owner/DACL, NTFS, file ID/final path, no reparse point and one
  link. Retain consumed file handles with no write/delete sharing and **directory handles with list access**:
  metadata-only access does not block rename on Windows. Parent ACLs must prevent untrusted deletion/redirection.
- Clear Node's environment before startup, disable addons/global module search, set both `WS_NO_*` flags before
  importing `ws`, and use fixed absolute executable/argv. A Job owns Node/adapter descendants until wait/reap.
- Linux's installer-protected builtin launcher and unit live outside the payload. Verify runtime/manifest/full
  tree/effective UID/modes before dynamic import. Capture digest and identity from the same fd; recheck parents.
  The root/same credential-owning user is trusted; same-user hostile code is not isolated by mode bits alone.
- Node enrollment uses real `role=node` pairing, a separate token credential and the exact service-local key
  credential name. Each service start resolves fresh systemd credentials. No fallback, key creation or caches.
- Catalog reads remain rename-tolerant, bounded and read-only; never pin the sole writer's publication path with
  a no-delete handle. Wrong/locked/replaced catalog, key mismatch and post-await identity drift refuse preparation.
  Windows must inspect the registered Catalog itself and retain its protected parent chain, separately from the
  immutable payload. The Catalog directory guard allows read/write sharing for Core's target-directory rename
  access but denies delete sharing to pin its name; open the replacement guard before releasing the old one.
  Leaf reads use read/write/delete sharing and close immediately after inspection: Windows
  replacement can still fail while a share-delete read handle is open. Retain only its identity and digest;
  reopen and compare them after helper execution. A valid payload never substitutes for Catalog
  owner/DACL/reparse checks.

The fixed budgets are 32 KiB private non-secret request, 16 KiB public status, 16 MiB sealed envelope, seven slots,
65,536 UTF-16 code units per value and 4 MiB private bootstrap frame. Artifact hashing is streaming and
capped at 512 MiB per file. The current 90-second Host deadline never expands; key reads use at most 10 seconds.

## Build and failure checks

`transpileModule` has no package lookup context: `NodeNext` may emit CommonJS for a `.ts` source in an ESM package.
The installed builder explicitly emits ESNext modules, rewrites relative extensions, copies complete locked
dependencies and emits digests. Validate actual Node startup outside the checkout; a compiler exit code is
insufficient. Desktop packaging maps this payload through real Tauri resources; no missing-source placeholders.

Required coverage: Shared/Rust strict fixtures; successful/failed publication and restore ABA; stale config/
Host/policy/Core/installation after awaits; no-operator ask, exact approval resume and duplicate/cancel/reconnect;
forged result/receipt; actual Windows SID/DACL/path/handle checks; copied-install fake TSC1 and preload sentinel;
missing/tampered manifest/runtime/adapter/dependencies. Distinguish terminal `late`/`duplicate` response refusal
from a failed transport so a completed cancellation cannot tear down a healthy Host connection.
Serde optional fields must reject explicit JSON null where Shared permits absence only. Keep this distinction
before deserialization drops it, including C1 invocation authorization and optional nested control fields.

Retain first failures and repaired check results. Mock transport/owner flags are not OS evidence; a copied
Windows fake install is not Ubuntu service or final installer evidence. C1b process-only and C2a actual Docker
delivery/restart gates stay separate. Original credentials, data, models and services need explicit authorization.

See [the installation contract](../../../apps/hindsight-host/README.md) for release and enrollment commands.

## C1b private bootstrap and original-resource observation

### 1. Scope / Trigger

Native `docker/standalone/managed_bootstrap/` supplies the reusable process protocol; Host
`restart-observer.ts` remains an internal `FakeRestartObserver` without a production registry caller.
The installed Host builder walks imports from `main.ts`, so that unconnected prototype is not shipped.
[C2a](./hindsight-managed-deployment.md) adds its own fixed fake owner and concrete durable deployment
adapter. Actual provider/model wiring remains a separate downstream gate.

### 2. Signatures

- `Bootstrap(configuration_digest, consumer=None)` creates a fresh startup UUID. With no consumer or independently
  installed grant, it refuses submission. `authorize(LiveGrant(binding, selection))`, `accept(payload)`, `status()`
  and `close()` separate authorization, the single effect, observation and process ownership.
- `serve(bootstrap, stop, directory)` is an internal Linux socket owner; the fixed submitter CLI accepts no options
  and uses `/run/taki-hindsight/bootstrap.sock`. Only test drivers substitute an owned temporary directory.
- `FakeRestartObserver({ original, adapter, recovery? })` exposes `reconcile()`, `snapshot()` and `close()`.
  Its test adapter has `inspect(resourceId)`, `authorize(original, startupId)` and `submit(grant)`; no create/delete
  method or production transport is supplied. A recovery record carries original IDs, not renewed permission.

### 3. Contracts

- Private input is `[u32 little-endian length][strict UTF-8 JSON]`, at most 4 MiB, followed by EOF. Version 1 binds
  `startupId`, `configurationDigest`, `operationId`, `attemptId`, `authorizationId`, `deadlineAt` and `credentials`.
  Credential entries use only the seven fixed slots and `catalog`, permitted `inherit-default`, or `unused`.
  They must match the independent grant's exact selection; they cannot carry paths, commands, refs or env maps.
- Selected values allow at most 65,536 UTF-16 units and 196,608 UTF-8 bytes. Reject duplicate/unknown keys or slots,
  invalid scalars, NUL and trailing input. Refusal never echoes rejected input or a raw exception.
- Public status stays within 16 KiB, reports safe original identities and fixed reasons, and always has
  `deploymentReady: false`. Failed submitter output uses nil/zero identity placeholders for unadmitted input.
- The grant captures both wall-clock and monotonic bounds, at most the original 90-second admission budget.
  Fence the attempt before invoking the consumer. After consumption, observation of that original process
  outlives the admission deadline; it cannot authorize another injection. Catalog rotation does not revoke
  an already running process. Native shutdown has its separate 30-second TERM budget before forced exit/reaping.
- The fake consumer uses fixed `TAKI_C1B_FAKE_*` variables, minimal child environment, `DEVNULL` stdio and
  `PYTHON_DOTENV_DISABLED=true`. These are test names, not Native provider configuration. Actual dotenv behavior
  is exercised without importing `hindsight_api` before admission; real provider startup remains a later gate.
- Linux checks kernel peer UID, private directory/socket modes, opened/current identity and absolute I/O bounds.
  It never repairs an unsafe directory, removes an unknown old socket, or falls back to a Windows pipe/TCP path.
  Windows anonymous pipes belong only to the process fixtures.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Frame has no independently installed current grant/consumer | `approval-required`; no child |
| Wrong startup/config/attempt/selection or expired grant before dispatch | `snapshot-stale`; no new effect |
| Duplicate submission after the attempt fence | Refuse; inspect the original resource instead of replaying |
| Child may have started but ACK is absent/late or helper dies | Preserve original IDs and report/observe unknown outcome |
| Custody locks/rotates before dispatch | Refuse the pending grant; never pick another Catalog/key |
| Running child outlives admission or Catalog rotation | Preserve read-only original status; no fresh credentials |
| Unsafe socket owner/mode/path or unsupported transport | Closed installation refusal; no fallback or repair |
| Observer closes during a pending wait | Settle the observation without creating/deleting the resource |

### 5. Good/Base/Bad Cases

- Good: a fresh startup receives an independent grant, consumes one exact frame, and a lost reply is reconciled
  against the same resource/operation/attempt. A later startup obtains a new grant and attempt.
- Base: no consumer, unavailable helper/Core/key, or no operator approval leaves Native unstarted.
- Bad: accepting frame fields as their own authority, recovering by reinjection, loading an ambient `.env`,
  or treating a fake observer/status result as Docker deployment readiness.

### 6. Tests Required

Protocol tests assert bounds, exact keys/EOF, Unicode, grant/selection identity, expiry and one-use fencing.
Real process tests assert sentinel absence from argv/status/files, dropped child output, actual dotenv suppression,
lost reply/helper death, child lifetime and owned cleanup. Linux execution separately proves AF_UNIX/SO_PEERCRED,
absolute deadlines/cancellation, process-group/grandchild reaping and shutdown lasting beyond the key-call budget.
Observer tests assert original-ID recovery, fresh attempts, locked/stale grants, single-flight waits and no replay.
Retain red checks, final source hashes and cleanup evidence. An all-platform static type check or a skipped Linux
suite is not Linux execution; process tests do not accept C2 Docker/daemon/tmpfs/database or C3 model behavior.

### 7. Wrong vs Correct

Wrong: rebuild a grant from private JSON or replay `submit` after its reply was lost.
Correct: install the code-owned grant independently, fence before dispatch, and inspect the original IDs after
an uncertain result. Private I/O deadlines bound exchanges; they must not hide a still-running original process.
