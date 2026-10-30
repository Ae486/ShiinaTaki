# Reference designs for shared Companion initiative

## Evidence and adoption boundary

This file consolidates the read-only Hermes/OpenClaw investigation discussed with the owner on 2026-09-11. It is a design reference, not a dependency proposal or proof that Taki already implements these mechanisms. No third-party implementation is copied.

- Hermes: local `references/hermes-agent-main` snapshot, package version `0.18.2`. The snapshot has no `.git` revision, so it cannot be claimed to match current upstream exactly. All cited paths are relative to that reference root.
- OpenClaw: fixed commit [`1b2b06ed2fc7680648a1a554c100b887a1de39dd`](https://github.com/openclaw/openclaw/tree/1b2b06ed2fc7680648a1a554c100b887a1de39dd), read on 2026-09-11. Official documentation was read alongside fixed-commit source. Later upstream changes do not silently alter this evidence.
- Source tests were read, not executed. These references do not replace Taki's regression, native-client or owner acceptance.
- PI remains the existing Runtime/Harness architecture reference, and DSH remains the observability reference. Hermes/OpenClaw inform trigger/product mechanisms; do not combine their runtime state models into a second authority.

## Common architectural lesson

Hermes represents recurring work with shared job definitions and execution facilities; Agent jobs reuse `AIAgent.run_conversation`. OpenClaw represents its current periodic Heartbeat as a system-owned job in the Automations/Cron scheduler and dispatches through shared Agent facilities. Both retain execution/context/delivery distinctions. Neither requires a separate Agent loop for every reminder, check-in or report.

Taki's corresponding adoption is: source adapter -> deterministic eligibility/candidate selection -> existing TriggerRequest/RunService/ChatAgent -> governed effects -> ordinary delivery and existing Monitor. Scheduled definitions, one-shot Intentions and recurring Patterns retain their different lifecycles while producing compatible execution requests.

## Seven concerns mapped to evidence

### 1. Multiple candidates, coalescing and busy arbitration

OpenClaw [`src/infra/session-event-wake.ts`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/infra/session-event-wake.ts#L47-L114) uses a short coalescing window, bounded active targets, Agent/session grouping and a task map keyed by job identity. Scheduled work may be merged into compatible slots; task and event rounds still remain distinct. Its heartbeat preflight also checks active runtime lanes; the Cron owner waiting for Heartbeat settlement is excluded to avoid blocking itself (`heartbeat-runner-execution.ts:189-217`).

Hermes `cron/jobs.py:1803` coalesces missed recurring fires; `cron/scheduler.py:3972` uses running-set deduplication and serial/parallel pools. Gateway `gateway/platforms/base.py:4855` can merge internal text events while busy. That merge concatenates text and must not be mistaken for a source-preserving semantic candidate model.

**Adopt:** stable identity, bounded batching, primary priority, busy deferral and recovery-safe ownership. **Taki-specific:** choosing which human concern is worth pursuing, retaining each candidate's provenance, and preventing multiple simultaneous Patterns from producing several unsolicited utterances.

### 2. Self-generated event loops

OpenClaw [`heartbeat-cooldown.ts`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/infra/heartbeat-cooldown.ts#L3-L27) explicitly describes tool-generated exec events creating consecutive Heartbeat rounds. It adds spacing/flood controls. `heartbeat-runner-run.ts:104-108` suppresses outbound hooks, and `heartbeat-runner-prompt.ts:102-105` filters part of its own delivery-awareness input.

Hermes `gateway/run.py:16040` deduplicates completion events using delegation/process incarnation identity. Cron removes recursive scheduling tools. Its `_MAX_INTERRUPT_DEPTH=3` at `gateway/run.py:20630` only requeues at the recursion limit; a later task can continue. `agent/turn_context.py:265` recreates the iteration budget each turn. Neither fact is a general cross-Run continuation budget.

**Adopt:** event identity, source-specific suppression and shared rate bounds. **Do not claim:** a complete generic causation/cycle protocol. Taki preserves producer-known cause/Run references and unknown provenance; D79 must supply action-attribution/suppression before enabling effects that can look like fresh user activity.

### 3. Execution cost versus user interruption

OpenClaw's referenced defaults include event-wake spacing and flood thresholds; its [`heartbeat-dispatch.ts:404-417`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/infra/heartbeat-dispatch.ts#L404-L417) also suppresses repeated plain-text delivery within a window, with exclusions for media/structured replies.

Hermes `tools/process_registry.py:63` implements per-process/global watch-event throttling and a circuit breaker. Its queue/pool and per-turn iteration controls bound computation or source storms.

**Adopt:** separate counters and rate enforcement at their actual owners. **Taki-specific:** a shared policy for the effect on the user. Model requests, utterance publication, visual presentation and future window operations are not interchangeable counters. Do not import reference constants as Taki defaults; use the already accepted T4 calibration.

### 4. User presence, message evidence and Host readiness

OpenClaw distinguishes [generic client presence](https://docs.openclaw.ai/concepts/presence) from [active computer presence](https://docs.openclaw.ai/nodes/presence). The fixed [active-computer document](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/docs/nodes/presence.md#L53-L102) describes authenticated current-connection activity, server-derived timestamps from bounded idle age, cleanup on replacement/disconnect/revocation, and native HID input that excludes synthetic computer-control input. Continuous activity does not generate model-facing system events.

That activity producer is native macOS-only. Mobile/background last-seen signals do not establish active-computer status, and none of this proves that a particular message was read.

Hermes `gateway/config.py:789` calls an enabled/credential check `get_connected_platforms`; this is not human presence. `gateway/run.py:9279` distinguishes real inbound activity from internal events. WhatsApp `sent/delivered/read` callbacks exist but `gateway/platforms/whatsapp_cloud.py:1547,1624` logs them rather than feeding Agent scheduling.

**Adopt:** separate authenticated evidence axes, freshness, retirement, minimum data and explicit unknown. **Taki-specific:** Windows source semantics, independent operator/Node identities, cross-window/phone frontend aggregation and per-message response opportunity. Windows `GetLastInputInfo` cannot inherit the reference's hardware-only guarantee.

### 5. Definition, Run, delivery and recovery lifetimes

OpenClaw [`src/cron/heartbeat-monitor.ts:99-117`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/cron/heartbeat-monitor.ts#L99-L117) creates a stable system-owned scheduling definition. [`task-run-history.ts:131-140`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/cron/task-run-history.ts#L131-L140) reads execution history from its authoritative Task ledger. In `timer-execution.ts`, Heartbeat waits for actual settlement, while an ordinary `systemEvent + next-heartbeat` path returns after issuing a wake. These success boundaries are not identical.

Hermes has separate `cron/jobs.json`, `cron/executions.py` execution records, isolated sessions and saved output. The ledger distinguishes claimed/running/completed/failed/unknown, and owner-exit recovery does not automatically replay old executions. Future recurring fires can still occur normally. Its `wakeAgent:false` uses successful/completed execution rather than a separate no-model outcome, so the label alone does not describe everything Taki needs.

**Adopt:** explicit definition/run/delivery lifetimes and safe non-replay. **Taki-specific:** Pattern revisions, Intention expiry, related factual Memory, structural silent/express/speak and the existing Run state machine. Use Taki's ledger rather than copying either reference ledger.

### 6. Switch and pause scope

OpenClaw's referenced `heartbeat.every=0m` disables recurring cadence while some targeted wakes remain possible. `pauseScheduling()` pauses automatic ticks while existing receipts can settle. Disabling an individual Cron job requests cancellation of its active execution; the compatibility Heartbeat enable setter itself only changes its wake flag.

Hermes `cron/jobs.py:1431` pause blocks future scanning/claiming but does not itself cancel a running Agent. `tools/delegate_tool.py:153` can pause new delegation while existing children continue. Local-only delivery does not mean no Agent execution.

**Adopt:** explicit scopes and tests for existing work. Taki must distinguish disabling Class B initiative, pausing a Pattern, Privacy Pause, cancelling one Run and pausing an explicit Scheduled Task. Reference command names do not determine Taki's product semantics.

### 7. Tests for not acting

| Reference test | Verified assertion / scope | Taki adaptation |
| --- | --- | --- |
| Hermes `tests/cron/test_scheduler.py:2895` | `agent_cls.assert_not_called()` after a successful `wakeAgent:false` gate. | Ineligible candidate means zero model requests, not a silent model response. |
| Hermes `tests/cron/test_scheduler.py:2685` | Saved output exists; delivery mock is not called for silence. | Retain Run evidence while creating no relationship message or presentation. |
| Hermes `tests/gateway/test_completion_delivery.py:112` | Duplicate completion queues invoke the adapter once within one Gateway lifecycle. | Add durable Taki deduplication/restart proof, not only an in-memory guard. |
| Hermes `tests/cron/test_execution_ledger.py:207` | Independent processes preserve an unknown execution without automatic retry. | Preserve uncertain effects and old output identity after process loss. |
| OpenClaw [`service.prevents-duplicate-timers.test.ts:75`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/cron/service.prevents-duplicate-timers.test.ts#L75) | Two schedulers sharing one partition enqueue once. | Candidate/admission and publication accounting must be atomic and idempotent. |
| OpenClaw [`service.restart-catchup.test.ts:390`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/cron/service.restart-catchup.test.ts#L390) | Startup-deferred work does not call the isolated Agent runner. | Expired/unknown restart state cannot become a new model opportunity. |
| OpenClaw [`heartbeat-wake.test.ts:865`](https://github.com/openclaw/openclaw/blob/1b2b06ed2fc7680648a1a554c100b887a1de39dd/src/infra/heartbeat-wake.test.ts#L865) | An unfinished wake recovers after handler replacement. | Replacing a lifecycle owner must retain valid work without accepting stale callbacks. |

## Additional reference boundaries

- Hermes's `script` gate and `no_agent` mode show why deterministic checks can avoid model cost. Taki does not need arbitrary script execution in its v1 eligibility policy.
- Current OpenClaw documentation explicitly records removal of experimental inferred conversational commitments. Do not assume it supplies Taki's automatic one-shot Intention product contract, and do not invent a reason for the removal.
- Taki's same-Monitor integration is grounded in its own existing `run-observability-telemetry.ts`, `run-event-schema.ts` and query/projection code. Importing a reference logger or Task system would contradict the accepted architecture.
- New behavior descriptions remain data. New signal types, new device capabilities and new safety policies require their own small adapters or shared code changes with tests; a single configurable object does not eliminate those real boundaries.

## Further reading

- [Hermes Cron guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron).
- [OpenClaw Automations versus Heartbeat](https://docs.openclaw.ai/automation/cron-vs-heartbeat).
- [OpenClaw Heartbeat guide](https://docs.openclaw.ai/gateway/heartbeat).
- Existing Taki surveys: `.trellis/workspace/pleia/m5-proactivity-survey.md`, `t4-heartbeat-engine.md`, `t4-prompt-design-survey.md`, interpreted through `decision-register.md` rather than treated as current code facts.
