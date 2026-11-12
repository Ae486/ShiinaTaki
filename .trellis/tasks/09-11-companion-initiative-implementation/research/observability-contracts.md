# Research: Companion initiative observability and integration contracts

- Query: Define concrete admission, autonomous-context, tool/outcome, held-delivery and Monitor adaptations on the existing framework, including lifecycle and compatibility hazards.
- Scope: internal; current T4 source, existing specs and the parent Heartbeat research. Signal/Pattern/Intention/Presence domain design and Memory integration inventory remain parent/peer responsibilities.
- Date: 2026-09-11
- Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`; new task metadata is `planning`.

- Packaging: observability and integration portion of the preserved assessment; see the [index](runtime-and-observability.md).
- Companion context: [Runtime contracts](runtime-contracts.md) contains the complete source-boundary map, admission/context/tool/terminal/delivery contracts, runtime Skill installation and User Timezone addendum.
- Retention note: the original assessment sections below are preserved verbatim. Their historical statement that only one report was written describes the assessment stage; this later packaging-only edit splits it into these two parts and the index.

## Findings

### 5. Existing DSH Monitor: producer-first extension, no fabricated Runs

- Continue feeding the existing model/tool/usage observers by carrying real Run/Attempt/Effect identities (`run-observability-telemetry.ts:32-36`). The normal Character Run query already includes initiative (`observability-query-service.ts:95-99`). A separate initiative trajectory panel, execution store or SDK telemetry loop is unnecessary.
- Add bounded, **versioned business facts** from the lifecycle owner that actually commits them. Suggested v2 vocabulary is below; names are proposed schema identifiers, not existing implementation.

| Fact family | Authoritative producer / minimum information |
| --- | --- |
| `initiative.decision` | Decision commit: captured opportunity/manifest reference, matched-source references, `silent/express/speak`, decision time and approved policy version. No raw prompt or hidden reasoning. |
| `delivery.staged`, `delivery.deferred` | Delivery transaction: delivery identity, immutable class, expiry and closed deferral reason. Waiting executable work also records the original Attempt/continuation identity. |
| `run.delivery_waiting`, `run.delivery_resumed` | RunRepo CAS transitions: actual phase and reason; never infer waiting from elapsed UI time. |
| `delivery.dispatch_committed`, `delivery.sent`, `delivery.unknown` | Atomic delivery/budget boundary and actual transport producer. Charged, dispatched and confirmed sent remain distinct fields. |
| `delivery.presented`, `delivery.expired`, `delivery.suppressed` | Validated frontend observation or Core policy/TTL transition, with exact delivery identity and bounded semantic reason. Late facts do not reopen execution. |

**Pre-admission diagnostics:** do not insert a dummy Run/Attempt or make `run_events.run_id` nullable. Persist bounded policy facts in the **same eligibility/budget authority** used by the domain: current/last evaluation, closed reason, evaluated/next-check timestamps, expiry, actual per-reason counters and a bounded recent-decision window. Coalesce repetitive idle checks; bound retention/count and exclude raw observations. This records policy evaluation, not an alternative execution lifecycle. Extend the existing `ObservabilityQueryService` with an operator-only Character-scoped policy read model (for example `observability.policy`), presented beside real Runs rather than inside `runs[]`. Use its own policy cursor/status, never a counterfeit Run cursor. Monitor disabled mode still leaves policy execution correct and durable.

**Schema compatibility must be planned before producers ship:**

- Current `RUN_EVENT_SCHEMA_VERSION` is `run-event.v1`; categories/kinds/sources are closed (`run-event-schema.ts:30-44`), payloads form a discriminated union, and `expectedCategoryAndSource` verifies ownership (`:201-233`). `RunEventRepo` parses both reads and writes (`run-event-repo.ts:55-60`, `:78`). Simply emitting a new string breaks readers, including replay of persisted rows.
- Recommended migration is reader-first: preserve the v1 decoder unchanged, add a strict v2 business-event envelope/union, and decode both. Existing v1 producers/history need not be rewritten. Update source/category validation, construction helpers, summary/trajectory/Inspector projections, labels and bounded filters together. `observability-schema.ts:117-119` already reserves a `delivery` phase, but that is only vocabulary, not a delivery producer.
- The SQL ledger has text version/kind fields and an immutable real-Run foreign key (`025-run-events.ts:5-8`); no second event table or historical rewrite is needed for these Run facts. New delivery/continuation/policy state still requires its own additive migration and lineage review.
- Core/Shared/Desktop rollout must account for older Monitor decoders. Enable v2 producers only with readers that support them; an older client must receive a negotiated unsupported/unavailable view rather than invalid frames, raw fallback payloads or silently skipped canonical facts. Preserve cursor progress, bounded backfill and disabled-mode behavior. Rollback to a binary unable to read newly written v2 events is not a safe database downgrade.
- The durable decision/delivery/budget write is correctness-critical and must commit atomically with its required business fact. Optional telemetry enrichment remains contained. Preserve `assertHealthy()` for authoritative Effect settlement failures; do not turn SDK callback isolation into false completion.

### Proposed implementation ownership by slice

These are proposed file responsibilities; every new path below is an adaptation target, not a claim that it exists. In this table, `core/src/` abbreviates `packages/core/src/`; following module-relative names share that package prefix. A single integration owner should serialize edits to `main.ts`, Shared exports and migration registration.

| Slice / owner responsibility | Existing touchpoints and proposed additions |
| --- | --- |
| A — Shared contracts and compatibility | `packages/shared/src/harness-schema.ts`, `run-event-schema.ts`, `observability-schema.ts`, `timeline-schema.ts`, existing Avatar protocol; new bounded initiative execution/decision/delivery schemas. Own v1/v2 compatibility tests before writers. |
| B — Admission/runtime adapter | `core/src/agents/turn-queue.ts`, `server/methods/chat-send.ts`, `harness/run-service.ts`; new `core/src/initiative/run-adapter.ts`. Domain eligibility calls this boundary; Scheduled remains the regression consumer. |
| C — Context and tool/terminal policy | `harness/run-snapshot-capture.ts`, `agents/chat-agent.ts`, `agents/request-preparation.ts`, `governance/core-tool-governance-adapter.ts`; new focused autonomous-context, run-tool-policy and heartbeat-response modules. |
| D — Delivery, continuation and recovery | New `core/src/delivery/` coordinator and linked `db/run-delivery-repo.ts`; adapt `db/run-repo.ts`, `harness/recovery-coordinator.ts`, `db/timeline-repo.ts`, `agents/conversation-store.ts`, server sender/subscriptions and governed avatar boundary. Hold/resume and recovery ship together. |
| E — Desktop delivery evidence | Existing client facade, `features/chat-bubble/bubble-activity-binding.ts`, bubble presentation/store, `windows/pet/restore-pet-connection.ts`, Home Timeline renderer and ordinary timeline client path. Add whole-utterance delivery/presentation observation without faking primary activity. Coordinate Presence producer work with the domain owner. |
| F — Monitor/read models | `core/src/observability/observability-query-service.ts`, event projection, run summary, Inspector and `server/methods/observability-methods.ts`; Shared labels plus existing `windows/home/pages/monitor/` controller/view/trajectory. Read domain policy diagnostics; do not duplicate budget computation. |
| Integration owner | `core/src/main.ts`, `packages/shared/src/index.ts`, migration index/ordering and targeted module indexes/spec updates. Consume the parent's current upstream convergence plan; do not revive the obsolete migration-035 bridge problem or change unrelated Avatar Lab work. |

Monitoring facts are delivered with each producing slice; slice F assembles projections and final UX, not a late attempt to reconstruct missing source facts.

### Critical cross-layer tests (planned, not run)

Test paths beginning `agents/`, `harness/`, `governance/`, `server/`, `db/`, `skills/`, `avatar/` or `observability/` are relative to `packages/core/src/`. Paths beginning `windows/` or `features/` are relative to `apps/desktop/src/`.

| Risk / required assertion | Meaningful existing anchors and extensions |
| --- | --- |
| Admission race / priority | `agents/turn-queue.test.ts:7`, `:27`, `:44` establish same-key serialization, cross-Character concurrency and FIFO. Add primary reservation before asynchronous admission, background refusal before Run creation, abort cleanup, bounded coalescing and no forced interruption at max-wait. Extend `server/methods/chat-send.test.ts` and `scheduler/scheduled-run-adapter.test.ts`. |
| No fake Runs for checks | Eligibility integration asserts zero provider calls and unchanged Run/Attempt/Effect counts for denied/idle/busy checks, while persisted policy facts and `observability.policy` agree after reopen. Admitted work still passes `harness/run-service.test.ts` idempotency/atomic admission cases. |
| Actual thin prompt / immutable retries | `agents/chat-agent-non-primary.test.ts:19`, `harness/run-snapshot-capture.test.ts:13`, `agents/chat-agent-compaction-seam.test.ts:108`. Inspect the real outgoing mocked SDK request, not only builder output: no full history or fake Timeline row, original manifest across retries, no costume consumption or primary pressure/auto-memory write. |
| Run policy and terminal semantics | `governance/core-tool-governance-adapter.test.ts:165`, `:198`, `:280`; `governance/governed-tool.test.ts:156`, `:183`, `:201`. Add allowed schema versus rejected execution, unknown binding, policy/generation drift, no unattended dialog, invalid/duplicate terminal decision, step-cap without decision, and no private text delta delivered. |
| Held presentation and terminal dispatch | `harness/recovery-coordinator.test.ts:43`, `:51`, `:65` and RunService stale/duplicate tests. Add model complete -> waiting -> primary executes -> same-Attempt presentation, expiry without rerunning model, stale authority refusal, terminal guard refusing all tool/Host/avatar dispatch, latest-wins replacement and each crash boundary. A terminal model Effect must not auto-complete an outstanding continuation. |
| Atomic text delivery / Class B counters | Extend `db/timeline-repo.test.ts`, `server/timeline-subscriptions.test.ts`, and new delivery repository/coordinator tests. Concurrent same-identity/different-identity sends cannot exceed caps/gap or duplicate rows; pre-publish failure releases capacity, uncertain fan-out does not refund; Class A is independent; outer transaction failure publishes nothing. |
| Sent/presented/expired evidence | `avatar/avatar-tools.test.ts`, `server/timeline-subscriptions.test.ts:27`, `:47`, `windows/pet/restore-pet-connection.test.ts:155`, `features/chat-bubble/bubble-activity-binding.test.ts:46`. Zero subscribers or `ok:true` cannot become shown; stale/foreign/duplicate ACKs cannot become fresh presentation; multi-client presentation counts one logical utterance; reconnect cannot replay expired bubble/animation commands. Coordinate Presence/ignore-backoff assertions with its owner. |
| Durable DSH replay / version compatibility | `db/run-event-repo.test.ts:50`, `:60`; `observability/observability-query-service.test.ts:27`, `:29`, `:30`, `:130`; `server/methods/observability-methods.test.ts:38`, `:69`; Desktop `monitor-controller-races.test.ts:81`, `:125`. Mixed v1/v2 DB reopen and bounded backfill preserve facts/cursors, unknown is distinct from zero, same terminal Run receives late delivery evidence without reopening, and labels omit technical bookkeeping. |
| Observer failure is not execution success | `agents/run-observability-telemetry.test.ts:94`, `:106`: optional event-enrichment failure stays contained while authoritative settlement failure reaches `assertHealthy`. Extend this with a failed required decision/delivery transaction and confirm no publication or successful receipt. |

Relevant integration validation later includes the existing isolated real Core harness, Shared/Core/Desktop type checks and focused/full affected suites, plus real Home/Pet presentation with an authenticated client. Source/test presence does not establish those runtime or owner-only checks as passed.

## Related specs and reused research

- New seeded `prd.md` and parent `.trellis/tasks/09-08-t4-heartbeat/prd.md` / `research/grill-decisions-2026-09-08.md`; parent `research/current-readiness.md`, including its 2026-09-11 root refresh.
- `.trellis/workflow.md` Phase 1 research/planning and active-task dispatch contract.
- `.trellis/spec/backend/observability-projection.md:48-79`, `:81-110`, `:149-173`: producer facts, privacy, callback failure isolation, bounded replay and cross-layer validation.
- `.trellis/spec/backend/agent-runtime.md:95-113`, `:265-304`: SDK terminal-stop behavior and Scheduled/shared-runtime boundaries.
- `.trellis/spec/backend/compaction-harness.md:30-37`: request-local reduction and primary-only relationship pressure.
- `.trellis/spec/backend/permission-authorization.md:243-261` and existing guarded tool/Effect source: one authority, current bindings and unattended fail-closed behavior.
- ADR0008/ADR0010, `docs/T4-HANDOFF.md` sections 5.1/5.4/5.7/5.8, and the existing Heartbeat research's bounded busy rule. Frozen requirements are reused rather than reopened.

## External references

No new external research, services or dependencies were used. AI SDK and transport recommendations are adaptations of the installed code/spec contracts; API-specific implementation details still require normal source/API verification when coding.

## Caveats / Not Found

- Confidence is high for current source boundaries and the identified lifecycle hazards. Proposed APIs, v2 events, persistence and slice ownership are design recommendations; no implementation or runtime validation was performed.
- No additional owner decision was found within this bounded runtime scope. Domain source selection, Presence evidence policy and provider-neutral Memory composition remain the parent/peer design inputs; conservative priority/expiry/unknown handling need not become new product questions.
- Only this report was written. No tests, services, dependency changes, Git operations, task-state changes, production/spec edits or external research were performed.
- The legacy `.trellis/.current-task` now names Avatar Lab; the new explicit active-task assignment and its planning metadata were used. The legacy pointer was not changed.
- Earlier source line numbers can drift: the current telemetry identity guard is at `run-observability-telemetry.ts:32`, not the older entry-point line cited in prior discussion. Main integration facts belong to the parent's dated refresh and were not re-investigated here.

