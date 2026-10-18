# C2a isolated Docker recovery plan

Date: 2026-10-15. Owner: `c2a_recovery_implement`. Status: independent design PASS; fixture implementation authorized, no runtime result.

Read [the accepted review](c2a-recovery-design-review.md) for binding reconnect, outcome-field and
identity clarifications. Root released stage 2 after that review; its interpretation governs the
corresponding assertions below.

The owner approved isolated recovery, disposable-database validation, then C2b. This plan covers only
the first recovery slice. Root owns preparation/runtime/cleanup and task metadata; implementation starts
after Root releases stage 2. Keep the 109 accepted production inputs, 182-test source result, four older
ignored C1 fixtures, frozen first-case directory and both evidence archives unchanged.

## Decision

Use one fresh deployment for three consecutive observations: lose its exact Host inject completion,
hard-stop the isolated Shell/helper and Core, then reopen their original directories; restart only that
owned container; explicitly resume its new Native startup. No production change is presently necessary.

The lost reply is **Shell/Host completion -> Core**, after Native consumed the private submission but
before Core accepts the completion. It is not a lost Native socket acknowledgement. The existing image
has no deterministic external pause between `bootstrap.accept()` and socket ACK. Polling the registry
and racing `docker.exe` termination cannot prove that interval; do not use that race or add a Native
fault option, alternate image consumer, proxy for private credentials, or new recovery framework.

| Case | Deterministic control | Required observation |
| --- | --- | --- |
| Host completion loss and real process interruption | Hold the exact inject completion in the existing test WS relay; close the relay before it can forward; terminate only captured fixture processes. | Core settles the original attempt as unknown; the same actual Native child remains alive. |
| Core/Host reopen | Start new Core/Shell processes using the same intact Core database, Catalog, node data, registration, payload and registry. | Same-key start and explicit observe return the original deployment/container/startup/child without another C2 effect. |
| Owned container restart | One bounded `docker restart --time 35 <recorded container ID>`. | Original container/image/volume persist; Native creates a different startup, fresh tmpfs, and no child before explicit resume. |
| New startup admission | One operator `resumeStartup({ deploymentId })`, then one repeat. | One new startup Run/Attempt/Effect, fresh custody/checkpoint/authorization, one submission; the repeat only observes. |

Inner Native grant/submit ACK loss, interruption inside create/start/submit, shared daemon restart,
custody rotation/unavailability and actual database persistence remain outside this slice's claims.
Their accepted source/process evidence is retained; this plan does not convert it into Docker proof.

## Existing executable seams

Source paths below are relative to Taki unless prefixed `Native:` (`H:/hindsight`);
`research/` paths are relative to this task.

| Source | Reuse and constraint |
| --- | --- |
| `research/docker-acceptance/run-first-case.ts:81-146,255-303` | Protected installation, real Core/Shell/operator bootstrap and exact resource cleanup patterns. Its top-level launcher is single-use and cannot be imported; leave it frozen. |
| `apps/hindsight-host/src/deployment-test-fixtures.ts:23-72` | Provision generated fake Catalog/initial vacant state once. Never call it during reopen: it would overwrite the registry. Its synthetic invocation/custody values are not submitted. |
| `e2e/src/fixture/ws-relay.ts:73-101,153-185` | Existing loopback relay and in-memory request/response callbacks. `close()` synchronously closes both sockets before its first await; `forwardToCore` cannot send or queue a response on the terminated upstream. No shared relay change is required. |
| `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts:39-94,154-206` | Durable original Run lookup before custody; observation; stable per-startup key; fresh admission; canonical settlement rather than trusting a successful payload. |
| `packages/core/src/harness/run-service.ts:72-109`; `packages/core/src/harness/recovery-coordinator.ts` | Reuse actual Run/Effect storage and ordinary boot recovery. Do not write fixture settlement rows or introduce another ledger. |
| `apps/hindsight-host/src/deployment-owner.ts:53-64,98-134,188-219` | Original-resource inspect; same-startup injection fence; bounded observation with unchanged consumed attempt facts. Reads may advance registry revision. |
| `apps/hindsight-host/src/deployment-injection.ts:26-69`; `deployment-registry.ts:53-100` | Existing checkpoint/grant/submit fences and actual disk reopening. Retained authorization IDs are historical facts only. |
| `apps/desktop/src-tauri/src/hindsight_windows/deployment.rs:23-28,66-93` | Exclusive state lock, helper Job lifetime and opening the installed resident on demand. Reap the first Shell/helper before opening the second Shell. |
| `Native: docker/standalone/managed_bootstrap/owner.py:22-60`, `bootstrap.py`, `fake_child.py:39-55` | Native-generated startup, independent one-use grant and real finite child. The old child writes a safe stopped marker during graceful restart. |
| `Native: docker/standalone/managed_bootstrap/unix_socket.py:182-210`; `control.py:120-140` | Inner ACK loss is distinct and has no external deterministic hold control. |
| `Native: docker/standalone/Dockerfile.c2a-fake` | Rebuild the unchanged tiny recipe/package over the exact cached base with one fresh label/tag; no provider/database substitution. |

