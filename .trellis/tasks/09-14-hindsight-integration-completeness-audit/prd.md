# Hindsight integration completeness and usability audit

## Goal

Audit the accepted Hindsight integration, Local/Hindsight switching, memory-related multi-endpoint use, and all remaining parent-design requirements against live source and existing acceptance evidence. Deliver a completeness matrix and prioritized closure plan before further B7 grill; research and documentation only.

## Requirements

- Account for all accepted parent requirements R1-R10 and the relevant ADR, design and later owner/grill amendments.
  Use the latest explicit ruling when historical task prose describes an older implementation or contract.
- Audit Hindsight setup and first activation, complete standalone Local use, ordinary Hindsight memory use,
  synchronization/degraded recovery, planned return/re-entry, emergency takeover, and operation/runtime lifecycle.
- Audit the memory-related part of multi-endpoint use: multiple clients of one Core, local/remote Core binding,
  authentication, secret/config ownership, reconnect and operation recovery, and clearly bounded cross-Core scenarios.
- Audit backup/restore/upgrade, compatibility and deployment prerequisites, Bank/Character lifecycle, import/export,
  maintenance, model/tool capabilities, and other accepted functions that could prevent a documented use case working.
- For every requirement record design authority, original owner/batch, live implementation evidence, actual boot/RPC/UI
  or helper reachability, existing validation and its limits, remaining work, dependency and concrete acceptance case.
- Separate implementation, reachability and verification. A schema, helper receipt, isolated test or old checked box
  does not prove an operator can execute the complete feature from the shipped application.
- Distinguish blockers to basic use, blockers to a specific advertised workflow, accepted limitations, explicit deferrals
  and out-of-scope requests. Include D79-D83 with their current deferral and practical impact, without reauthorizing them.
- Produce a prioritized closure route that makes missing dependencies and integration gates visible before further B7
  grill. Preserve the accepted verified-baseline/mapping/change-reuse rule and all authority/data-integrity guarantees.

## Acceptance Criteria

- [x] Every parent requirement family and relevant later amendment has at least one traceable completeness-matrix entry.
- [x] Required user journeys expose their first blocking step, including complete repeated Local/Hindsight switching.
- [x] Memory-related multi-client/remote-Core scenarios are distinguished from unsupported or unrequested cross-Core merging.
- [x] Every missing/partial/unconnected finding has exact source evidence or a bounded negative-search record.
- [x] Existing verification, missing integration/manual verification, and unrun live operations are reported separately.
- [x] D79-D83 and other accepted limitations remain visible without silently changing their priority or scope.
- [x] A dependency-ordered closure plan and testable usable-state acceptance checklist are delivered.
- [x] Task context, local document links and the matrix coverage references validate.

## Sequencing and authorization

The owner explicitly approved creation and planning on 2026-09-14. This research is inserted under the existing
[Hindsight parent](../08-09-hindsight-memory-provider/prd.md), before further [B7 grill](../08-09-memory-operations-ui/grill.md).
B7 U1 remains unanswered. Research and documentation are authorized; product implementation is not part of this task.

## Out of Scope

- Production code, schema changes, authority activation, original user database access, real model calls, service
  deployment, dependency changes, commit/push, task archive, or unrelated worktree changes.
- Reopening settled preservation/replication choices, implementing the identified gaps, or expanding unrelated T4 work.
- Treating multiple devices as authorization for active-active memory or automatic merging between independent Cores.

## Research References

- [Delivered audit overview](research/README.md).
- [54-entry completeness matrix](research/completeness-matrix.md).
- [Dependency order and 16 acceptance cases](research/closure-plan.md).
- [Grounded B7 scope and prior source audit](../08-09-memory-operations-ui/grill.md).
- [Bounded B6 closeout](../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md).
- [D79-D83 follow-up inventory](../08-09-memory-runtime-integration/research/memory-capability-followups-2026-09-13.md).
- [Audit method and evidence model](design.md).
- [Research execution checklist](implement.md).
