# Research: C2b managed-setup consumer readiness

- Query: Locate the actual managed-setup consumer and C2a producer records, and identify the smallest trusted-reference bridge with original-resource recovery.
- Scope: Internal, read-only source research; readiness/design input only.
- Date: 2026-10-15

## Findings

### Conclusion

There is an existing managed **receipt DTO**, but no trusted deployment ledger-reference schema, issuer or resolver in the inspected production paths. Managed setup intentionally refuses. C2a already owns durable Run/Effect records and the protected Host resource record; reuse those as the authorities. The missing source seam is a bounded, Core-owned resolver joining those records through authenticated Host observation, then supplying verified deployment provenance to the existing setup service.

That bridge cannot turn the current fake consumer or task-only PostgreSQL descendant into a ready Native API. Neither supplies a producer-bound API endpoint or immutable Native service/provider identity. C2b source work can establish reference validation and recovery while retaining that refusal. Positive real managed setup requires the corresponding actual producer evidence. This is an engineering contract/evidence gap, not a new product decision or another permission request. Root has approval to sequence C2b after the preceding reviewed checkpoints.

### Concrete existing seams

All source paths below are relative to `H:/TakiAgent`.

| File / lines | Existing behavior and implication |
| --- | --- |
| `packages/shared/src/hindsight-setup-schema.ts:58-81` | `HindsightManagedDeploymentReceiptSchema` contains version, helper/deployment IDs, endpoint, `status: ready`, persistent storage kind, `immutableHindsightIdentity`, timestamp. `managedReceipt` is retained for historical request decoding. Strict JSON shape proves none of those assertions. |
| `packages/core/src/memory/hindsight/hindsight-setup-service.ts:110-150,212-222` | `setup()` calls `managedConnection()` before compatibility checks, attempt persistence or Bank/template effects. Existing-instance rejects a supplied receipt; managed-helper always throws `HINDSIGHT_ENDPOINT_REJECTED`. This is the actual consumer boundary. |
| `packages/core/src/server/methods/hindsight-setup-methods.ts:40-43`; `packages/core/src/memory/operations/memory-operation-kind-setup.ts:23-32` | Both operator `memory.hindsight.setup` and durable `setup.apply` call that same service. Fixing only one request surface would leave inconsistent behavior. |
| `packages/shared/src/memory-operation-schema.ts:56-61,81-83`; `packages/core/src/db/memory-operation-repo.ts:42-72` | Durable setup requests currently persist the legacy receipt shape; the setup producer ref holds only attempt and before/after revisions. Existing request/producer JSON can retain a safe reference without a new operation ledger. |
| `packages/core/src/boot/hindsight-setup-boot.ts:26-51`; `packages/core/src/main.ts:254,386-389` | Setup is composed before deployment/Run recovery; no deployment resolver dependency currently exists. Wire a fail-closed late accessor or deliberately reorder composition while preserving the boot recovery barrier. Do not add boot-time Host/network work. |
| `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts:39-94,154-213` | Owns stable initial/startup Run keys, independent custody, real issued/accepted callbacks, original observation and checked final Run settlement. It currently publishes bounded status only, not receipts. This is the natural Core resolver owner. |
| `packages/core/src/boot/hindsight-deployment-boot.ts:20-33` | Already composes the deployment owner with actual Runs, custody and routing. Add narrow read dependencies here rather than a second deployment service or caller-injected authority. |
| `apps/hindsight-host/src/deployment-registry.ts:19-43,60-97` | Protected `deployment.json` owns plan/digest, actual container/volume, step fences and bounded attempt/control/custody history. Host is its sole writer; Core must not directly read or reproduce this protected registry. |
| `apps/hindsight-host/src/deployment-owner.ts:55-67,205-225` | Observation verifies original resources and Native startup/authorization against the recorded injection. It can recover Host facts without replay. Current returned status omits the full plan, volume, Effect ID and registry provenance needed by C2b. |
| `packages/core/src/db/effect-repo.ts:13-33,42-55`; `packages/core/src/harness/effect-lifecycle-service.ts:12-21` | Existing get/list reads expose durable Effect identity, Core attempt, input digest, Host executor/generation, settlement and reserved result reference. They do not persist the accepted Host output as a deployment receipt. A `reservedResultRef` is not evidence that such a receipt exists. |
| `packages/core/src/capabilities/capability-effect-lifecycle.ts:61-102`; `capability-broker-state.ts:103-126` | Generic successful Host responses settle Effects as completed before `onAccepted`; the callback itself is transient. Domain refusal/status and later owner/Run settlement still matter. Completed Effect alone is insufficient. |
| `packages/core/src/boot/hindsight-custody-boot.ts:63-72`; `packages/core/src/memory/hindsight/hindsight-compatibility-service.ts:125-145` | C2 configuration digest is SHA-256 of the resolved projection. Setup fingerprint additionally binds the secret marker and established compatibility constants. Do not compare these two distinct hash domains as equal. |