The semantic `jbcontext` query returned no visible hits. Exact lookup under the already named E2E
fixture directory located the reusable relay; its implementation was read directly.

## Planned files

Only this plan is written in stage 1. Stage 2 adds the following task-local files:

1. `research/docker-recovery/run-recovery.ts`: one fixed sequence using the existing fixture, relay,
   process, schema, registry and Docker helpers. Carry over only required first-case preparation,
   containment and cleanup; do not rerun its complete acceptance matrix as a separate case.
2. `research/docker-recovery/recovery-probe.py`: a bounded, fixed-path fixture probe for a non-secret
   persistent marker, a tmpfs marker, socket/mount facts and the actual fake-child process identity.
   It has only fixed seed/read steps, delivered by private stdin to the owned container's existing Python.
   It never reads environment/memory or writes credentials, grants, registry or application data.
3. `research/docker-recovery/README.md`: reviewed token, exact inputs/commands, bounds and evidence/cleanup manifest.

Reuse Root's archived `command-runner.mjs` and preparation records. Do not create another preparation
framework. Use the existing `container-scan.py` unchanged when a child is running; its mandatory live-child
check is unsuitable for the new startup's pre-resume state. No edits to production, existing fixtures,
specs, scripts/templates, schemas, dependencies or migrations are proposed.

## Concrete resource manifest

| Resource | Binding / bound |
| --- | --- |
| New case token | `f217a02f-f8a5-466f-ab59-0e97940debe0` |
| Staging `S` | `G:/TakiAgent-c2a-docker-acceptance/recovery-f217a02f-f8a5-466f-ab59-0e97940debe0` |
| Protected root `R` | `C:/taki-c2a-docker-recovery-f217a02f-f8a5-466f-ab59-0e97940debe0` |
| Result image tag | `taki-c2a-fake:f217a02f-f8a5-466f-ab59-0e97940debe0`; record actual immutable image ID before registration |
| Engine | `93e8319e-24b7-4a7d-88f1-60923ad681e0`, Docker `29.0.1`, `npipe:////./pipe/dockerDesktopLinuxEngine` |
| Cached base | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Runtime | Existing pinned Node/Shell/Docker executables; only the existing tiny `fake-key-adapter.rs` is compiled into `S` |
| Topology | One container, one newly owned named volume, no network/ports, UID/GID 1000, existing 8 MiB private tmpfs |
| Processes | One fixture Core/Shell generation at a time, its resident descendants, one loopback relay and operator; one sequential replacement generation |
| Files | Same 256 MiB / 4096-file protected-tree cap; data volume 64 MiB / 1024 files; at most two small recovery markers |
| Capacity | Before preparation and at phase boundaries: G free >=20 GiB and growth <=2 GiB; C free >=1 GiB |
| Time | 30 minutes overall preparation/execution plus 5 minutes cleanup; one build <=10 minutes; recovery sequence <=8 minutes |
| Exchanges | Preserve 90-second admission, 30-second Native shutdown, ordinary Docker <=1 MiB and read-only Engine reply <=64 KiB |

The eight-minute sequence cap allows the second real Core boot and controlled restart; it does not
extend a grant or the fake child's fixed 300-second lifetime. Each running-child assertion must occur
before that child's own expiry. Fail an elapsed bound; never renew it by restarting a failed step.

Require both new roots/tag absent, pin existing binaries and the unchanged accepted source manifest,
and create one `wx` run fence under `S`. Never reuse either consumed first-case token/root. Retain the
prior compatible-base probe only when its source/base/engine identities still match; do not rerun it.
Provision only `R` with the accepted owner/SYSTEM/Administrators DACL. G ancestor ACLs remain unsuitable
for installed custody and must not be repaired. No new H build output or Cargo target.

Use Root's existing local-only build command with the new token, unchanged recipe and eleven Python
modules: fixed `default` builder, `--pull=false --network=none --load`, exact verified cached base and
no custom frontend/download. Record the result ID. A timeout is an unknown build result, not permission
for another build. Root rechecks its seven-container baseline; redis/arboris-app remain untouched.

