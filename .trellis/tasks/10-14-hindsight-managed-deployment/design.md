# C2a managed deployment design

## Decision and scope

Implement one admitted fake-credential deployment from the Windows Shell through the installed Node Host
to the Native bootstrap, then recover observation of that same resource from a durable Host record.
The [contract research](research/c2a-contract-design.md) supplies the exact version-1 field contracts,
source references and recovery matrix adopted here. The PRD controls scope and evidence claims.
The R1/R2 resolutions below take precedence over the earlier research proposal.

Choose the existing Windows x64 Shell and a registered Node 24 helper, co-located with Core/Catalog,
targeting the registered Linux/amd64 Docker endpoint. Source tests substitute the engine adapter and run
the actual fake consumer. C1 Ubuntu credential-service acceptance remains a separate platform gate.

This slice adds no provider mapping, model call, trusted deployment receipt, Core database migration,
existing-volume adoption, generic orchestrator or new third-party dependency. All statuses retain
`deploymentReady: false`; the existing managed-setup refusal remains in place.

## Owners and lifetime

| Owner | Responsibility |
| --- | --- |
| Core deployment owner | Construct the exact plan from current protected registration/configuration, own real Run/Attempt/Effect admission and the live C1 handle, route canonical effects, validate current ownership and accept only settled results. |
| Existing Shell CapabilityRegistry | Share one resident helper between deployment and observation handlers; enforce the current Host permission/control lineage and retain process/artifact/state guards for the Host lifetime. |
| Installed Node Host | Sole writer of its non-secret resource registry, fixed Docker runner, private custody sender and original-resource observer. |
| Native bootstrap owner | Generate startup identity, install an independent grant through fixed owner control, consume one bounded private credential frame and supervise the fixed fake child. |

Home never owns these lifetimes. Shell exit reaps its helper/CLI Job and does not delete Docker resources.
Reconnect retires pending invocations and permits without replay. A dead helper is reopened on demand in
observation-only recovery mode; no automatic restart/recreation loop is added. Preserve the C1 one-shot Job
runner and its existing permission unchanged.

## Public and private contracts

Add a narrow Shared `hindsight-deployment` export and matching Rust protocol. Use the research section 2
schemas for `DeploymentPlanV1`, `CustodyLinkV1`, the create/start/inject union and observation request;
sections 3 and 5 define checkpoint, permit, registration and bounded status. Shared owns public shapes.
Python mirrors only its small owner-control subset. Golden fixtures pin canonical digest bytes and
absence-versus-null behavior across the actual serialization boundary.

The plan fixes original deployment/operation UUID, selected Core/Host/installation, registration digest,
engine ID, immutable local image config ID, configuration digest, `c2a-fake-v1` and fresh named storage.
The logical UUID is distinct from the actual 64-hex Docker container ID. Names and paths are Host-derived.
Do not accept caller commands, environment maps, raw grants, custody handles or receipt JSON.

| Entry | Canonical permission and effect |
| --- | --- |
| `hindsight-deployment` | Host action classifier revision 1; separate `create`, `start`, `inject` cells, each ask/ask/auto and once-only; effect/non-cooperative. |
| `hindsight-deployment-observe` | Fixed owned-read classifier revision 1; auto/auto/auto, respecting overrides and stricter Host constraints; read/cooperative. |
| `memory.hindsight.deployment.start` | Operator supplies an idempotency UUID and expected configuration digest; Core constructs authority and observes repeated original work instead of dispatching again. |
| `memory.hindsight.deployment.observe` / `.resumeStartup` | Operator supplies only the original deployment UUID; observe is read-only, and resume admits a fresh startup attempt for the original resource. |

Increment the canonical registry revision from 2 to 3 and update TS/Rust descriptors, trusted
classification, execute/resume and permission tests together. C2 registration absence omits only C2
capabilities. No model-facing tool or Home setup flow is added.

### Durable idempotency (R1)

Initial start uses `hindsight-deployment:start:v1:<caller-uuid>` as its Run idempotency key and the caller
UUID as its stable `triggerRequestId`. The remaining trigger fields are fixed: `characterId: "taki"`,
`initiator: "primary"`, `deliveryClass: "internal"`, `contextMode: "autonomous"`, and provenance provider
`hindsight-deployment-v1`. Provenance retains that caller UUID in `triggerRequestId` and the original
expected configuration in `sourceRef: "hindsight-config:<sha256>"`. Do not put a random ID, current
timestamp, current generation or fresh deadline in this TriggerRequest. Individual effects retain their
own bounded current control. These fields fit the existing strict Shared Harness schema and Run columns.

