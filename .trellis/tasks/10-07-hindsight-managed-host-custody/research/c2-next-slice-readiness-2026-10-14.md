# Research: C2 readiness and the first executable C2a slice

- Query: Can C2 advance alongside the remaining C1a service/platform acceptance, and what is the smallest useful next slice?
- Scope: internal, with read-only inspection of the local Native dependency at `H:/hindsight`; only this report is written.
- Date: 2026-10-14
- Task: `10-07-hindsight-managed-host-custody`, explicitly supplied by Root. The legacy global pointer is empty; the current task's `research/leader-now.md:18-20` records session-scoped routing. No binding was changed.

## Findings

### 1. Scheduling verdict

**GO for C2 planning; technically GO for bounded C2a source implementation after its separate task is reviewed and activated.** Remaining C1a platform AC2/6 do not require holding all C2 source work. C1 must remain `in_progress`, and deployment readiness remains unavailable.

| Work or claim | Gate now |
| --- | --- |
| C2 task planning and contract preparation | Ready. Root should obtain the separately scoped task-creation/planning consent required by the workflow. |
| C2a source and isolated fake-credential tests | Ready after the new task's scope, contracts, ownership and activation gate. Can overlap C1a service acceptance planning; coordinate any shared packaging/schema edits. |
| C1 completion or installed Ubuntu custody availability | Not accepted: combined AC2/6 and the relevant installation evidence remain open. |
| Actual Docker/container/daemon experiment | Plan now; execute only after approval of its concrete environment effects. C1b's removed temporary runtime permission does not cover this. |
| Real credential delivery, trusted deployment receipts, usable managed deployment | Not accepted. Actual C2a Docker proof and the exercised platform's custody/installation evidence are necessary; C2b still owns trusted ledger consumption and C3 owns model application/readback. |

The dependency is explicit in C1 `implement.md:64-73`: independent foundation review must record remaining platform limits before C2 consumes the contract; actual Docker proof gates **real delivery and trusted receipts**. Both independent SOURCE reviews and Linux 8/8 are now accepted in `research/leader-now.md:3-11,64-65`. C1 `design.md:175-199` separately assigns C2a's real registry/observer experiment and Stage 6's final installed/original/manual acceptance. Requiring all of those later gates before writing C2 source would conflate distinct evidence boundaries.

The older 2026-10-07 reports describe several then-missing C1 components. Use their responsibility/recovery contracts, not their historical absence statements, against today's implemented C1. No accepted test was rerun for this assessment.

### 2. Task boundary

Proposed task slug: **`hindsight-managed-deployment`**, with C2a as the first implementation/check checkpoint. Create it as a sibling of C1 under **`.trellis/tasks/08-09-memory-operations-ui`**, not inside C1's implementation scope. C1 `prd.md:119-122` explicitly assigns orchestration/receipts to C2; C1 `task.json:22` confirms this parent. The parent's `task.json:21-26` and `research/stage5-execution-map-2026-10-07.md:15-20` already place the Stage 5 children here.

The new PRD should keep C2a source acceptance, actual Docker acceptance and C2b receipt consumption separate. Do not mark C1 complete to start C2. `.trellis/workflow.md:168-170,293` makes independently verifiable children appropriate, says hierarchy is not a dependency system, and requires artifact review/activation before implementation. This report does not create or activate that child.

### 3. Three concrete producer seams