## Causal execution sequence

### 1. Lose exactly one admitted Host completion

1. Provision once and boot the actual Core/Shell/operator with the accepted fake configuration. The
   Shell keeps `TAKI_GATE_AUTOAPPROVE=allow-once`; permission remains the real canonical path. Route
   only this Shell's WS through `startCapabilityRelay`; the operator connects directly to Core.
2. Before the one initial `start`, arm the relay's existing callbacks. Forward every ordinary frame
   unchanged. Locate the actual `hindsight-deployment` request whose validated input action is `inject`;
   retain its exact request ID/control and deployment/container/startup tuple in memory. Re-arm only
   the existing callback when an earlier C1/create/start request passes. Never select by ordinal alone.
3. For the corresponding parsed `capability.respond`, require identical request/control, successful
   completed state and a bounded running deployment status matching that tuple. Record the hold/drop
   decision and invoke `relay.close()` inside the response callback, before returning the original
   response. The relay closes its upstream synchronously, so its subsequent forwarding branch has
   neither an open nor connecting socket. Retain/await the close promise outside the synchronous callback.
   Do not queue, mutate, release or replay the selected frame.
4. Require exactly one matching held/dropped completion, a closed relay with zero pairs, the actual
   Host registry's inject phase `observed`, and the operator result/original `run.status` showing
   `outcome_unknown` rather than accepted completion. Retain the safe target tuple and fault ordering.
   This is loss before Core acceptance, not pretending a result was lost after reading it as success.
5. Before termination, capture the actual running child's safe PID/startup/process-start identity.
   Identify the fixture Shell from its `Proc` handle and record its resident
   descendant: parent PID equals that Shell, executable equals `R/node.exe`, and fixed argv names
   `R/payload/app/main.js deployment-host` with this registration. Retain PID/creation identity only.
   Terminate the exact Shell tree using the existing process helper, then the exact Core; await each
   exit and verify the captured resident is gone. Never kill by image name or enumerate unrelated trees.
6. Read the original container through the fixed adapter and unchanged running-child scanner. Require
   the same startup and actual child, still running after its Host/Core are gone. Keep safe PID plus
   `/proc/<pid>/stat` start identity where read; numeric PID alone is not an identity across restarts.

If no exact completion reaches the hold point, or Core accepted it, this fault case fails. Do not
count timeout alone, kill a broader process set, retry the initial start under a new key, or reset state.

### 2. Reopen original state, then restart the owned container

1. Keep `R` intact. Do not rebuild/copy payload, regenerate IDs/keys, call `deploymentFixture` again,
   rewrite `deployment.json`, or recreate SQLite. Reopen the exact Core data directory and node data
   with their stored Host/device identities and generated credentials. Connect the second Shell
   directly to the new Core URL; the first generation's relay remains closed. Use ordinary persisted Node
   authentication; do not wait for a first-pairing code that may no longer be issued. A fresh operator
   connection may pair normally. Keep the accepted permission state rather than resetting it.
2. Await the real Core listener and routable Shell catalog; the first explicit observation opens the
   installed resident. Confirm new process identities and the original Core/Host/installation/config
   identities. Then call `start` with the same caller UUID/digest and explicit `observe` once each.
3. Require the original deployment/Run UUID, container/image/volume/startup and live child identity.
   Registry attempt/step facts remain identical; revision alone may increase. No new C2 Run, create,
   start, checkpoint, grant or submission is permitted. Preserve the original unknown Run outcome;
   observation is not a trusted receipt or a repair of its historical acceptance.
4. Seed one small random **non-secret** marker in the verified original volume and one in the current
   tmpfs, with create-only fixed paths. Record their hashes and this container/startup binding. Verify
   `/run/taki-hindsight` is the actual tmpfs mount and record safe socket facts.
5. Revalidate engine, exact container ID/image/labels and original volume through `inspectOwned`.
   Execute once, through fixed Docker argv: `restart --time 35 <original-container-id>` (<=45 seconds).
   This is explicit fixture maintenance of its owned resource, not an observer side effect.
6. Perform bounded read-only readiness polling, then explicit `observe`. Require the same container
   ID, image and volume; a different Native startup; `waiting` without an admitted attempt; no Native
   binding/grant and no fake child. Require the tmpfs marker absent, the volume marker hash unchanged,
   and the old safe child marker still on the volume with its original startup/stopped state. Check
   actual process argv within this container's PID namespace rather than trusting a reused old PID.