The historical receipt documentation in archived `08-09-hindsight-connection-setup/design.md:163-190` describes a declarative helper result followed by ordinary connection validation. It does not supply today's missing trusted producer. `MemoryOperationProducerRef` and Native application/backup receipts have other owners; none is a reusable deployment authorization.

### Facts a resolver can prove, and facts still absent

| Authority | Available original facts | Required treatment |
| --- | --- | --- |
| Core initial Run | Original deployment/operation UUID; stable `hindsight-deployment:start:v1:<caller UUID>`; fixed provenance and configuration digest; Core attempt/outcome. | Never confuse the caller lookup UUID with the deployment UUID or the separate setup operation ID. |
| Core startup Run and Effects | `hindsight-deployment:startup:v1:<deployment>:<startup>` with original Run parent; exact Effect/Core attempt, input digest, Host/generation and terminal result. | Join the current startup's injection, not an arbitrary completed Effect or whichever Run is newest. Failed/cancelled/unknown settlement cannot be upgraded merely because a child is running. |
| Protected Host record | Original plan/config/installation/registration/engine/image; named-volume identity/labels, container ID, recorded request, Host attempt, Core attempt/Effect IDs in control, startup/checkpoint/authorization IDs and fences. | Return only the bounded evidence needed for the join via the existing authenticated Host boundary. No raw registry export, keys, grants or filesystem path input. A historical authorization ID is a correlation fact, not a reusable permit. |
| Fresh original-resource observation | Actual current resource and matching Native startup/operation/Host-attempt/authorization tuple. | Distinguish historical successful admission from current availability. Host generation may legitimately change on reconnect; authenticate the current read while retaining the original generation as history. |
| Setup's focused client | Authenticated health/version/compatibility; provider lineage and mandatory Native contracts (`hindsight-compatibility-service.ts:43-72`). | Useful only after its configured endpoint is proven to belong to the exact deployment. Matching `/health`, a URL or image hash alone does not establish that association. |
| Missing producer evidence | Reachable managed Native API endpoint, its binding to the exact container/startup, immutable service/provider identity, and accepted persistent-database behavior for that consumer. | C2a status fixes `deploymentReady: false`; its network-none fake image and DB-only task variant do not produce these facts. Keep setup refused instead of filling receipt fields from configuration or test reports. |

The C2a `DeploymentStatusV1` (`packages/shared/src/hindsight-deployment-schema.ts:100-109`) deliberately lacks these ready-service fields. The old `immutableHindsightIdentity` string has no current producer-defined mapping to PostgreSQL cluster ID, container ID or Native provider lineage; explicitly define and verify the Native identity before using it. Do not equate those identities.

### Minimal next design choices

1. **Reference, not caller attestation.** Add one strict bounded deployment lookup reference to both setup request surfaces, keeping legacy receipts decode-only and refused for fresh admission. Use existing deployment/startup/Effect identities; avoid a new random receipt namespace. Exact pointer fields are an engineering design choice. The caller supplies a lookup key, never `ready`, endpoint, storage assertions, a serialized accepted handle or Host record.
2. **One producer resolver.** Extend the existing Core deployment owner with a read-only verified-resolution method and a narrow authenticated Host evidence projection. Join Core terminal Run/Attempt/Effect and input digest to the original Host plan/attempt/resource facts. Preserve current Shared/Rust mirror rules if this projection crosses the Shell. No new broker, selector, orchestration loop, deployment table or direct Core Docker access.
3. **Explicit admissible outcomes.** Admit only facts supported by the matched accepted producer path plus current resource/service evidence. Preserve fake/task-fixture classification as insufficient for setup. A lost original reply may leave durable unknown settlement: observation can recover factual availability but cannot retroactively claim accepted execution. Specify a conservative refusal/reconciliation policy before coding; do not invent a retry or new startup during setup.
4. **Persist the consumed pointer with existing ownership.** Use the existing setup operation's request/producer record for the durable path. The legacy direct setup path must resolve the same provenance and retain any necessary reference with existing B3 setup owner state, not only in process memory. If it needs an additive existing-row field, justify that narrowly; do not duplicate Host resource truth. Old rows without provenance remain readable and do not become newly trusted.
5. **Guard the actual setup sequence.** Resolve provenance before Bank/template calls; retain expected setup revision, canonical-local/activation guard, current config/secret identity and original deployment binding. Recheck the managed binding after asynchronous observation and before accepting configured state. Configuration A-B-A or replacement startup must not validate an obsolete result. Historical deployment observation can outlive its injection deadline; setup permission/current compatibility is a separate check, not resurrection of that grant.