| Existing files and verified pattern | What C2a must supply |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-custody-owner.ts:53-91,96-150`: `prepare()` mints a WeakMap-backed `AcceptedCustody`, creates its own operation/attempt IDs, retains the issued Core/Host/request mapping, and validates current snapshot/generation/deadline. | A narrow C2 operation/startup owner must bind the original deployment plan to those actual custody/control identities and issue fresh startup authority. Persist safe mapping/effect facts, never serialize the handle or reconstruct permission from its JSON shape. Existing read-only custody approval is not permission to create a container or inject credentials. |
| `apps/hindsight-host/src/prepare-custody.ts:18-55`: fixed-slot values are checked transiently and only value-free status returns. Native `docker/standalone/managed_bootstrap/bootstrap.py:63-110` has no default consumer and requires an independently installed `LiveGrant`; adjacent `submitter.py:72-102` only delivers to an already authorized startup. | Reuse the codec/registration/current-byte checks through a narrow private sender, preserving C1's public result. Add fixed owner-side startup authorization/status glue and a fixed consumer. The non-secret owner control must establish authority independently of the credential frame; no frame-supplied `trusted` flag, arbitrary command, environment map or secret broker. Freeze that small control contract in C2 planning. |
| `apps/hindsight-host/src/restart-observer.ts:12-60,108-133,193-219,267-281`: UUID logical resource identity, in-memory attempts, exact recovery, and fence-before-submit. `src/main.ts:6-15,23-40` does not import it; `scripts/build.ts:33-36,52-61` ships only reachable imports. | A protected durable Host registry, a concrete Docker adapter and an executable observer owner. Keep a logical UUID separate from the actual Docker container ID; resolve the former through the owned record. Wire the observer into the scoped C2 entry and verify packaging reachability. A copied fake recovery object or renaming `FakeRestartObserver` is insufficient. |

Native paths in this report are relative to `H:/hindsight`. Its `docker/standalone/managed_bootstrap/unix_socket.py:176-208` currently sends status then accepts a credential frame; it provides no release caller or live-grant installation command. This is a named implementation seam, not an already available Docker admission channel.

### 4. Smallest executable C2a slice (proposal)

Deliver **one admitted, isolated deployment through start and original-resource recovery**: one explicitly selected co-located Core/Host, one immutable fixture artifact, one newly owned named persistent volume, one protected tmpfs bootstrap directory, and one fixed fake consumer. Defer Home setup/activation, the C2b receipt ledger consumer, existing-volume adoption and real provider mappings.

The observable chain must be:

`exact non-secret plan -> Host admission -> durable ownership record -> fixed create/start adapter -> independent startup grant -> private C1b submission -> actual fake child status -> restart/reconcile by the original resource record`.

The source fixture should exercise the real bootstrap consumer/process with an injected, bounded Docker process adapter and a real temporary registry file. Reopening that registry must recover a status obtained from the same consumer/resource, not a canned `running` field written by the registry itself. The same fixed Docker runner is exercised against an actual isolated engine only at the later environment gate. Neither source fixture proves Docker behavior.

**Input:** a strict non-secret plan binding original operation/attempt, explicit Host/Core/installation, plan/config digest, accepted artifact identity and fixed fresh-storage/topology choice. Docker executable/context and state root come from protected Host registration, not arbitrary operator paths or ambient CLI defaults. The admitted fixed slot selection and startup authorization retain C1's original bounds. No API exposes raw commands, env maps or credential values.

**Output:** bounded safe deployment/resource/startup/attempt/config identities with observed waiting/running/stopped/unavailable/unknown state. Keep `deploymentReady: false` throughout the source/fake slice. A child-running acknowledgement is not Native configuration, database readiness, a trusted setup receipt or memory authority.

| Candidate scoped files | Responsibility / reuse |
| --- | --- |
| New narrow deployment plan/status schemas under `packages/shared/src/`; C2 owner beside `packages/core/src/memory/hindsight/hindsight-custody-owner.ts` | Exact non-secret admission and startup mapping through the existing capability broker/accepted-result hooks. Register the effect's canonical permission contract wherever exposed; never widen `hindsight-custody:prepare` into an effect implicitly. Add only required Rust mirrors/handler wiring for the chosen Host path. |
| Proposed `apps/hindsight-host/src/deployment-owner.ts`, `deployment-registry.ts`, `docker-adapter.ts`, and focused tests | One cohesive create/start/inspect/reconcile producer, durable ownership and a fixed no-shell Docker runner. These filenames are proposals, not existing modules or a general orchestration framework. |
| Existing `src/restart-observer.ts`, `prepare-custody.ts`, `main.ts`, `scripts/build.ts` | Reuse exact-ID observation/fencing, protected custody and reachable-import packaging. Factor only what the concrete producer consumes; preserve C1 behavior and its closed status contract. |
| Native `docker/standalone/managed_bootstrap/` and `docker/standalone/tests/fixtures/` | Minimal independent owner/consumer glue and a fixture image recipe around `Bootstrap`, `LiveGrant`, the fixed submitter and `OwnedChild`. Preserve process/framing behavior; use a fixed fake consumer before real provider wiring. |

No C2a change should unblock `packages/core/src/memory/hindsight/hindsight-setup-service.ts:212-223`: it correctly refuses new managed setup until the accepted C2 ledger exists. C2b later owns the `receiptRef` consumer rather than caller-supplied `managedReceipt` JSON (C1 `design.md:108-111`).

**Durable ownership:** the Host alone writes a versioned, bounded, non-secret record in a protected Host state root outside the immutable payload. Record the approved plan/installation/engine identity before effects; retain actual container ID and inspected volume identity/mount ownership after creation, plus original operation, configuration and consumed startup/attempt/authorization IDs. Use one deployment-local writer/lock, atomic publication and a durable dispatch fence before injection. The existing staged-file/fsync/publication pattern is a reference (`packages/core/src/secrets/catalog-publication.ts:16-35,38-75`), not permission to import Core internals or claim stronger crash durability than the platform proves.

If creation's reply is lost, inspect using the already recorded exact ownership markers and verify actual IDs/image/mounts; ambiguity stays unknown. Missing/corrupt records, foreign collisions, changed daemon/installation or mismatched resources never authorize adoption, blind create or automatic deletion. Registry size/retention must be finite without forgetting consumed attempts and reopening replay. Core's future accepted receipt ledger is a different owner from this Host resource record.

**Observer boundary:** it inspects the registry's original container and obtains new authority only for a genuinely new startup. It cannot create/delete/replace resources, approve itself, revive an expired grant or replay after reconnect. Helper/Home closure does not transfer container ownership. Already-running status can outlive admission expiry; a new startup with missing Core/helper/key or an unattended `ask` stays unavailable. Reuse `restart-observer.ts:139-151,211-219,248-280` and `.trellis/spec/backend/permission-authorization.md:237-255`.

The current Linux C1 unit is custody-only: `packaging/taki-hindsight-host.service:18-31` has `ProtectSystem=strict`, no writable deployment state declaration and a 15-second Host stop budget. Do not assume it already installs a durable registry/Docker observer or proves database shutdown. Freeze the C2 state/lifetime integration without changing the concurrent C1a fixture inputs silently.

### 5. Essential acceptance criteria

**C2a source checkpoint:**

1. The concrete owner/runner reaches the real fixed fake bootstrap consumer, publishes safe observed state and is reachable in the scoped package. No default real-provider consumer or callable deployment effect is obtained through C1's read-only capability. Verify missing/unsupported C2 installation and existing-instance behavior.
2. Reload a disk-backed ownership record after helper loss and after every externally visible create/start/submit boundary. Recover the original result; duplicates, lost ACKs and unknown outcomes never repeat an effect. Observer-only reconciliation has no create/delete path.
3. Refuse wrong Host/engine/container/image/volume/installation, startup/config/attempt drift, stale custody after awaits, reused authorization and foreign resource collisions. A new startup needs a fresh independently issued grant; a running original process remains observable after grant expiry.
4. The runner never supplies fake sentinels in argv or Docker create/exec environment fields; sentinels are absent from public control/status, persisted registry/config/files and captured logs. Assert private no-TTY framing/EOF/caps, fixed slot selection, dotenv suppression and bounded sanitized errors. Actual Docker metadata scans belong to the separate checkpoint below. The intended child memory/environment is not a persistent-secret artifact.
5. Retain focused failure results and run affected package/wire/type checks after the cohesive change. Reuse unchanged C1 evidence; an injected Docker adapter and process tests cannot check off the Docker/platform criteria. No new third-party dependency or broad provider matrix.

**Separate actual Docker checkpoint:** exercise those source identities on one approved isolated topology, including real no-TTY `exec -i` delivery, inspect/config/log/persistent-file scans, lost helper/ACK, full container restart, real daemon restart, new startup identity/fresh tmpfs, unavailable/rotated custody and original-volume persistence. Database shutdown must use an actual disposable database and verify preserved test data; a sleeping fake child is insufficient. Native `docker/standalone/start-all.sh:170-220` requires graceful PostgreSQL shutdown and a 30-second stop allowance. Record engine/image/source identities, outcomes and owned cleanup. This check is necessary before real credential delivery/receipt enablement, not sufficient to claim C3 model acceptance.

### 6. Decisions and later environment permission

No new product choice is needed to plan the co-located, fresh-storage, fake-credential slice. Root can choose module placement, the bounded registry format, exact startup control, fixed Docker invocation and check order as engineering work. Those contracts still need review before source dispatch; their absence today does not require a full provider/platform design matrix.

The present owner-facing decision is consent to the separately scoped C2 task/planning phase. Later, request only a concrete experiment: the selected existing or disposable engine/Host; exact local fixture image/build inputs and any necessary pull/download; an explicit scratch/state location with size/time limits; new marked container/volume/tmpfs resources; bounded start/stop/restart operations; and cleanup restricted to those owned resources. Produce that reviewable manifest before asking. Existing C1b authorization is not Docker permission.

Daemon restart has engine-wide effects: use an isolated daemon or obtain explicit approval for the selected daemon's actual interruption after checking its unrelated workloads. Restarting only a container does not prove daemon recovery. Use generated fake credentials and trapped/offline model adapters, with no original Catalog/keyring/data access, real providers or ambient model downloads. A model-free process fixture cannot stand in for actual database persistence/shutdown; keep any missing proof open. No Docker/environment inventory was performed in this research, so no available engine, cached image or safe restart window is asserted.

## Related specs and external references

- `.trellis/spec/backend/hindsight-host-custody.md:5-19,64-77,90-140`: authoritative C1 read-only custody, finite bootstrap, observer and evidence limits.
- `.trellis/spec/backend/host-operation-lifecycle.md:73-95,263-269`: exact authenticated Host/generation and no replay after unknown effects.
- `.trellis/spec/backend/permission-authorization.md:166-178,237-255`: trusted classification, one-use approval and unattended refusal.
- `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md:124-151` and `stage5c-custody-design.md:106-156`: C2 orchestration/recovery responsibilities and environment decision boundary; historical implementation-absence statements are superseded by current source.
- External dependency inspected locally: Native's Hindsight `0.9.0` compatibility line (`docker/standalone/managed_bootstrap/README.md:94-131`). Current C1 records identify build `taki-memory-hindsight-0.9.0-template-backup-v1`; it is not an image digest. Host builder pins Node 24-compatible artifacts and existing libsodium `0.8.4` dependencies (`apps/hindsight-host/scripts/build.ts:16-20`); Native process evidence uses Python 3.11.17 and python-dotenv 1.2.2. No network references, new versions or candidate image digest were selected here.

## Caveats / Not Found

- The accepted C1 checks are cited from the task's current records, not reproduced or promoted to installer/Docker/model evidence. AC2/6 and manual acceptance remain open.
- No real resource registry, production Docker observer, independent release bootstrap authorizer or actual Native provider consumer is present in the inspected C1 seams. Proposed C2 filenames/contracts above are work to do.
- Native `docker/standalone/Dockerfile:183-188,268` still uses `/app/start-all.sh`; the inspected file does not package `managed_bootstrap`. A repository module alone is not a runnable managed image.
- Root supplied an offline environment readback: Windows Node 24.18.0 and Docker CLI exist, Docker WSL disks are on G:, and both WSL distros are stopped. This was not independently probed here and proves neither daemon readiness nor available images. Current C1 registration (`packages/shared/src/hindsight-installation-schema.ts:42-54`) has no Docker or writable deployment-state contract; that remains C2 engineering work.
- This report only writes the assigned research file. No source/spec/task-state edits, tests/builds, downloads, runtime/service/WSL/Docker starts, credentials/data access or Git operations were performed.