Only idempotent reads may be polled within the fixed budget. Socket-not-ready is not permission to
repeat restart, create, grant or submit. The stable volume marker proves filesystem persistence only.

### 3. Explicit fresh-startup resume without old authority

1. Before resume, repeat the original start key once while the new startup is waiting. It must remain
   waiting, with unchanged consumed attempts and no checkpoint/submit. This proves durable start
   lookup does not replay initial authority on a new Native startup.
2. Call `memory.hindsight.deployment.resumeStartup` once with only the original deployment UUID.
   Require a running result for the new startup and a real new child. The new registry inject entry
   must have a different Core Run, Core/Host attempts, request, Effect, C1 snapshotId/control mapping, checkpoint and
   startup authorization. The new Run key is exactly
   `hindsight-deployment:startup:v1:<original-deployment>:<new-startup>` and its provenance parent is
   the original Run. Original operation, container, image, volume and configuration stay unchanged.
   Catalog digest/key version/selection remain stable. Connection/catalog generations need current
   validity, not a numerically larger value across the new Core process.
3. Assert exactly two inject entries total (one per startup), old entry unchanged, original create/start
   entries unchanged, and one new Native submission. Repeating `resumeStartup` once must only observe,
   leave all these identities unchanged and cause no additional C2 effect. No serialized handle,
   old permit or old credential frame is ever resubmitted.
4. Recheck the persistent marker and required sentinel surfaces, record final safe results, then clean.
   `deploymentReady` remains false in every public result; managed setup remains refused.

Count actual Docker creates/starts/submissions from bounded, retained original-container events and
their fixed exec metadata, cross-checked with the registry and relay. Expect one container creation,
one volume creation, initial start plus the single maintenance restart, and two submitter execs total.
Differentiate read-only control/probe execs from submissions; do not assert the first case's fixed
five-exec count. Native grant uniqueness is evidenced by exact startup/registry bindings and the real
flow, not inferred from a control-module exec count whose stdin is deliberately unrecorded.

## Evidence, checks and cleanup

Retain one `S/recovery.json` with per-phase outcomes, safe original/new identities, fault ordering,
canonical Run outcomes, actual exec/event facts, marker hashes, scan counts, input hashes and cleanup.
Keep failures. Preserve bounded safe engine/event/exec replies after sentinel checks where useful;
never record private input, key bytes, Catalog plaintext, pairing credentials or raw relay frames.
Use the first-case scan bounds for public statuses, registry, argv, both log streams and protected files.
Before exporting evidence, assert all retained evidence also has zero fake-sentinel hits.

Stage 1 verification is source/contract inspection and plan readback only. Stage 2 runs the prior R2
scoped ESLint and single-entry no-emit TypeScript check on the new launcher, plus scoped static Python
checks on the probe. Do not rerun the unchanged 182 tests, full Core/SDK builds, Rust suites or C1 matrix.
Any demonstrated source defect returns to Root/reviewer with its narrow affected verification plan.

Cleanup uses a separate five-minute budget and records failure as case failure:

1. Close the fixture operator/relay, terminate only still-live recorded Core/Shell processes and await
   reaping (<=15 seconds each). Validate captured descendant exit before removing protected files.
2. Read the intact original registry and recheck original engine/labels/image/mount ownership. Stop
   only its exact container: `stop --time 35 <id>`; verify stopped; `rm <id>` without force.
3. Verify no container references its original named volume; `volume rm <exact-name>`. Re-inspect
   original derived names to prove both absent. Unknown/mismatched ownership is retained for Root.
4. Verify the unique result tag's immutable ID and this case label, no additional tags/container users,
   and ID differs from the cached base; `image rm <exact-new-tag>`. Verify tag absence.
5. Scan and preserve safe proof before deleting `R`. Resolve its absolute path, verify the exact token
   marker and reject reparse points throughout; remove only that exact root and verify absence.
   Root archives/verifies `S` before the same exact-path/marker/reparse check and removal of only `S`.
6. Compare Root's original seven container IDs and unrelated workload state; leave Desktop running.
   No daemon restart, prune, force removal, broad deletion, base removal or cache/VHDX reclamation claim.

The design review resolved persisted Node reconnection through its unchanged stored identity/token.
The finite probe's safe process/mount reads still require static/runtime verification and must fail
truthfully if unavailable. No production gap is established by the present inspection. The inner Native ACK, shared-daemon and
database gates remain visibly open after a successful result from this plan.