Expose a narrow read through the existing `readRunByIdempotency` repository/service seam. Query it before
`RunService.admit` can capture a fresh snapshot, and before C1 preparation. Validate the stored C2
namespace/provenance and original expected-input binding. A match uses the persisted initial Run UUID
as deployment/original operation UUID and only observes; different input under the same key refuses.
Historical lookup must still work when fresh custody/snapshot admission is unavailable. The caller UUID
is a lookup key, never a substitute resource ID. No additional deployment index or migration is needed.

The existing transactional Run uniqueness resolves concurrent admissions. After any admission returns
`reused`, follow only the observation branch: never call start again or dispatch another effect. Keep
an in-process single-flight for the initial owner invocation without treating that map as durable truth.

For explicit startup resume, first read the original Run and inspect its original resource. Use
`hindsight-deployment:startup:v1:<deployment-uuid>:<startup-uuid>` as a stable startup Run key, the Native
startup UUID as its trigger ID, and the original Run as provenance `parentRunId`; retain the same C2
provider/config binding. A genuinely unadmitted waiting startup can receive its first admitted effect.
A reused or already fenced startup request only observes its original attempt, including after Core
restart. C2a adds no retry operation for an already admitted same-startup refusal and never converts an
unknown grant/submission into a fresh attempt. A genuinely new Native startup receives a new key and
fresh Run/Attempt/authority while retaining the original deployment/container/volume.

## Admitted execution

1. Admit the operator Run/Attempt using the existing internal-trigger and EffectLifecycleService paths.
   Retain the original deployment/operation across later startup attempts. C2 refuses missing lifecycle
   authority instead of using the generic legacy no-Run compatibility path.
2. Obtain C1 preparation. The internal `describeAccepted` method validates the WeakMap handle and returns
   copies of the admitted input, actual C1 mapping and deadline. C2 separately retains the real handle;
   the projection is never sufficient authority by itself.
3. Dispatch independently admitted create and start actions with separate effects and Host attempts.
   Persist each step's dispatch fence before invoking the adapter. Start addresses only the recorded
   actual container and returns the Native-generated waiting startup identity.
4. Obtain fresh C1 preparation after external create/start waits, then dispatch inject for the exact
   current resource/startup. Preserve the old deadlines; never refresh an expired snapshot in place.
5. After private value preparation, perform one final Core checkpoint for that live inject pending.
   Validate the actual C1 handle/Catalog revision, config, installation, Host/control, deadline and
   committed matching effect. Consume the checkpoint before returning its one-use startup permit.
6. The Host rechecks current local binding, installs that permit through Native owner control, checks
   its acknowledgement, then sends the existing private C1 frame. Record dispatch before the effect.
   Lost acknowledgements cause observation of the original attempt, never authorize/submit replay.
7. Keep `onIssued` before notification and `onAccepted` after final effect settlement. Revalidate the
   owner after awaits before publishing accepted status. Running only proves the fixed fake child.

The two required broker additions are bounded: a code-owned `ownerCurrent` predicate combined with
existing route currency, and one C2 inject callback reachable only from the authenticated Node method
`host.hindsight.deployment.checkpoint`. It requires the exact live dispatched pending/control/generation,
authorization lineage and committed effect. Unknown, terminal, duplicate, cancelled or other-action
requests refuse. The callback cannot be provided through serialized input or restored from disk.

Shell relays the helper's bounded checkpoint over its current WS connection with a finite per-session
oneshot map, while the reader remains runnable. Closing HostSession settles pending relays. The resident
cannot self-assert `trusted`/`live`. Bind the Native permit to the actual C2 Host attempt, original operation,
startup/config, a fresh Core authorization UUID and the minimum C1/C2 deadline, capped at 90 seconds.

The checkpoint defines dispatch admission; it cannot promise instant revocation after a frame was sent.
Cancellation/drift after dispatch suppresses accepted publication and preserves uncertain state. It does
not erase a running child's environment or make its consumed grant reusable.

## Native and custody boundary

Reuse C1's Catalog decoder, protected registration/current-byte checks and bounded frame sender through
a narrow internal private callback. Core remains the Catalog's sole writer. Values exist only during
private preparation/delivery and inside the intended child environment; no status, argv, registry, log,
Docker exec environment option or persistent config contains them.

**R2:** during C2 private preparation, the Host checks every selected Catalog value against the exact
`C2A_FAKE_[0-9a-f]{64}` format before checkpoint/grant dispatch and before constructing or writing any
credential frame. Inherited values come only from that validated fake default. Any mismatch refuses the
whole injection with a closed value-free reason; do not transform values or select another Catalog.
Native independently checks the same fake-only boundary. C1 public preparation remains unchanged.

Native adds a fixed owner and `/run/taki-hindsight/control.sock` for status or authorize requests only;
the existing `/run/taki-hindsight/bootstrap.sock` and fixed submitter remain the credential path. Both
use the existing same-UID/path/mode/identity rules. Control is u32-LE strict JSON plus EOF, at most 32 KiB;
the existing credential frame cap remains 4 MiB and public status remains 16 KiB. There is no public
reset, arbitrary command, secret-read or TCP control surface.

