# Delegation design

Status: authorized S2/S3 implementation follows the passed S1 independent persistence gate. The SDK child passed its final checks and independent review. The coordinator accepted the revised joint contract after its independent challenge and the owner's Memory/tool-configuration clarifications.

## Reviewed implementation contract

[Joint Runtime/source contract](../10-21-agent-delegation-source-context/research/joint-runtime-source-contract.md) is the shared technical reference. Read its requirements and relevant named sections before each slice; the complete evidence is intentionally not duplicated into this child or a 32 KiB context injection. [Independent review](../10-21-agent-delegation-source-context/research/joint-contract-review.md) explains the corrected failure cases.

This child owns S1-S3 and the S7 conversation UI, with the S2/S4 Co-Watching adapter handed off explicitly to the source child. Begin with S1 shared schemas, four distinct durable record families and atomic Run participation. A passing S1 is a foundation checkpoint, not delivery of G1-G4 or the child UI.

## Package decision

[Runtime research](../10-21-agent-delegation-source-context/research/delegation-runtime.md) compares upgraded ToolLoopAgent, WorkflowAgent and HarnessAgent using exact adapter evidence. The reviewed recommendation retains ToolLoopAgent and extends the existing Core owners for the demonstrated lifecycle gaps. Harness has real experimental steering, but latest-user-only input reduction, unsupported history access and stop/suspend differences prevent direct substitution. Workflow introduces separate durable execution ownership. Neither is a prerequisite dependency here.

## Existing owners to extend

- ChatAgent/model-tool loop: shared execution and disclosure/governance/telemetry, with an explicit selected child context instead of overloading initiative context.
- RunService/admission/recovery: each new execution and its lineage, completion admission, stop/restart reconciliation and terminal-state invariants.
- Turn registry/queue: separate child execution targeting and lifetime; preserve ordered relationship publication rather than registering every child under one Character controller.
- Core persistence and read projections: retained child continuity, addressed messages and outcomes; native SDK state is not another authority.
- Shared protocol and Home UI: query/subscribe and addressed controls over the same Core state.

The exact identities, work-targeted messages, completion keys, stop origin, storage/API fields and canonical terminal transaction participation are specified in joint sections 3-7 and 13. Work B cannot supersede unrelated work A merely by reusing the same child. Register terminal participation at the canonical RunRepo settlement owner so start/dispatch/recovery terminalization cannot strand child state.

## Joint source boundary

The result handed to the parent carries available generation/material origins without copying the full private transcript. Align it with the source child's durable publication/replay contract before either side writes the shared shape. Snapshot inheritance must not erase source framing. A new parent execution consumes a child report as internal work evidence, not as a forged user utterance.

## Task instructions and executable tools

Use task/role instructions plus the joint contract's optional allow-list or inherited-set exclusions. Capture the effective tool subset under existing governance and pass only that executable set to the shared SDK loop. No new role registry or parallel permission service is required. All child work excludes Memory mutations using existing operation/capability classifications; main-Companion continuation keeps its ordinary permitted tools. Preserve factual provider capabilities/digests, explicit empty toolsets and native memory eligibility. Prompt wording and `activeTools` disclosure do not replace executable membership enforcement.

## Failure and lifecycle contracts

Stopping the parent terminates only that execution. Completion can request later eligible parent work; parent queue/admission and publication gates still apply. A user-stopped child cannot be restarted by a parent follow-up; the follow-up may be retained without execution until explicit user continuation. Parent interruption may be resumed by the parent. All cases preserve known outcomes and never replay uncertain effects automatically.

## UI and rollout

Expose child work through the existing Home navigation/read-model patterns. Use human-readable task/progress labels and explicit selected-child controls, preserving reconnect targeting. Relationship speech and private working transcript remain distinct. Rollout uses the existing application configuration/activation conventions where needed; no extra product permission flow is introduced.
