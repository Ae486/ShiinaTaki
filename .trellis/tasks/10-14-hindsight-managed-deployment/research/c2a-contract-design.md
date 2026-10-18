# Research: C2a executable source contract

- Query: Freeze the smallest executable C2a design before independent artifact review and source dispatch.
- Scope: internal; Taki source and the local Native checkout. Only this report is written.
- Date: 2026-10-14
- Authority: the new task PRD, especially requirements 1-7 and its separate source/Docker/C2b checkpoints. This is a proposed implementation contract, not runtime evidence.
- Path notation: `Host` means `apps/hindsight-host`; `Shell` means `apps/desktop/src-tauri/src`; `Native` means `H:/hindsight/docker/standalone`.

## Findings

### 1. Fixed first topology and owner

Choose **Windows x64 Shell + explicitly registered Node 24 helper + a Linux x64 Docker engine**, with Core/Catalog on that same Windows machine. Ubuntu managed-service support is not in C2a source acceptance. No Windows service, second Node pairing identity or secret broker is introduced.

Add `HindsightDeploymentExec` and `HindsightDeploymentObserveExec`, sharing one `Arc<DeploymentResident>`, to the existing Shell `CapabilityRegistry`. The resident lazily starts a hidden, verified `node .../app/main.js deployment-host --registration <C1 registration> --deployment-registration <C2 registration>`. It retains the protected artifact handles, actual token-user binding and kill-on-close Job for the **Host lifetime**, rather than for one request. Its private stdin/stdout transport is framed, bounded and one-effect-at-a-time. No named listener or operator-selectable subprocess is added.

This fits existing ownership: `Shell/lib.rs:92-102` starts the long-lived client independently of UI state; `node.rs:119-129` gives it an `Arc<CapabilityRegistry>`; `ws_client.rs:54-102` reconnects while preserving those handlers and closes each old `HostSession`. Extend the existing process primitives narrowly: `hindsight_windows/process.rs:55-95` currently kills/reaps the entire Job at the end of **every** C1 invocation and must remain unchanged for C1. A separate resident wrapper owns persistent pipes/Job and per-request deadlines. Before the first private command, assign the Job and verify the child SID as C1 does.

Home closure does not stop the resident. Shell exit stops the helper/its CLI descendants; it does not delete or stop Docker-owned containers. A disconnected Host retires all in-flight invocation flags and permits, but the resident may continue bounded read-only observation. Reconnect never repeats effects. If the helper dies, discard in-memory preparation/authorization; reopen its protected registry in observation-only mode on the next invocation. No unconditional helper restart loop is needed. Login/session loss remains an unavailable custody boundary.

### 2. Types, entry points and canonical permission

Put strict schemas in new `packages/shared/src/hindsight-deployment-schema.ts`, exported through the narrow `@taki/shared/hindsight-deployment` subpath. Rust mirrors them in `Shell/hindsight_deployment_protocol.rs`; Python mirrors only the small Native owner-control subset. Reject unknown keys, explicit null for absent-only fields, invalid IDs/digests and oversize encoded input.

```ts
type DeploymentPlanV1 = {
  version: 1; deploymentId: UUID; operationId: UUID; // deliberately equal for this slice
  coreHostId: UUID; executionHostId: UUID;
  installationId: Sha256; deploymentRegistrationSha256: Sha256;
  engineId: string; imageId: `sha256:${string}`;
  configurationDigest: Sha256;
  consumer: "c2a-fake-v1"; storage: "new-named-volume";
};
type CustodyLinkV1 = {
  input: HindsightCustodyPrepare; // existing safe snapshot/selection projection
  mapping: CustodyAttemptMapping; // actual C1 Core/Host/request IDs, not a new authority
  deadlineAt: IsoTime;
};
type DeploymentEffectV1 =
  | { version: 1; action: "create"; plan: DeploymentPlanV1; custody: CustodyLinkV1 }
  | { version: 1; action: "start"; plan: DeploymentPlanV1; containerId: DockerId; custody: CustodyLinkV1 }
  | { version: 1; action: "inject"; plan: DeploymentPlanV1; containerId: DockerId;
      startupId: UUID; custody: CustodyLinkV1 };
type DeploymentObserveV1 = { version: 1; deploymentId: UUID };
```