Only the independent owner-control path creates LiveGrant. The fixed consumer accepts generated
`C2A_FAKE_[0-9a-f]{64}` values, uses the seven fixed slot meanings and OwnedChild, disables dotenv,
discards child output and imports no provider. A fixed internal child may write safe PID/startup/exit
markers in fixture-owned storage. The fake-value format is an input restriction, not authorization.

Ship a dedicated fixture image recipe that installs these modules into the existing Python venv and
selects the fixed owner entrypoint; ordinary Native image targets stay compatible. Do not build it here.

## Registered resources and recovery

Preserve C1 registration version 1. A separate protected deployment registration pins C1 installation,
Core/Host, Docker executable identity, the fixed local Linux-engine endpoint, exact image config ID and
mutable state root. The Shell validates its actual Windows owner/DACL/path/handles. Docker uses a
protected empty client-config directory, explicit host/config argv and cleared environment; never PATH,
ambient contexts, image pull or caller options.

The fixed topology has no ports/network, UID 1000, one new named data volume and an 8 MiB bootstrap tmpfs.
Labels bind original plan/installation/Core/Host/role. Inspect engine/image/container/mount identity at
the relevant effect boundaries. The observer receives only owned inspect and Native status operations.

One registration owns one logical deployment. Its strict `deployment.json` is capped at 1 MiB and 64
startup/attempt records; exhaustion refuses without compaction or forgetting consumed attempts. Persist
plan/registration facts, real resource identities, monotonic revision, step dispatch/results and consumed
startup mappings. Never persist a credential frame, WeakMap handle or reusable permit.

Implementation clarification (2026-10-14): the same registry file is explicitly provisioned with the
strict initial record `{ "version": 1, "revision": 0, "state": "vacant" }`. Only that verified vacant
state can receive the first plan. Missing/corrupt files are unavailable, never an implicit fresh install.
Fixtures provision their own vacant file; production deployment commands add no initializer or second
ledger. This makes the PRD's missing-ownership refusal concrete without an extra persistence mechanism.

The Shell holds one exclusive process-owned state lock; Node writes through private staging, flush and
atomic replacement outside the immutable payload. Require successful fence publication before dispatch.
Test process-crash recovery on Windows; do not claim power-loss durability from directory-fsync fallback.

| Recovered state | Allowed behavior |
| --- | --- |
| Fenced create with lost reply | Inspect only deterministic original names plus exact labels/image/mounts from the existing record; uniquely verified results may be recorded. No repeated create. |
| Missing/corrupt registry or foreign collision | Refuse ownership; no adoption, overwrite or automatic cleanup. |
| Created, start not dispatched | An independently admitted start can target the exact owned ID once. Observation cannot start it. |
| Start/grant/submit dispatched, result unknown | Inspect the same original resource/startup/binding; do not replay the uncertain effect. |
| Genuinely new startup on the original container | Report waiting; explicit resume obtains a new Run/Attempt, C1 preparation and effect/permit. |
| Running child after deadline or Catalog rotation | Continue bounded original-status observation; no second injection authority. |

## Verification, compatibility and delivery

The [implementation plan](implement.md) defines order and checks. The causal integration fixture uses an
actual disk registry and Node helper processes; a test-parent-owned finite engine substitute keeps the
real Python bootstrap/child outside the helper Job. Kill/reopen the helper, load that registry and assert
the same startup/PID is observed with no repeated create/start/submit. Fault injection covers the durable
effect boundaries, actual pending checkpoint provenance and post-await C1 invalidation.
Include repeat/concurrent start, same key with a different digest, lost reply followed by Core DB and
Host registry reopen with fresh custody unavailable, and the same original deployment/no repeated effect.
For R2, non-matching generated test values in selected/inherited paths must produce zero credential-frame
bytes and zero Native submissions, with no value in status/logs; valid fakes still reach the actual child.
Registry tests distinguish explicitly provisioned vacant state from missing/corrupt ownership and assert
that the latter cases dispatch no external effect.

Verify strict TS/Rust shapes, new permission branches, real Run/Effect settlement, sentinel containment,
bounded transport, current-resource recovery, copied-package entrypoint reachability and C1/existing-mode
compatibility. Preserve first failures and owned cleanup. Reuse unchanged accepted C1 evidence.

Rollback is limited to an inverse source patch preserving prior work. Runtime recovery observes owned
resources; deletion/recreation is not a rollback mechanism. No Git lifecycle action is authorized here.
Actual Docker delivery, daemon restart, tmpfs and disposable database persistence require their separate
concrete environment/cleanup plan and approval. C2b receipt consumption and C3 real model mappings follow.
