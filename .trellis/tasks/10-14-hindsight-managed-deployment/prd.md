# Hindsight managed deployment

## Goal

Stage 5C C2 supplies admitted managed-resource ownership and restart recovery for a co-located Core and
execution Host. The first checkpoint, C2a, must run one fixed fake-credential bootstrap consumer, retain
durable Host resource ownership and recover observation of the original resource after interruption.
Source/process proof, actual Docker proof and C2b trusted-receipt consumption are distinct checkpoints.

## Authorization and dependencies

On 2026-10-14 the owner approved this separate child of `08-09-memory-operations-ui`, including design,
independent review, then direct source implementation and isolated fake-data checks within the proposed
C2a scope. No new product choice is pending. Activate implementation only after the design review passes.

C1a/C1b source reviews and eight actual Linux C1b process tests are accepted. C1 remains `in_progress`
for Ubuntu service/platform criteria 2 and 6; those do not block this C2a source checkpoint. Reuse unchanged
C1 evidence and preserve its contracts. The separately authorized C1 Ubuntu read-only preflight remains
owned by that task and does not authorize C2 environment effects.

Docker startup, image pulls/builds, container/daemon experiments, original data/keys, real model calls and
Git lifecycle actions are not authorized by this source checkpoint. Prepare a concrete resource/cleanup
manifest before requesting the Docker experiment. No source result can enable real delivery or receipts.

After source acceptance and staging cleanup, the owner separately approved starting existing Docker
Desktop and the concrete read-only engine/workload/cache preflight on 2026-10-14. That approval includes
possible automatic startup of existing restart-policy containers, but no image build or active container/
volume creation, stop, restart or deletion. The actual Docker acceptance criteria below remain separate.

On 2026-10-15, after the first-case independent static review passed, the owner approved the concrete
project-scoped probe, local build, one fake-consumer deployment and owned cleanup, conditional on leaving
unrelated processes/environments unaffected. This permits execution of `research/docker-acceptance/README.md`
but does not accept the broader Docker matrix or authorize unrelated resource/daemon changes.

On 2026-10-15 the owner approved the next sequence: isolated C2a fault/restart recovery tests, then a
real disposable-database shutdown/persistence checkpoint using generated data, then C2b implementation
against the accepted producer. Prepare and independently review each concrete slice before execution.
Project-owned fixture effects and cleanup may proceed under this approval; the shared daemon and
unrelated workloads must remain unaffected. This authorization does not mark any remaining criterion
accepted or include original business data/keys, real models or Git lifecycle actions.

## Requirements

1. Admit an exact non-secret deployment plan through the canonical Host permission and effect path. Bind
   the selected Core/Host, installation, engine, immutable fixture artifact, fresh storage and original
   operation/attempt/configuration to actual custody/control identities. Read-only custody permission is
   not permission to create/start a container or inject credentials.
2. Reach a fixed bootstrap consumer through independent startup authorization and the existing bounded
   private C1 protocol. The first consumer accepts generated fake values only. Preserve closed public
   statuses, fixed slot selection, dotenv suppression and private delivery; no arbitrary commands/env maps.
3. Let the execution Host durably record its original logical deployment identity and actual external
   resource identities. Publish intent/fences before effects; records contain safe facts, never credentials
   or serialized authority handles. Missing, corrupt, stale or ambiguous state must not cause adoption,
   blind recreation, reinjection or deletion of unknown resources.
4. After an interrupted create/start/submit exchange, inspect the original resource and recover its actual
   result. The observer may inspect and request fresh authority for a genuinely new startup; it cannot
   create/delete resources or approve/replay itself. Home closure is not process ownership.
5. Make the concrete owner/observer reachable through the scoped installed entrypoint. Keep the immutable
   payload separate from protected mutable resource state. Preserve C1 and existing-instance compatibility.
6. Return bounded observed state with `deploymentReady: false`. A running child is not Native/database/model
   readiness or a trusted setup receipt. Keep the existing managed-setup refusal until C2b has an accepted
   ledger consumer; operator-supplied receipt JSON cannot establish provenance.
7. Prove the source checkpoint with real temporary registry files and a real fixed fake bootstrap process,
   using a bounded substituted Docker adapter. Retain failures, hashes and owned cleanup. Later exercise
   the actual Docker path before enabling real credentials or trusted receipts.

## Acceptance Criteria

### C2a source and fake-process checkpoint

- [x] One admitted plan reaches the real fixed fake consumer through independent startup authority and
      private delivery; the packaged entrypoint reaches the concrete owner/observer.