`DockerId` is exactly 64 lowercase hex characters; it is never the logical UUID accepted by the C1 fake observer. `Sha256` uses the existing 64-hex schema. `engineId` is a bounded 1-128-character opaque Docker daemon identity. Hash the plan with the existing canonical input encoder, with one fixed deployment-plan namespace; use the same TS/Rust fixture bytes. Resource names are derived by the Host, never request paths or user commands.

| Capability | Classification / policy | Execution |
| --- | --- | --- |
| `hindsight-deployment` | Host classifier `hindsight-deployment-action`, revision 1; cells `hindsight-deployment:create`, `:start`, `:inject`; each `ask / ask / auto`, once-only | `effect`, `non-cooperative`; every action receives its own original sealed control and final Host enforcement |
| `hindsight-deployment-observe` | Fixed Host classifier `hindsight-owned-observation`, revision 1; only `hindsight-deployment-observe:read`, `auto / auto / auto`, once-only if overridden to ask | `read`, `cooperative`; only the one registered owned deployment and bounded safe metadata |

Observation's default auto posture grants neither arbitrary Docker inspection nor credential access. Keep operator governance overrides and stricter Host constraints effective. Increment `GOVERNANCE_REGISTRY_REVISION` from 2 to 3; do not revise the C1 descriptor. Update descriptor advertisement, action classification and execute/resume handling together (`packages/shared/src/governance-registry.ts:13-32`, `Shell/ws_client.rs:618-659,738-763`). C2 missing/unsupported registration omits only these two capabilities. No model tool is added.

Core exposes a small operator service: `memory.hindsight.deployment.start`, `.observe`, `.resumeStartup`. `start` accepts an idempotency UUID and expected configuration digest; the Core owner constructs the plan from protected registration/current config. `observe` and `resumeStartup` accept only the original deployment UUID. No caller supplies a CustodyLink, Host control, permission, Native grant, resource path or receipt. An idempotent repeated start observes its existing operation rather than executing again.

### 3. Core admission and the strictly C2-local final check

Implement `createHindsightDeploymentOwner` beside the custody owner, composed after `RunService` exists. Its operator effect methods use existing `RunService.admit/start/settle` and actual `EffectLifecycleService`; they never invoke an LLM. Use the explicit internal-trigger pattern in `server/methods/capability-trigger.ts:79-92,114-121`, not its development flag/tool bag. The admitted initial Run UUID is the deployment/original operation UUID. A later startup uses a fresh admitted Run/Attempt while retaining that original operation UUID. Missing Run/Attempt/effect authority refuses C2; do not take the compatibility bypass in `capability-effect-lifecycle.ts:10-18,61-78`.

Extend the **internal** C1 owner with `describeAccepted(evidence): CustodyLinkV1 | null`. It first validates the original WeakMap entry, then returns copies of the admitted input, actual mapping and original deadline. Its existing public preparation method still returns status only. The C2 owner retains the actual `AcceptedCustody` object separately in its live admission record; neither the copied projection nor a restored registry record can pass `custody.validate`. See `hindsight-custody-owner.ts:53-91,96-150` and `boot/hindsight-custody-boot.ts:31-56`.

Flow:

1. Admit the Core Run and current configuration/registration; obtain a real C1 accepted preparation. Record its actual operation/attempt/control mapping.
2. Route `create`, then `start`, through canonical Host preflight/Approval/intent/execute. Each action gets a fresh effect and Host attempt. `create` returns inspected owned volume/container identities; `start` starts only that recorded container and returns Native's actual startup identity in waiting state.
3. Obtain a **fresh** C1 preparation for injection after those external waits; do not upgrade an expired preparation inside an old attempt. Route `inject` with the exact observed container/startup and the new CustodyLink.
4. The Host validates the resource, resolves the selected fake values privately, and asks the Core for one final injection check before granting Native startup or sending values. The Core checks the original live C1 handle, private Catalog revision/ABA, config, Host/installation, deadline and current C2 effect. Only then does the Host install the independent Native grant and submit the existing private frame.
5. Preserve issued mapping synchronously before notify and consume only the final settled result. `capability-broker-state.ts:99-120` already invokes `onAccepted` after `settleHostEffect`; do not move it earlier. Revalidate the owner after every await before publishing accepted status. No C2a accepted result is a deployment receipt.

