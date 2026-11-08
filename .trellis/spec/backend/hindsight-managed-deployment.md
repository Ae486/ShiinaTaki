# Hindsight managed deployment (C2a)

## 1. Scope / Trigger

C2a runs one fixed fake-credential consumer through the co-located Windows Shell and installed Host,
then observes the original resource after interruption. Core owns Run/Attempt/Effect admission and
the live C1 custody handle; Shell owns the resident helper and installation/state guards; Node owns
the non-secret deployment registry; Native owns the startup, independent grant and fixed child.
Home owns none of these lifetimes. C1 custody permission remains read-only.

This is the source/fake-process contract. Actual Docker, disposable database, C2b receipt consumption
and C3 provider/model acceptance are separate gates. Every public status has `deploymentReady: false`;
managed setup continues to refuse. See the [task](../../tasks/10-14-hindsight-managed-deployment/prd.md)
and its [current evidence](../../tasks/10-14-hindsight-managed-deployment/research/leader-now.md).

## 2. Signatures

Shared's `@taki/shared/hindsight-deployment` subpath owns the strict schemas; Rust mirrors the Shell
protocol and Python only its owner-control subset. Extra keys and explicit nulls for absence-only
optional fields refuse. Do not add local parallel message definitions.

| Entry | Input / authority |
| --- | --- |
| `memory.hindsight.deployment.start` | Operator `{ idempotencyKey: UUID, expectedConfigurationDigest: SHA256 }`; Core constructs the plan. |
| `memory.hindsight.deployment.observe` | Operator `{ deploymentId: UUID }`; original-resource read only. |
| `memory.hindsight.deployment.resumeStartup` | Operator `{ deploymentId: UUID }`; a genuinely new waiting startup receives fresh admission. |
| `host.hindsight.deployment.checkpoint` | Current authenticated Node, exact `InjectionCheckpointV1`, live pending inject and committed Effect. |
| `hindsight-deployment` | `DeploymentEffectV1` with `create`, `start` or `inject`; canonical registry revision 3, classifier revision 1, separate `ask / ask / auto`, once-only effect cells. |
| `hindsight-deployment-observe` | `DeploymentObserveV1`; revision-1 owned-read classifier, `auto / auto / auto`, respecting overrides and stricter Host constraints. |

`composeHindsightDeployment` registers the operator/checkpoint methods in Core boot. The installed
`serveDeploymentHost` composes the concrete registry, fixed Docker adapter and owner. Native's fixed
`managed_bootstrap.owner`, `.control` and `.submitter` entries take no caller command/path/env options.
The older C1b `FakeRestartObserver` remains a separate internal prototype.

## 3. Contracts

### Original identity and admission

`DeploymentPlanV1` binds version 1, equal `deploymentId`/`operationId`, Core/Host IDs, installation and
registration digests, exact engine ID, immutable `sha256:<64 hex>` image ID, configuration digest,
`consumer: "c2a-fake-v1"` and `storage: "new-named-volume"`. The original deployment UUID is the first
persisted Core Run UUID; it is distinct from the actual Docker container ID and the caller lookup key.

The start Run key is `hindsight-deployment:start:v1:<caller UUID>`. Its stable TriggerRequest retains
that UUID, fixed internal/autonomous provenance and `sourceRef: hindsight-config:<expected digest>`.
Query the existing durable Run before fresh snapshot admission or C1 preparation. Repeated/reused
admissions observe the original deployment; changed input under the same key refuses. An in-memory
single-flight is not durable idempotency. No additional Core ledger or migration is needed.

Run snapshot capture enriches its `InteractiveOperator` with Run metadata. Give C2 admission its own
top-level copy, keeping that mutation out of C1's independently owned custody attempt; otherwise the
real capture path can combine a C2 Run ID with a C1 Attempt ID. Regression fixtures must model that
existing capture behavior, not silently omit it.

The startup Run key is `hindsight-deployment:startup:v1:<deployment UUID>:<Native startup UUID>`.
Keep the original Run as provenance parent. An already admitted/fenced startup only observes, including
after restart; C2a has no retry interface for that same startup's refused or uncertain admission.

Create, start and inject use separate admitted Effects and exact Host attempts. `CustodyLinkV1` carries
the actual C1 mapping and deadline, but never substitutes for Core's WeakMap-backed `AcceptedCustody`.
After external create/start waits, obtain fresh preparation for injection instead of refreshing a stale
handle. The final checkpoint consumes one live pending authorization bound to actual Host generation,
request/control/Effect, resource/startup, C1 snapshot revision and configuration. It cannot be restored
from JSON. `onIssued` precedes notification; `onAccepted` follows final canonical settlement.

Check applicable owner/control currency before committing the Effect outcome. After dispatch,
lost responses, cancellation or currency drift suppress accepted publication and preserve uncertainty.
Consume the actual `RunStatusResult`: a non-throwing settlement can return another attempt or terminal
outcome, including cancellation. It cannot be treated as acceptance of the preceding successful result.
Internal `outcome_unknown` maps to the public `outcome-unknown`; neither permits replay.

### Private delivery and installed resources

Host validates every selected value against `^C2A_FAKE_[0-9a-f]{64}$` before checkpoint/grant dispatch
and before constructing or sending a credential frame. Inherited defaults use the same validated value.
Native independently enforces fake-only input. Core remains the sole Catalog writer. Values do not
enter public responses, argv, Docker environment options, registry, config or logs.

Native generates its startup UUID. `/run/taki-hindsight/control.sock` accepts only status or an independent
startup permit; `/run/taki-hindsight/bootstrap.sock` retains C1 private delivery. Both retain the existing
peer UID, owner/mode, current-path and bounded-I/O checks. The permit binds original operation, actual
Host attempt, startup/configuration, fresh authorization UUID and the minimum admission deadline.
Native grants remain one-use; observing a running child may outlive that deadline or Catalog revision.
The fixed fake consumer suppresses dotenv and child output and imports no provider.

