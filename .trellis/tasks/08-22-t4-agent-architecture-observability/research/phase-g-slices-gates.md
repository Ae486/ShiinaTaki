# Phase G - Implementation Slices and Gates

> Scope: reserve independently verifiable implementation slices without treating the first batch as the final
> architecture. Every later slice must update this plan if evidence changes an assumption.

## 1. Planned Slices

| Slice | Outcome | Depends on | Does not include |
|---|---|---|---|
| 0. Semantic synchronization | T4 compiles against stable main Memory/Hindsight seams; migration lineage and merge hotspots reviewed | Phase A-D contracts | Production Run/Event code; dirty-main copying |
| 1. Harness foundation | Shared Run/Attempt/outcome schemas, Run-owned current state, admission handoff, immutable snapshot, primary chat adapter, minimal Receipt/query seam | Slice 0; Phase B/C/E contracts | Scheduler timers, Heartbeat policy, Home/Pet product UI |
| 2. Durable event ledger | Run Event writer, sequence/versioning, redaction envelope, post-commit live plane, projection rebuild anchor | Slice 1; Phase C/D contracts | Full monitor UI and third-party export marketplace |
| 3. Runtime/effect integration | Model/tool/Host/MCP/Approval intent/settlement, authoritative usage, stale completion, non-primary Memory behavior | Slice 1-2; Phase E mapping | New low-level model loop |
| 4. Recovery/admission hardening | Durable queue status, cancellation reconciliation, orphan worker, safe replay/unknown outcomes, deadline/budget enforcement | Slice 1-3 | Provider-specific schedule/Heartbeat eligibility |
| 5. T4 consumers | Scheduled Task, Heartbeat, delivery/reliability, Child Run implementation, later knowledge/review | Slices 1-4 and each provider PRD | Back-porting provider policy into Core |

Slices may be reordered or split, but every child must state its reserved future seams, migration impact, tests,
non-goals, and rollback/compatibility plan. A passing Slice 1 is not permission to close later recovery,
observability, or Child Run work.

Current Slice 0 evidence is recorded in `research/slice-0-semantic-sync-2026-08-23.md`. The semantic synchronization
of main `9895dd3` into T4 is complete and staged without a commit. Historical-lineage, activation/path confinement,
root/full-workspace, focused E2E, task-validation, and isolated-boot gates pass. Canonical Local missing-bank readiness
still needs an explicit diagnostic contract, and Hindsight remains fail-closed until its provider runtime exists; these
are recorded residuals, not authorization to widen Slice 0 or begin production Harness work.

## 2. Required Gates Before First Production Child

1. Stable main synchronization and semantic review of `main.ts`, shared exports, Memory composition, and migration list.
2. No migration number reserved from an uncommitted or stale lineage; assign after comparing all known histories.
3. Phase B-D contracts reviewed and context manifests populated for the child.
4. Primary chat behavior fixtures prove no regression in tool tail persistence, cancel-retract, approval cancellation,
   overflow retry, and Timeline/Replay boundaries.
5. Fresh-install and every synchronized historical migration-lineage boot tests are identified.
6. Privacy/redaction tests cover secrets, prompt bodies, Host/MCP payloads, and sensor/media content.

## 3. Ongoing Architecture Maintenance

When implementation evidence changes a contract, update the roadmap, affected phase report, PRD/design/implement files,
context manifests, tests/specs, and T4 handoff in one planning change. Record deferred decisions with an explicit trigger;
do not allow a batch label such as "v1" or "first production" to imply finality.

## 4. Post-acceptance follow-up slices (2026-08-27)

Owner acceptance of the first Monitor projection confirmed the ledger/query/live boundary, while exposing productization
gaps that were intentionally outside that child. Reserve the following independently verifiable slices:

1. **UI/UX reactive refresh and streaming baseline** — consolidate disposable client read-model revalidation for
   Perception, Monitor, and Chat; restore live subscriptions after generation replacement; support lazy paging,
   refreshing/stale/error states, tail-following, and incremental tool-call/tool-result/approval rendering.
2. **DSH observability expansion** — add fixed Core event producers before extending the projection for model/provider
   requests, tool lifecycle, usage/tokens, context, timings, governance/approval, delivery, recovery, retry, and any
   provider-backed cache semantics. Extend filters/inspector/UI only from durable, replayable facts.
3. **Tool/loop diagnostics and avatar contract** — reproduce missing-argument and failed-tool behavior across avatar,
   Tavily/MCP, and a local Core tool; classify schema, execution, feedback, and next-step generation behavior before
   selecting a provider-neutral repair/retry or tool-contract change.

These follow-ups do not alter the single Run/Event authority, do not create a second Agent loop, and do not turn the
current Monitor child into a final architecture. Their child PRDs must state dependencies, reserved seams, privacy
rules, and rollback points before implementation is activated.
