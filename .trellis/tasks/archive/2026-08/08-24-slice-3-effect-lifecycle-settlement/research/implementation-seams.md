# Slice 3 Current Effect Implementation Seams

## Conclusion

Add one Core-owned `EffectLifecycleService` between Run lifecycle ownership and the existing production executors.
Keep `ToolLoopAgent`, Governance/Approval, Host broker, MCP generation manager, and Memory coordinator as domain owners.
The service durably brackets actual uncertain effects with intent and settlement; it is not a second runtime.

## Existing Run and Event Authority

- `packages/shared/src/harness-schema.ts:31-40,126-170` already reserves Run/Attempt states and captures model, Host,
  extension, governance/approval, Memory, replay, and budget references.
- `packages/core/src/db/run-repo.ts:49-179,224-302` owns admission, start, retry, cancel, terminal settlement, CAS, and
  active-Attempt checks.
- `packages/core/src/db/run-repo.ts:86-119,244-269` writes Slice 2 lifecycle events in the same transaction and publishes
  after commit.
- `packages/shared/src/run-event-schema.ts:8-21` is still lifecycle-only; real effect categories must extend its closed
  union without open payloads or placeholders.
- `packages/core/src/harness/run-service.ts:35-104` owns process-local captured Run context and delegates durable lifecycle
  transitions to RunRepo.

## Production Model and Tool Seam

- `packages/core/src/server/methods/chat-send.ts:47-71` validates, admits, and acknowledges `{messageId, runId}`.
- `chat-send.ts:89-175` starts the active Attempt, pumps ChatAgent, links overflow retry, and performs final Run settlement.
- `packages/core/src/agents/chat-agent.ts:213-251` constructs `ToolLoopAgent` and invokes `agent.stream`.
- `chat-agent.ts:257-286,422-437` persists primary response messages and partial text across normal/error/abort endings.
- `chat-agent.ts:288-302` assembles Memory/Core/Character/capability/MCP/Skill tools.
- `chat-agent.ts:314-340` fires AutoMemory/image writes and usage reporting after the stream; usage is detached,
  non-durable calibration and rejected usage promises are dropped.

Required adaptation:

- Wrap each actual model request used by ToolLoopAgent with one effect intent/settlement.
- Wrap actual tool execution at the outer governed boundary after effective-argument validation and Approval, immediately
  before the raw closure.
- Preserve primary Timeline persistence, cancel-retract, partial output, and the existing one-time clean context-overflow
  retry.

## Governance and Approval Seam

- `packages/core/src/governance/core-tool-governance-adapter.ts:33-77` wraps Core-local tools and presentation.
- `packages/core/src/governance/governed-tool.ts:33-81` authorizes, awaits Approval when required, rechecks policy/binding/
  generation, and only then executes the original closure.
- `packages/core/src/approval/approval-interaction-state.ts:52-136` owns pending interaction, owner/session, generation,
  expiry, stale answers, and cancellation.

Required adaptation:

- Persist Approval as a wait/reference phase, not proof that the target effect ran.
- Denial/expiry/cancel settles the wait without target intent.
- Approval success must be followed by final policy/generation revalidation before target intent commits.

## Host Seam

- `packages/core/src/capabilities/route-capability.ts:41-127` resolves the exact Host and passes captured connection,
  catalog, policy, projection, and current-generation checks to the broker.
- `packages/core/src/capabilities/capability-broker.ts:101-178` seals Host control including run/operation/attempt ids,
  Host generations, input digest, idempotency, dispatch/deadline timestamps, and terminal classification.
- `packages/core/src/capabilities/capability-broker-state.ts:80-124` bounds pending calls and distinguishes cooperative
  cancellation from unsafe-effect `OUTCOME_UNKNOWN`.

Gap and adaptation:

- `routeCapability` does not currently pass admitted Core Run/Attempt/effect identity, so the broker may mint unrelated
  defaults.
- Thread Core identities into the sealed Host control while preserving Host-local operation/attempt identity, terminal
  cache, duplicate/late suppression, and no redirect to replacement generations.

## MCP Seam

- `packages/core/src/mcp/mcp-turn-tools.ts:21-75` leases the captured generation, rejects retired generations, and returns
  unknown on forced close after dispatch.