Two narrow broker changes are required:

- Add a code-owned `ownerCurrent?: () => boolean` routing option. C2 effects require it, and the target currency predicate combines it with the existing Host/catalog/policy check. Use it before initial notify, before execute/resume after intent persistence, at the final injection checkpoint and at acceptance. It cannot deserialize from caller input. Existing capabilities keep their behavior. Current routing only checks Host/catalog/policy (`route-capability.ts:112-122`); challenge/resume already have currency checks (`capability-challenge.ts:45-67,159-196`).
- Add **one C2-specific pending callback**, `beforeHindsightInjection(checkpoint): NativeStartupPermitV1`, and broker method `authorizeHindsightInjection(params, provenance)`. A new Node-only method `host.hindsight.deployment.checkpoint` delegates to it. Require the exact live pending `hindsight-deployment`/`inject` request/control, current authenticated Host generation, actual authorization lineage, `targetDispatched`, committed matching Effect and owner callback. Reject unknown, terminal, cancelled, duplicate and wrong-action requests. Mark the checkpoint consumed before returning its permit; retain no reusable ticket service or persisted grant. Ordinary Host requests cannot call this path.

```ts
type InjectionCheckpointV1 = {
  version: 1; requestId: UUID; control: HostOperationControl;
  authorization?: CapabilityAuthorizationLineage;
  checkpointId: UUID; deploymentId: UUID; containerId: DockerId;
  startupId: UUID; configurationDigest: Sha256; custodySnapshotId: UUID;
};
type NativeStartupPermitV1 = {
  version: 1; checkpointId: UUID;
  binding: { startupId: UUID; configurationDigest: Sha256; operationId: UUID;
    attemptId: UUID; authorizationId: UUID; deadlineAt: IsoTime };
  selection: HindsightFixedSelection;
};
```

The permit binding uses the **actual C2 Host attempt ID**, original C2 operation ID and a new Core-minted startup `authorizationId`. That startup ID is distinct from optional canonical ask-approval lineage; persist both associations as safe facts. `deadlineAt` is the minimum of the actual C1 and C2 deadlines, never more than 90 seconds. The callback reuses the owner's live record rather than trusting checkpoint fields. Payload/result limits are 32 KiB / 16 KiB, including wrappers.

Shell connects this one call through the current WebSocket session: its blocking executor can request the checkpoint while `execute_with_context` leaves the socket reader runnable (`ws_client.rs:604-615`). Use a per-session bounded oneshot response map, keyed by fresh request ID and original invocation; close it when `HostSession` closes. Thread the non-deserializable C2 checkpoint callback through `TrustedHostInvocationContext`. Node resident emits one bounded checkpoint request over its inherited pipe; Rust supplies the authenticated context and relays only the matching result. No Node-supplied `live`/`trusted` boolean authorizes work.

The final permit is the injection dispatch admission point, not an instant revocation guarantee. Recheck Host live flag, deadline, opened/current Catalog bytes, resource/startup and installation after local awaits and before writing the private frame. A change or cancellation after dispatch keeps an uncertain effect unknown and prevents accepted publication; it does not replay or claim to erase an already-running child's credentials. This matches C1's existing admission-versus-observation boundary.

### 4. Native owner and private delivery

Add `Native/managed_bootstrap/owner.py` with fixed `C2BootstrapOwner`, constructing `Bootstrap(configurationDigest, C2FakeConsumer())`. Native generates `startup_id` itself as today (`bootstrap.py:63-89`). Add `control.py`, accepting **no CLI options**, for fixed local owner control at `/run/taki-hindsight/control.sock`. Keep the existing credential submitter and `/run/taki-hindsight/bootstrap.sock` unchanged. Both sockets use the same kernel UID, 0700 directory, 0600 leaf, identity/deadline rules; any shared path helper accepts only the two fixed internal socket kinds, never a caller path.