Keep the existing compatibility/template/Bank pipeline and explicit LLM-health opt-in. `configured` still requires verified Global/Character Banks, compatible evidence and no authority switch. Do not redesign Home, map providers/models or make setup create/restart/reinject resources. A source-positive resolver fixture is acceptable evidence for the resolver only; it cannot turn the current Docker fixture into a production managed-setup acceptance result.

### Restart and privacy requirements

- Reopen the same Core Runs/Effects, Host registry and setup operation; resolve original identities before any new custody preparation. Missing/corrupt/mismatched state fails closed, without adoption, recreation or deletion.
- `hindsight-setup-recovery.ts:17-36` already marks interrupted busy setup failed and resets only intermediate Banks. `memory-operation-service.ts:80-105` and `memory-operation-repo.ts:91-104` preserve the foreign-boot unknown fallback. Retain that behavior unless the **same** persisted setup attempt and consumed reference prove a more specific outcome; current global `configured` status is not evidence for an arbitrary interrupted operation.
- Revalidation/inspection never changes an uncertain Effect to completed. A genuinely new Native startup follows existing explicit `resumeStartup` admission and retains the original deployment/container/volume.
- Persist only bounded IDs/digests/revisions/closed outcomes. Keep credentials, Catalog envelopes, reusable grants, raw exceptions, private socket paths and mutable caller receipts out of status/operation records. Use the existing sanitized errors. No broad registry dump or endpoint supplied in a reference.

### Meaningful limited tests and acceptance gates

| Test | Decisive assertion |
| --- | --- |
| Consumer/Shared negative contract | Raw receipt, unknown reference, wrong Host/registration/config/resource, fake-running status, and completed generic Effect with unavailable domain result all refuse before a setup attempt or remote mutation. Historical status and existing-instance setup stay compatible. |
| Core + actual temporary stores | Produce matching Run/Attempt/Effect and Host records through existing fixture owners, resolve the reference, then independently vary one identity/outcome. Do not treat hand-authored `trusted: true` as the positive producer. |
| Reopen/lost reply | Close/reopen SQLite and Host state; the same reference resolves without create/start/grant/submit. Unknown or cancelled original results remain non-admissible. Preserve the same reference through interrupted setup recovery. |
| Async drift/settlement | Change config generation, secret marker, registration or startup during observation; cancel/change the owning Run before settlement. Reject stale publication and remote effects beyond the permitted boundary. |
| Both setup entry paths | Exercise `memory.hindsight.setup` and durable `setup.apply` through the real service/composition; verify lookup is owner-provided, not supplied in request JSON. Boot performs no Host/network action. |
| Narrow compatibility regression | Reuse existing setup dry-run-before-mutation, verified Banks, explicit LLM-health and historical managed-state tests. Run affected Shared/Core/Rust checks only where contracts change; do not repeat accepted custody/Docker matrices. |

Source implementation needs a reviewed reference/projection contract, ownership wiring, outcome policy and identified producer readiness facts. Root must separately evaluate the preceding runtime evidence. The current recovery plan explicitly does **not** test inner Native grant/submit ACK loss or shared-daemon restart; the DB report/probe is not completed database acceptance. Neither remains silently satisfied after C2b source tests. A task-only SQL persistence pass still cannot certify ordinary Native API startup, authentication, provider identity or C2b production ready receipts.

### Related specs and references

Read current task `prd.md`, `design.md`, `research/leader-now.md`, and recovery-plan scope; `.trellis/workflow.md`; backend `hindsight-managed-deployment.md`, `hindsight-host-custody.md`, `memory-operations.md`, configuration-observation and relevant template-lifecycle guidance. The applicable contracts require producer-derived settlement, original identity, single-writer ownership and distinct source/runtime/receipt claims.

One focused `jbcontext search` located the actual setup refusal and legacy DTO; direct reads/exact searches verified current source after the indexed revision. No external docs or registry were needed. The repository's compatibility constant targets Hindsight API 0.9.0; no live service version was queried.

## Caveats / Not Found

- The legacy `.trellis/.current-task` is empty; Root supplied this exact active task/output path. No task metadata was changed.
- No trusted managed-deployment reference schema/producer/consumer was found beyond the intentionally refused historical receipt. Existing setup producer refs are not deployment proofs.
- Runtime acceptance may advance concurrently; this report makes no new Native ACK, daemon, database or managed-setup acceptance claim. No application/Docker/test/build/install/Git operation or source edit was performed.
- Only `research/c2b-readiness.md` was written. Ownership is released to Root for subsequent C2b design.
