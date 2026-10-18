# C2a independent design review

- Date: 2026-10-14
- Final verdict: **PASS — design only.** Root resolved R1/R2 in the persisted plan; the focused independent recheck found no remaining design blocker. This is not SOURCE PASS.
- Initial verdict: **CHANGES_REQUIRED** with two bounded findings, retained below for history.
- Reviewed: `prd.md`, `design.md`, `implement.md`, `research/c2a-contract-design.md`, every curated `check.jsonl` entry, and the named current source seams.
- Verified repository heads: Taki `main` at `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`; Native `main` at `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Authority: the explicit task supplied by Root and the session-scoped binding. The empty legacy `.current-task` was not changed.

## Findings (fixed)

- **R1 — fixed by Root:** `design.md:57-85` now freezes the start namespace, stable TriggerRequest/provenance/configuration reference, durable lookup before snapshot/custody capture, and observation of the persisted initial Run UUID. Concurrent `reused` admissions cannot dispatch. Startup keys bind the original deployment and Native startup, with the original Run in `parentRunId`; admitted/fenced startups only observe, and C2a explicitly adds no retry for an already admitted same-startup refusal. These choices fit the previously inspected Shared Harness fields and existing Run persistence. `implement.md:37-41` records the required duplicate/conflict/reopen tests.
- **R2 — fixed by Root:** `design.md:131-135` now requires the Host to reject every non-fake selected value and inherited default before checkpoint/grant dispatch and frame construction/writes, while retaining Native's independent check. `implement.md:45-46` records zero-frame/zero-submission regression coverage using generated values.
- The focused recheck read both corrected artifacts and compared these changes with the source facts retained from the initial review. `design.md:9` explicitly gives these resolutions precedence over the earlier research proposal. No resulting contract contradiction or new scope was found.

## Findings (not fixed)

None remaining at the design gate. Production implementation and its independent source verification remain pending.

## Initial review history (retained)

The following records the original two findings. Its planning line references describe the pre-correction artifacts; both findings are resolved by the final design above.

### R1 — Freeze durable start idempotency and original-deployment lookup

- File: `design.md:49,58`; `research/c2a-contract-design.md:56-60`.
- Issue: the design promises repeated-start observation but leaves the stable TriggerRequest and restart lookup unspecified. The cited dev trigger creates fresh `triggerRequestId` and `idempotencyKey` on every call (`packages/core/src/server/methods/capability-trigger.ts:84-92`). `RunRepo.admit` deduplicates by key **and hashes the complete request**; a new request ID with the same key throws `RUN_IDEMPOTENCY_CONFLICT` (`packages/core/src/db/run-repo.ts:84-87,261-267`). Moreover, `RunService.admit` captures a new snapshot before looking up the persisted admission (`packages/core/src/harness/run-service.ts:70-85`). An in-memory caller-key map or simply copying the dev-trigger sequence cannot recover the original deployment after Core restart, particularly when fresh admission is unavailable.
- Minimal fix: specify a fixed C2 namespace and stable request fields, with the caller idempotency UUID and original expected-configuration binding retained in the existing Run record. Add a narrow read through the existing `readRunByIdempotency` seam (`packages/core/src/db/run-readers.ts:23-26`) to the Run repository/service; perform that lookup before fresh snapshot/custody admission. Validate the stored C2 provenance and original input binding. A matching repeat returns the **persisted initial Run UUID** as deployment/original operation UUID and observes its Host record; it never starts that Run again, prepares another effect, or substitutes the caller UUID for the deployment UUID. The same key with different input refuses. No new migration or C2b ledger is needed.
- Preserve the related distinction: `resumeStartup` retains that original deployment/operation while using a fresh admitted Run/Attempt for a genuinely new Native startup. Repeated calls for an already admitted/fenced startup observe the existing attempt; they cannot turn unknown grant/submission outcomes into a new attempt. Define any permitted retry of a verified pre-dispatch refusal separately from replay.
- Required source proof: identical request twice; same key/different expected digest; concurrent duplicate; lost start reply followed by reopening the Core database and Host registry, including unavailable fresh custody. Assert the same original deployment UUID and no repeated create/start/grant/submit effect.

### R2 — Enforce fake-only delivery at the Host sender

- File: `design.md:94-110`; `research/c2a-contract-design.md:69,100-106`.
- Issue: the explicit `C2A_FAKE_[0-9a-f]{64}` restriction currently sits in the Native consumer. Rejection there happens after values have crossed the private Docker delivery path, which would already violate the PRD's real-credential delivery gate. The reusable Host preparation only checks selection, version, size and current identity; it does not establish that a selected value is fake (`apps/hindsight-host/src/prepare-custody.ts:26-43`).
- Minimal fix: require the C2 Host's private sender to validate every selected catalog value against the exact fake format during private preparation, **before checkpoint/grant dispatch and before constructing or writing any credential frame**. Inherited values come only from the validated fake default. Refuse the complete injection with a closed value-free reason on any mismatch; do not transform the value or select another Catalog. Keep Native's independent fake-only check as well. C1 preparation remains unchanged.
- Required source proof: a generated non-matching test value in each selected/inherited path produces no credential-frame bytes and no Native submission, with no value in public results or logs. Ordinary fake values still reach the real fixed child.

## Inspected facts and accepted design direction

| Boundary | Current source and review conclusion |
| --- | --- |
| Run/Attempt/Effect authority | `main.ts:153-158` wires the actual Run dispatch guard into EffectLifecycleService. `capability-effect-lifecycle.ts:10-18,61-94` has a legacy missing-authority bypass. Requiring real C2 effect identity and refusing that bypass is necessary and feasible; R1 supplies the missing durable entry lookup. |
| Live C1 custody and ABA | `hindsight-custody-owner.ts:53-91,143-150` retains WeakMap identity and revalidates current configuration/control/deadline. `secrets/catalog-custody.ts:44-78` additionally binds the private successful-publication revision and boot. A validated internal description plus retention of the real handle is sufficient; serialized projections must remain facts only. |
| Final inject checkpoint | `route-capability.ts:86-99,112-122` exposes the current routing predicate; `capability-challenge.ts:45-67,159-196` owns intent/execute/resume; `capability-broker-state.ts:99-120` settles the Effect before accepted evidence. One live-pending callback and a composed owner-current guard fit these seams. The guard must include the still-current Run/Attempt, and the checkpoint must verify the matching committed Effect and authenticated generation. Preserve consumption before permit return and final settlement ordering. |
| Shell/helper lifetime | `node.rs:50-64,103-129` owns advertisement/handlers; `ws_client.rs:54-102,308-354,604-615` retains them across sessions and keeps the reader runnable during blocking execution. `hindsight_windows/process.rs:55-95` intentionally kills the C1 Job per invocation. A separate resident lifetime and bounded per-session checkpoint relay are justified; reusing the one-shot Job would break the required lifetime. |
| Native independent grant and process truth | Native `managed_bootstrap/bootstrap.py:63-89,103-160` already separates independent authorization, the one-use attempt fence and actual child polling. `submitter.py:72-102` checks exact challenge/ACK binding. `unix_socket.py:73-105,176-248` and `supervision.py:53-130` supply the fixed protected transport and owned process lifetime. New owner control and the fixed consumer are real missing glue, not existing runtime facilities. |
| Durable registry and installed entry | `hindsight_windows/installation.rs:21-56` verifies the external registration and consumed tree; `catalog.rs:18-39` demonstrates rename-compatible mutable-input guards. `secrets/catalog-publication.ts:16-35,63-75` is a publication reference with an explicit Windows directory-fsync limit. Host `main.ts:6-40` and `scripts/build.ts:33-36,52-61` show why the concrete C2 import/entry and copied-payload check are required. |
| Fixed Docker and readiness boundary | Native `Dockerfile:179-199,268` supplies the venv/volume ownership but still invokes `start-all.sh`; it does not install this owner. The protected separate registration, fixed no-shell/no-TTY adapter, explicit engine/image identity, no pull, and dedicated fixture recipe are coherent. Core `hindsight-setup-service.ts:212-223` must continue refusing managed setup. No actual engine or image availability was inferred. |

## Scope and simplification

The remaining design is appropriately bounded: one cohesive implementer, one registration/deployment, finite startup records, the existing governance/broker/Run authority, and separate read-only reconciliation. Lost create/start/grant/submit replies stay attached to durable original fences and inspected identities; missing or ambiguous ownership never permits adoption, recreation or deletion. No additional orchestrator, permission service, provider mapping, receipt ledger or dependency is needed.

The accepted R1 correction reuses the existing Run storage and reader without another persistent deployment index. R2 is one narrow sender predicate using the already chosen fake format. The resident wrapper and final checkpoint cannot be removed without losing an accepted lifetime or custody boundary. No other must-fix design issue was found in the inspected seams.

## Final reviewed planning inputs

| File | SHA-256 at focused recheck |
| --- | --- |
| `design.md` | `7a49d881de7ed7810c57c00a2e29a4f83f8f4490aa20aa221d872f928e31d5c4` |
| `implement.md` | `82b6802eaef598aefd5dc45913bc91c86a5f87b2bad987ff991f1d48034e005f` |

## Verification and gate limits

- Spec/source inspection: completed. The `trellis-check` compliance and cross-layer checklist was applied to the design scope.
- Lint: not run; no production source changed and this assignment excludes check execution.
- TypeCheck: not run for the same reason.
- Tests/builds/environment: not run. Prior C1 acceptance is retained as task-record evidence, not reproduced here.
- Source acceptance still requires the real fake-child/on-disk recovery chain, actual pending/effect tests, changed-scope checks, independent source review and copied-entry reachability. A canned `running` response is not process evidence.
- This review grants no SOURCE PASS, Docker/daemon/tmpfs/database proof, C1 AC2/6 acceptance, real credential delivery, trusted receipt, C2b/C3 acceptance or manual acceptance. `deploymentReady` remains false.
- No production edit, Git lifecycle, Docker/WSL start, build artifact, download, original credential/data access or model call occurred. No cleanup was needed.

**Ownership released:** `research/c2a-design-review.md`. The design-review gate is passed; Root may activate the reviewed source task under the owner's existing authorization. The reviewer performed no task activation or other edits, and no additional owner permission is requested.