`BootstrapOwnerRequestV1` is exactly `{version:1, action:"status"}` or `{version:1, action:"authorize", permit:NativeStartupPermitV1}`. Control framing is u32-LE length + strict UTF-8 JSON + EOF, at most 32 KiB; reply is the existing bounded safe bootstrap status. Only the owner control path constructs `LiveGrant(permit.binding, permit.selection)` and calls `Bootstrap.authorize`; the credential frame cannot select that path or install authority. Refuse a second grant, wrong startup/configuration, expired binding and unsupported keys. There is no reset, arbitrary command, stop, secret-read or TCP API.

Use the exact registered container ID and fixed executable `/app/api/.venv/bin/python -I -B -m managed_bootstrap.control`, then `... managed_bootstrap.submitter`, through **no-TTY** `docker exec -i`. The grant request and existing 4 MiB maximum private credential frame are separate inputs to separate fixed programs. The Host must read the grant acknowledgement and compare the exact binding before value delivery. Lost acknowledgement never triggers blind authorize/submit replay. OS/container administrators and the credential-owning UID remain trusted, as in C1; JSON alone is not a new authentication mechanism.

`C2FakeConsumer` has one fixed seven-slot environment mapping, preserving C1 inheritance/unused semantics. Accept only generated sentinel strings matching `C2A_FAKE_[0-9a-f]{64}` before launching the child; this is a fake-data constraint, not permission proof. Reuse `OwnedChild`, rebuilt minimal environment, `PYTHON_DOTENV_DISABLED=true` and discarded child stdout/stderr. Launch a fixed internal fake-child module, with no provider imports, network use or command argument from input. It writes only safe PID/startup/exit evidence in fixture-owned storage. Existing C1 fixture modes and tests remain unchanged. The consumer's bounded child status is the observable result; it is not Native API/model health.

For later Docker testing, add a dedicated **fixture image recipe**, leaving ordinary Native targets unchanged. It copies this package into the existing Python 3.11 venv's site-packages and selects the fixed owner module as entrypoint. Current Native `Dockerfile:179-199` provides `/app/api/.venv` and UID-1000 pg0 volume seed ownership, but `:268` still starts `/app/start-all.sh`; the repository module alone is not installed. Do not build/pull the fixture image during the authorized source checkpoint.

### 5. Registration, registry and fixed Docker adapter

Keep C1 `installation.json` version 1 unchanged. Add protected sibling `deployment-registration.json` on Core and Shell, outside the payload, parsed as `HindsightDeploymentRegistrationV1`:

```ts
{
  version: 1; installationId: Sha256; coreHostId: UUID; executionHostId: UUID;
  docker: { path: AbsolutePath; sha256: Sha256; version: BoundedString;
    endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine"; engineId: BoundedString };
  image: { id: `sha256:${string}`; os: "linux"; architecture: "amd64";
    consumer: "c2a-fake-v1"; bootstrapVersion: 1 };
  stateDirectory: AbsolutePath;
}
```

This freezes a supported endpoint contract; it does not assert that the endpoint/image is currently available. Pin the Docker executable with the same Windows file/parent/SID/DACL checks as the runtime. A registered empty client-config directory under the protected state root prevents ambient Docker contexts/configuration; use fixed `--config` and `--host` arguments with a cleared environment. Never search PATH, select a different engine, invoke plugins/credential helpers, pull an image, or expose arbitrary Docker options. Verify engine ID, Linux/amd64 image ID and actual returned container image/mounts before effects and after waits. Local immutable image **config ID** and any future registry manifest digest are different identities.

The adapter has only `inspectEngine`, `inspectImage`, `inspectOwned`, `createVolume`, `createContainer`, `startContainer`, `control`, and `submit`. An observer receives only `inspectOwned/control(status)`. Names are fixed from the logical deployment UUID: `taki-c2a-<uuid>` and `taki-c2a-<uuid>-data`; labels bind Core/Host/installation/deployment/plan digest and role. For the fake topology, expose no ports; use UID 1000, no network, a fresh named volume at `/home/hindsight/.pg0`, and an 8 MiB protected tmpfs at `/run/taki-hindsight`. Only safe configuration digest reaches container creation environment. No exec environment options carry credentials. Actual daemon/container semantics remain unproven until the separate experiment.