The separate protected deployment registration pins the C1 installation, Core/Host, Docker executable
hash/version, `npipe:////./pipe/dockerDesktopLinuxEngine`, immutable Linux/amd64 image and mutable state
directory. The Shell validates Windows identity/DACL/path/retained handles and holds one exclusive
process-owned state lock. The Node helper uses fixed absolute Docker argv, a protected empty
`docker-config` directory and a cleared environment; no ambient context, pull or caller options.

`DeploymentInstallation::drop` must take/drop its resident process before its state lock and
installation guards are released. Rust's default field destruction order can otherwise admit a
second Shell while the old helper is still a writer. Keep those guards through Job termination and
helper/reader wait; do not replace this ordering with a new lock or recovery mechanism.

The fixed topology uses UID/GID 1000, no network/ports, one new named volume at `/home/hindsight/.pg0`
and an 8 MiB private tmpfs at `/run/taki-hindsight`. Names are derived from the original deployment UUID;
labels bind deployment, Core, Host, installation, plan digest and role. Verify original engine, image,
container and mount identities at effect/observation boundaries. Observation has no create/delete path.

### Durable state and bounds

The installer/fixture explicitly provisions the same `deployment.json` with
`{"version":1,"revision":0,"state":"vacant"}`. Only that verified vacant state accepts the initial plan.
Missing, corrupt or externally changed state is unavailable; there is no automatic initializer, repair,
second ledger, adoption or cleanup of unknown resources.

Publish intent/fences before the corresponding external calls. Persist safe original facts, monotonic
revision, step results and consumed startup/attempt mappings through private staging, file flush and
atomic replacement. A persisted authorization ID is a historical reference, not a reusable permit.
The registry is at most 1 MiB and 64 attempt records; exhaustion refuses without compaction or forgetting
consumed attempts. Windows process-crash recovery does not claim power-loss durability.

Control/resident requests are at most 32 KiB, public status 16 KiB and the C1 credential frame 4 MiB.
Admission never exceeds the original 90 seconds. Preserve C1's separate 30-second Native shutdown
budget; a short private exchange must not shorten owned-child shutdown/reaping.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing C2 registration or lifecycle authority | Omit/refuse C2 effects; retain C1 and existing-instance behavior. |
| Wrong engine/image/installation/resource or foreign collision | Closed mismatch/refusal; no adoption, replacement or deletion. |
| Missing/corrupt/changed registry | `registry-unavailable`, no external effect; never interpret it as vacant. |
| Non-fake selected or inherited value | Closed value-free refusal before checkpoint/grant/frame; zero private bytes/submissions. |
| Stale C1/config/control before dispatch | Refuse without a new effect or an in-place authority refresh. |
| Current request has a dispatch fence but final outcome cannot be accepted | Preserve `outcome-unknown` and original IDs; no accepted publication or replay. |
| An unrelated old attempt has a fence | Do not use it to relabel a new pre-dispatch refusal as dispatched uncertainty. |
| Run repository retains another attempt/terminal outcome or converts to cancelled | Do not report the preceding successful Host status as accepted execution. |
| Repeated start, reused startup Run or lost reply after restart | Read the same original Run/registry/resource; no repeated create/start/grant/submit. |
| Same running startup after expiry | Bounded original observation only; a genuinely new startup requires fresh authority. |

## 5. Good/Base/Bad Cases

- Good: an admitted fake-only startup reaches the real child; killing the helper and reopening Core/Host
  state recovers the same resource/startup/PID without another effect.
- Base: a registered but explicitly vacant installation waits for an admitted plan; missing authority
  or a pending approval produces a closed refusal and leaves the resource untouched.
- Bad: use a supplied receipt/serialized custody handle as authority, replay an uncertain submission,
  or treat a running fake child/volume marker as database, model or deployment readiness.

## 6. Tests Required

Use actual Run/Effect repositories for stable admission, concurrent repeats, different-input rejection,
DB reopen without fresh custody, final cancellation/attempt checks and checkpoint consumption. Assert
stale Catalog/ABA after dispatch suppresses acceptance and preserves unknown outcome without replay.

Use a real temporary registry, real Node helper and fixed Python child with a bounded substituted engine.
Exercise create/start/submit interruption, original-ID observation, fresh-startup authority, fake-only
rejection before delivery, sentinel containment and process cleanup. A copied protected installation
must reach the concrete Shell/Host entry; compilation alone does not prove installed reachability.
Retain strict TS/Rust protocol/permission cases, affected types/lint and changed Native checks.

Record first failures, final inputs and owned cleanup. A substituted engine is not actual Docker;
Windows pipes are not Linux sockets; process/volume markers are not a database. Reuse unchanged C1
evidence and avoid repeating the same full fault matrix at every layer.

Task-local real-image inspection must read optional Docker map fields with `index`, including
`index .Config "Volumes"` and `index .Config "Cmd"`; a legal empty field may be omitted entirely.
If an image build exited successfully and only its readback failed, preserve that failure and inspect
the original iidfile/image/tag/labels/base-layer lineage. Do not rebuild or adopt by name to repair
an observation error. Application/tokenizer artifact evidence remains separate from API/PG/Host readiness.

## 7. Wrong vs Correct

Wrong: admit a fresh snapshot before looking up the original request, then resubmit after a timeout;
accept the Host's successful payload merely because `runs.settle(...)` did not throw.

Correct: read the durable Run first, retain the original resource, fence every effect and observe after
uncertainty; inspect the canonical settlement result before publishing accepted success.