- [x] Reopening durable state after create/start/submit interruption recovers the original result; duplicate
      requests, lost replies and unknown outcomes cannot repeat effects or transfer resource ownership.
- [x] Wrong Host/engine/image/container/volume/installation, changed config/startup, expired or reused
      authorization, stale custody and foreign collisions refuse through the actual ownership boundaries.
- [x] Fake sentinels are absent from public messages, argv, Docker environment options, registry/config/files
      and captured logs; expected child memory/environment remains private. Core remains the sole Catalog writer.
- [x] Running-state observation survives admission expiry; new startup requires new authority, and observer
      reconciliation has no create/delete path. Existing-instance and C1 behavior remain compatible.
- [x] Independent source review, affected tests/types/lint, packaging reachability and owned cleanup pass;
      evidence explicitly distinguishes the substituted Docker adapter from a real engine.

Accepted on 2026-10-14; see [source acceptance and exact test boundaries](research/c2a-source-acceptance.md)
and [final source preservation/cleanup](research/c2a-root-final-readback.json).

### Separate actual Docker checkpoint

The first bounded real-Docker fake-consumer case passed on 2026-10-15 after a task-fixture-only correction;
see [its result and remaining boundaries](research/c2a-docker-first-case-acceptance.md) and the
[completed independent evidence review](research/c2a-docker-runtime-review.md). It established
actual admitted startup, same-key/original-resource observation, no-TTY private delivery, bounded scans
and owned cleanup. The broader criteria below remain open; later Desktop recovery after test cleanup
is not the controlled daemon-restart case.

The later isolated [recovery R2](research/c2a-recovery-runtime-review.md) also passed: outer Host
completion loss, original Core/Host state reopen, one original-container restart, fresh startup
authority and persistent-volume/fresh-tmpfs markers. R1's fixture scan-order failure is preserved;
both attempts are archived and cleaned. A separate actual PostgreSQL 18.1 offline first-start/SQL/
checked-stop prerequisite passed, but logged-data restart persistence remains unproved. Neither
result accepts inner Native ACK loss, shared-daemon restart, a ready Native API or trusted receipts.

- [ ] The approved isolated engine proves actual no-TTY delivery, metadata/config/log/persistent-file scans,
      helper/ACK loss, container and daemon restart, new startup/fresh tmpfs and original-volume persistence.
- [ ] An actual disposable database shuts down gracefully and preserves generated test data. No sleeping
      process or Windows/Linux source fixture is used as database/Docker acceptance.

2026-10-18 status: the admitted two-generation database case `b5c5fb7f-cd8a-402a-bd11-92839d191e98`
proved graceful `checked` shutdown of a real PostgreSQL 18.1 cluster in both generations and preserved
the committed 4 KiB logged row across the restart on the original volume, with no-TTY private delivery
and bounded scans. The combined first bullet still lacks inner Native ACK/effect-fault injection and
shared-daemon restart, so both boxes stay open. Evidence: `research/c2a-database-persistence-run-b5c5fb7f/`.

### Later C2b checkpoint

- [ ] Accepted, producer-owned deployment ledger references are consumed by managed setup with original
      operation/resource/configuration identity and failure recovery. Source-only diagnostics cannot mint them.

The last three criteria remain open after the first bounded Docker case. C2b design/implementation follows the accepted
C2a producer and actual Docker boundary; it is not part of the first source dispatch.

## Scope constraints

One explicitly selected co-located Host, fresh owned storage, a fixed fake consumer and original-resource
recovery. No remote secret transfer, existing-volume adoption, general broker/orchestrator, provider matrix,
new third-party dependency, Home setup/activation flow, real model mapping, candidate migration or installer
framework. Keep one cohesive source owner and one serial heavy check slot. Use high/xhigh agents and at most
two Vitest workers. Prefer G: for temporary staging, preserve reused Rust targets/T4 evidence, and do not
repeat unchanged Core/SDK/build gates without a changed input or a concrete concern.

## Sources

- [C2 readiness and executable slice](../10-07-hindsight-managed-host-custody/research/c2-next-slice-readiness-2026-10-14.md).
- [Accepted C1 boundary](../10-07-hindsight-managed-host-custody/research/leader-now.md).
- [Stage 5 execution map](../08-09-memory-operations-ui/research/stage5-execution-map-2026-10-07.md).
- [Host custody specification](../../spec/backend/hindsight-host-custody.md).