- `packages/core/src/mcp/mcp-generations.ts:12-87` owns generation draining, leases, bounded force-close, and exact-once
  client close.
- `packages/core/src/extensions/extension-registry.ts:60-105,200-232` freezes candidate generation/call budget per Run.

Required adaptation:

- Instrument the outer governed/lease/registry call boundary once; do not duplicate events at lower MCP layers.
- Capture the exact generation/lease before intent. Never redirect or silently replay on a newer generation.

## Memory Seam

- `packages/core/src/memory/memory-coordinator.ts:24-31,52-99,142-156` owns request identity, authority epoch, capability
  snapshot, provider call, and post-call authority/capability revalidation.
- `packages/core/src/db/canonical-memory-repo.ts:64-85,143-196` provides request-hash/idempotency receipts and revision
  checks for canonical Local mutations.
- `packages/core/src/memory/auto-memory.ts:73-100,130-166` owns primary conversational background Memory sequencing and
  only advances watermark after successful work.
- `packages/core/src/agents/chat-agent-non-primary.test.ts:9-45` proves non-primary turns avoid Timeline, costume, and
  conversational AutoMemory writes.

Required adaptation:

- Explicit Memory tools become Run effects referencing stable request id and authority epoch.
- Recall may be safe only under the same epoch/contract. Writes default unsafe unless exact idempotent replay is proven.
- Detached primary AutoMemory/image hooks remain outside Run correctness in Slice 3; non-primary suppression stays.

## Usage Seam

- `chat-agent.ts:325-340` reads `result.usage` only after stream completion and forwards it to a detached callback.
- `packages/core/src/main.ts:353-361` wires the callback to the context-window calibrator.
- `packages/core/src/agents/chat-agent-usage.test.ts:36-140` covers all-step totals and retract suppression.

Required adaptation:

- Reserve a usage id before provider dispatch.
- Persist an append-only usage row with the accepted model settlement, including explicit reported/estimated/unknown
  quality for failure or missing-provider cases.
- Keep the existing callback as a consumer, not authority.

## Highest-Risk Decisions

1. Model abort/error may mean the provider accepted or billed the request; do not map every abort to generic failure.
2. One model Attempt can contain multiple parallel tool effects; effect state must be subordinate and independently CAS-
   guarded.
3. Approval deadline and Host deadline are currently adjacent defaults but not one propagated Run deadline contract.
4. Primary Timeline user row is appended before the first model-effect intent; preserve Timeline ownership and document
   or bridge the crash ordering gap without faking conversation rows.
5. Legacy Memory writes and detached AutoMemory lack the same durable idempotency as canonical Memory operations.

## Slice 3 / Slice 4 Split

Slice 3 persists live intent, settlement, replay posture, reserved identities, usage, stale/duplicate classification,
and truthful unknown outcomes. Slice 4 scans unfinished effects after restart, reconciles orphaned Approval/Host/MCP/
provider work, executes explicitly safe replay, enforces durable deadlines/budgets, and repairs queue ownership.

## Required Regression Anchors

- `packages/core/src/agents/chat-agent-lifecycle.test.ts`
- `packages/core/src/agents/chat-agent-overflow.test.ts`
- `packages/core/src/agents/chat-agent-usage.test.ts`
- `packages/core/src/agents/chat-agent-approval.test.ts`
- `packages/core/src/agents/chat-agent-non-primary.test.ts`
- `packages/core/src/capabilities/capability-broker*.test.ts`
- `packages/core/src/mcp/mcp-generations.test.ts`
- `packages/core/src/memory/memory-coordinator*.test.ts`
- Slice 1 RunService/RunRepo tests and Slice 2 RunEvent repository/live/projection tests.

## Reference Direction

PI `references/pi-main/packages/agent/docs/harness.md:129-205,452-464,1894-1916` is the primary source for the effect
sandwich, reserved result/usage identity, authoritative usage, and safe/never replay. DSH
`references/deepseek-harness-master/docs/tool-execution-pipeline.md:4-60` is used only for fixed execution/observation
boundaries. The complete adopt/adapt/reject evidence remains in `effect-lifecycle-references.md`.