The first registration owns **one** logical deployment. `stateDirectory/deployment.json` is a strict versioned record capped at 1 MiB, with at most 64 startup/attempt records; exhaustion refuses new work. No retention/compaction service or cleanup API is added. Its fields are: registration/plan digests and plan; original Core/Host mappings; monotonically increasing record revision; actual container ID and inspected volume name/driver/labels; step records for volume-create/container-create/start; and startup records with actual startup/attempt/authorization/control IDs, checkpoint/dispatch state and safe observed result. No credential, private frame, WeakMap handle or reusable permit is persisted.

The Shell holds an exclusive process-owned lock file handle for this state root; Node is the sole registry writer through that resident. Protect the mutable root with a rename-compatible parent guard, not the immutable payload's no-write file guards. Publish a complete sibling staging file with create-only private permissions, flush, and atomic replace; require successful persistence before any external dispatch. Reuse the established publication pattern while testing actual Windows process-crash behavior; do not claim power-loss durability from directory-fsync fallback (`packages/core/src/secrets/catalog-publication.ts:16-35,63-75`). Every reopened existing record starts in inspect-only mode, regardless of its last optimistic status.

| Boundary / uncertainty | Required recovery |
| --- | --- |
| Before any effect | Persist the exact plan and then that step's dispatch fence. Failed persistence means no dispatch. |
| Volume/container creation reply lost | Inspect only deterministic original names and exact labels/image/mount identity from the existing record; record a uniquely verified actual result. Ambiguous/missing result stays unknown. Never issue create again for that fenced step. |
| Existing resource but absent/corrupt registry, foreign name/label collision | Unavailable/ownership conflict; no adoption, overwrite or deletion. Labels alone are not an ownership record. |
| Container created; start not dispatched | A separately admitted `start` may proceed once against that exact owned ID. Observer cannot start it. |
| Start dispatched, reply lost | Inspect that container and Native's real startup. Record waiting/running if verified; otherwise unknown. Never repeat start automatically. |
| Injection preparation/checkpoint refused before dispatch | Discard values/permit; preserve safe refusal. A later explicit fresh attempt must revalidate from current custody. |
| Checkpoint reply, grant ACK or credential ACK uncertain | Retain original attempt/startup and any dispatch fence. Inspect the same startup/accepted binding; do not reconstruct authority or repeat grant/submission. |
| Container restarts with a genuinely new startup UUID | Retain original container/volume/operation; report waiting. Core `resumeStartup` creates new Run/Attempt, custody and effect authorization. Old ACK/grant cannot apply. |
| Admission expires after a child runs | Continue bounded original-status observation. Expiry/rotation does not revoke that child or grant a second submission. |

`DeploymentStatusV1` is a strict <=16 KiB union with original deployment/operation/configuration, actual known resource/startup/attempt IDs, `state = waiting | running | stopped | unavailable | outcome-unknown`, optional closed refusal, and literal `deploymentReady:false`. Extend the C1 refusal set only with `ownership-conflict`, `engine-mismatch`, `artifact-mismatch`, `registry-unavailable`, `registry-full`. Do not place raw inspect output, stderr or rejected input in status.

### 6. Source ownership, reachability and acceptance

One cohesive implementer owns the following coordinated scope; Root owns task/spec/handoff artifacts. C1 service-preflight files remain with their checker.

| Files | Change |
| --- | --- |
| Shared `hindsight-deployment-schema.ts`, narrow export, `governance-registry.ts`, protocol fixtures; Shell `hindsight_deployment_protocol.rs`/`protocol.rs` | The exact plan/effect/observation/checkpoint/registration/status contracts and TS/Rust parity. |
| Core `memory/hindsight/hindsight-deployment-owner.ts`, `boot/hindsight-deployment-boot.ts`, `main.ts`; internal addition to `hindsight-custody-owner.ts` | Real Run/Effect admission, original custody mapping, three operator methods, owner currency and safe shutdown. No OS effects in Core; no new DB migration/receipt ledger. |
| Core `capabilities/route-capability.ts`, `capability-observers.ts`, `capability-broker.ts`/state, focused C2 checkpoint module and Node method | Required owner guard and the single pending-inject callback/response path; preserve final settlement ordering. |
| Shell `hindsight_deployment.rs`, narrow resident process/state guard modules; `node.rs`, `ws_client.rs`, `capabilities_impl.rs` | Registered Windows resident, final gate on execute/resume, current-session checkpoint relay and bounded private frames. Preserve C1 one-shot invocation. |
| Host `src/deployment-host.ts`, `deployment-owner.ts`, `deployment-registry.ts`, `docker-adapter.ts`, private fixed credential sender; `main.ts` | Concrete create/start/inject/observe chain and real registry consumer. Reuse C1 decode/path checks without changing public C1 results; do not merely relabel its fake observer as production. |
| Host `scripts/build.ts` and packaging tests | Main imports the C2 entry; import traversal includes actual owner/adapter dependencies. Retain locked dependency checks and no source-checkout resolution. No service installation or packaging framework. |
| Native `managed_bootstrap/owner.py`, `control.py`, fixed fake consumer/child; focused fixture driver and image recipe | Independent grant installation, actual child/status, fixed private delivery and finite process ownership. No public Native HTTP API/OpenAPI/client regeneration. |

Source tests must execute a real fake child and actual on-disk registry. A test-parent-owned finite fake Docker engine keeps the Python bootstrap/child alive outside the helper's Job. Run the actual Node deployment owner in fixture child processes with a code-injected adapter over inherited private pipes; stop the first helper, reopen the same registry with a second, and prove it observes that same still-running startup/PID without create/start/submit replay. Test-only constructor injection is not a production environment switch, permission bypass or transport claim. The fixed Windows pipe fixture exercises the same Python owner/LiveGrant/consumer functions; actual Unix peer/tmpfs and Docker exec claims remain separate.

Required checks: actual canonical ask/deny/auto and execute/resume; real Run/Effect settlement including failed final settlement suppressing accepted evidence; caller JSON/old C1 handle/foreign Host checkpoint rejection; Catalog ABA after private preparation but before checkpoint; pending expiry/duplicate/lost checkpoint; crash at each durable fence/result boundary; strict malformed/null/Unicode/cap/EOF fixtures; actual child and reopened state; no sentinel in public frames/argv/env options/registry/logs; packaged C2 reachability outside the checkout; no-helper C1/existing-instance compatibility. Use focused changed-package checks, bounded Vitest workers and the serial heavy slot. No unchanged full-suite rerun is required merely because C2 exists.

**C2a source completion:** concrete causal fake-process/registry path, protocol/current-owner correctness, packaging reachability and independent source review. **Still open:** actual Docker no-TTY/metadata/daemon/tmpfs behavior, actual database shutdown and persistence, final installed platform acceptance. **C2b later:** durable Core accepted deployment ledger and `receiptRef` consumption. Keep `hindsight-setup-service.ts:212-223` refusing managed setup; no source result sets readiness or activates memory.

## Related specs and external references

- `.trellis/spec/backend/hindsight-host-custody.md`, especially C1 read-only authority, private limits and original-resource observation.
- `.trellis/spec/backend/host-operation-lifecycle.md:73-95,263-269`; `.trellis/spec/backend/permission-authorization.md:237-255`.
- Previous task `research/c2-next-slice-readiness-2026-10-14.md` supplies the accepted stage boundary; this document resolves its implementation choices.
- Existing local dependency line only: Node 24, Python 3.11+, python-dotenv 1.2.2, the locked Host dependencies. No external documentation fetch, dependency, Docker SDK, actual engine/image selection or download occurred.

## Caveats / Not Found

- Current C1 contains no resident Windows deployment owner, Docker registry, release Native owner-control endpoint or C2 admission guard. These are specific proposed source changes, not already installed facilities.
- The proposed final check is restricted to one live C2 injection effect; it must not grow into a generic authorization service or grant-restoration mechanism.
- Root must review the frozen contracts before activating implementation. C1 AC2/6 remain open independently. This report performs no source edit, test/build, environment operation, task-state change or Git action.
