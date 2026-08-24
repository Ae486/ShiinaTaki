# Research: Slice 3B Governed Tool, Approval, Host, and MCP Seams

- Query: Review the production Slice 3B execution chain and identify the smallest safe API/file changes needed to bracket one logical AI SDK tool effect with Governance, Approval, Host/MCP dispatch, durable intent, and settlement.
- Scope: internal (current TakiAgent source, shared schemas, Rust Host path, tests, Trellis specifications, and Slice 3 design/research artifacts)
- Date: 2026-08-25

## Files found

- `packages/core/src/agents/chat-agent.ts` — ToolLoopAgent construction, three-way tool composition, and mutable TurnContext identity.
- `packages/core/src/governance/governed-tool.ts` — canonical auto/ask/deny authorization, Approval wait, and final revalidation.
- `packages/core/src/approval/approval-interaction-service.ts` / `approval-interaction-state.ts` — Approval identity, owner/generation checks, expiry, cancellation, and invalidation.
- `packages/core/src/harness/effect-lifecycle-service.ts` / `packages/core/src/db/effect-repo.ts` — current Slice 3A Effect facade, intent/settlement CAS, usage, and event writes.
- `packages/core/src/capabilities/route-capability.ts` / `capability-broker*.ts` / `capability-challenge.ts` / `capability-response.ts` — Host routing, sealed control, challenge/resume, and duplicate/late/unknown classification.
- `packages/core/src/mcp/mcp-turn-tools.ts` / `mcp-generations.ts` / `mcp-manager.ts` — governed MCP closures, generation lease/drain/forced-close lifecycle.
- `packages/core/src/extensions/extension-sources.ts` / `extension-registry.ts` / `extension-tools.ts` / `extension-composition.ts` — direct MCP and registry-mediated extension bridge paths.
- `packages/core/src/server/methods/chat-send.ts` — Run/Attempt admission, mutable overflow replacement-Attempt rebinding, and ChatAgent wiring.
- `packages/shared/src/effect-lifecycle-schema.ts` / `run-event-schema.ts` / `host-control-schema.ts` — bounded Effect/Event contracts and Host control identity.
- `apps/desktop/src-tauri/src/ws_client.rs` / `capabilities_impl.rs` — actual Host auto/ask/resume execution ordering and Host handler dispatch.
- Focused tests under `packages/core/src/{governance,approval,capabilities,mcp,extensions}` — existing authority and race coverage; no cross-boundary exactly-once Effect proof.

## Findings

### 1. The production composition has three tool surfaces, but one AI SDK loop

`ToolLoopAgent` is still the only model/tool loop. `runAttempt` constructs it with the selected model, assembled tools, stop conditions, and optional AI SDK approval callback (`packages/core/src/agents/chat-agent.ts:229-245`). The tool set is assembled in three groups: Core/Memory/Character tools, connection-bound Skill/Host capability tools, and admission-captured Extension/MCP tools (`packages/core/src/agents/chat-agent.ts:298-312`). This is the correct integration point for a common per-tool execution coordinator; a replacement loop is not needed.

The production model path already uses Slice 3A middleware at the installed AI SDK request seam (`packages/core/src/agents/chat-agent.ts:229-232`). The existing `EffectLifecycleService` is currently only a thin `prepare`/`settle`/read facade (`packages/core/src/harness/effect-lifecycle-service.ts:4-13`). Its repository always creates `intent_committed` rows (`packages/core/src/db/effect-repo.ts:43-58`) and has no waiting-state or pre-dispatch transition API.

Conclusion (high confidence): 3B should add a shared tool-effect execution coordinator around the existing tool closures, not modify the model loop. The coordinator must own effect identity and call the existing lifecycle service exactly once per AI SDK tool call.

### 2. Core Governance has the right final-revalidation seam, but no Effect hook

`wrapGovernedTool` invokes `service.authorize` and executes immediately for an auto decision (`packages/core/src/governance/governed-tool.ts:49-54`). For an ask decision it creates a canonical Approval request with policy generation, binding, owner connection, and presentation (`governed-tool.ts:55-63`), awaits the result, then re-authorizes and checks `isCurrentAuthority` before executing the raw closure (`governed-tool.ts:65-78`). Cancellation is wired to the Approval handle and the turn abort signal (`governed-tool.ts:62-80`).

This is the canonical Core-local Governance/Approval boundary. `createCoreToolGovernanceAdapter` applies it only to the explicit Core binding table (`packages/core/src/governance/core-tool-governance-adapter.ts:12-55`). Host capability tools are intentionally not wrapped by this adapter; their authority remains in `routeCapability` plus the Host broker challenge/resume path.

Conclusion (high confidence): the smallest Governance API addition is an awaited post-revalidation dispatch hook or coordinator callback immediately before `execute(input, options)`, plus wait lifecycle callbacks around `approval.request`/`handle.result`. Adding a second outer policy wrapper would create competing authority and would miss Host tools.

### 3. Approval already exposes durable identity and all required terminal outcomes, but only in memory

`ApprovalRequestHandle` exposes `approvalId`, `result`, and idempotent `cancel()` (`packages/core/src/approval/approval-interaction-service.ts:36-48`). A pending interaction receives a UUID, captures approval and policy generations, emits the canonical request, and resolves to denied/expired/cancelled/operator-disconnected/invalidated or an allowed scope (`packages/core/src/approval/approval-interaction-state.ts:72-110`). Responses are owner-connection and generation checked; duplicate responses become `late` (`approval-interaction-state.ts:113-136`, `packages/core/src/approval/approval-interaction-service.test.ts:108-138`). Generation/policy changes retire pending requests, and `isCurrentAuthority` verifies the approved binding and current generation before execution (`approval-interaction-service.ts:60-67,111-136`).

Conclusion (high confidence): Slice 3B needs a durable wait/reference API at the Effect boundary, not a new Approval authority. The reference must include canonical `approvalId`, captured approval/policy generations, binding digest/expiry, and the final Approval outcome. A denied/expired/cancelled/invalidated wait must settle without creating a target execution intent. The current `effect.v1` schema has an `approval` source reference but no explicit approval wait metadata or transition from `waiting` to `intent_committed` (`packages/shared/src/effect-lifecycle-schema.ts:9-36`); this is a concrete shared-contract gap.

### 4. The current Core Effect repository cannot represent the required Approval-to-target ordering

`EffectRepo.prepareIntent` inserts a row directly in `intent_committed`, advances the Attempt version, and emits `effect.intent_committed` in one transaction (`packages/core/src/db/effect-repo.ts:43-58`). `settle` CAS-checks effect/run/Attempt identity, writes terminal state, advances the Attempt, emits `effect.settled`, and (for model effects) writes authoritative usage (`effect-repo.ts:60-89`). `RunEvent` already has `effect.waiting`, but its payload only carries the generic effect source/generation/replay fields (`packages/shared/src/run-event-schema.ts:21-31`).

Conclusion (high confidence): the minimum 3B lifecycle surface is more than a new caller. It needs either (a) `prepareWaiting` + `settleWaiting` + `commitIntent` CAS methods on `EffectLifecycleService`, or (b) one equivalent `execute` coordinator that persists `waiting`, performs final revalidation, commits `intent_committed`, invokes the target, and delegates to existing `settle`. The API must preserve one Tool Effect identity while storing Approval as a bounded reference, not as a second Tool/Host/MCP lifecycle.

### 5. Host routing carries the correct generation/unknown/duplicate semantics, but Core identity is incomplete

`routeCapability` resolves one exact Host/catalog, verifies descriptor compatibility against the current Core Host policy projection, and invokes the broker with the current Approval generation (`packages/core/src/capabilities/route-capability.ts:41-87`). It rechecks connection/catalog/descriptor/policy currency through `isCurrentDispatch` (`route-capability.ts:89-110`). Ambiguous legacy routing refuses with `TARGET_HOST_REQUIRED` (`route-capability.ts:112-126`).

The broker seals Host control with `runId`, Host-local `operationId`/`attemptId`, connection/catalog/policy/Approval generations, input digest, idempotency key, and deadline (`packages/core/src/capabilities/capability-broker.ts:101-125,156-178`). `CapabilityRequestIdentity` currently accepts only optional `runId`, `operationId`, and `approvalGeneration`; Host-local attempt/idempotency are always minted by the broker (`capability-broker.ts:57-61,163-175`). This is why a route call currently loses the enclosing model `attemptId` and Core `effectId`.

The response verifier rejects wrong Host, stale connection/control generation, and mismatched Approval authorization lineage before duplicate/late classification (`packages/core/src/capabilities/capability-response.ts:15-40`). Broker retirement/deadline behavior distinguishes cooperative reads from unsafe effects: unsafe interruption becomes `OUTCOME_UNKNOWN`, and late responses are suppressed (`packages/core/src/capabilities/capability-broker.ts:128-153`; `packages/core/src/capabilities/capability-broker-state.ts:80-124`). Focused tests cover wrong Host/generation, duplicate/late, disconnect, deadline, unknown outcome, and Host evidence that widens policy (`packages/core/src/capabilities/capability-broker.test.ts:52-134,208-230`).

Conclusion (high confidence): extend route/broker identity threading with typed Core correlation (`runId`, model `attemptId`, `effectId`) while retaining Host-local `operationId` and Host-local attempt identity. Do not overload Host `operationId` or `attemptId` with Core IDs. The shared Host control and Rust serde mirrors are the likely protocol surface if these correlations must cross the socket; at minimum the Core-side request identity must not silently mint unrelated values.

### 6. Host auto execution exposes an ordering limitation that must be resolved explicitly

The Host process receives `capability.request`, runs final Host enforcement, and executes immediately when the effective posture is `auto` (`apps/desktop/src-tauri/src/ws_client.rs:239-301,501-548`). For `ask`, it stores the raw input in memory-only pending state and emits a challenge; only after Core sends `capability.resume` does it revalidate and execute (`ws_client.rs:275-299,328-390,595-609`). The Host specification calls for Core-first/Host-later continuation and a common Host preflight before dispatch (`.trellis/spec/backend/host-operation-lifecycle.md:241-267,304-314`), but the current production route does not expose a Core preflight/prepare frame.

This yields a material seam caveat. If Core commits a target intent before `capability.request`, the auto path is correctly intent-before-effect, but Host may discover `ask` only after that intent and then wait for Approval. If Core waits for Host classification first, the current auto path may execute before Core can commit target intent. The current protocol therefore cannot prove the frozen `Governance -> Approval -> final revalidation -> target intent -> Host execution` ordering for both dynamic auto and ask cases without a Host preflight/prepare or an equivalent two-phase Host dispatch hook.

Conclusion (high confidence): 3B planning must either add a bounded Host preflight/authorization phase (classification response, then Core intent, then explicit Host execution/resume) or document a narrowly accepted ordering exception. Silently adding an outer Core Governance wrapper is not sufficient and would violate the existing Host authority boundary.

### 7. MCP direct and registry-mediated calls share one governed/leased closure

`buildTurnTools` currently wraps each captured MCP tool with Governance/Approval first and `withLease` outside it (`packages/core/src/mcp/mcp-turn-tools.ts:25-47,49-70`). The actual order is therefore `acquire lease -> Governance/Approval wait/revalidation -> raw execute -> release`; a generation lease can be held throughout a long Approval wait. `acquireLease` refuses draining/closed generations, `retireGeneration` drains and force-closes after a bounded budget, and `forcedClosed` causes the tool result to become `OUTCOME_UNKNOWN` (`packages/core/src/mcp/mcp-generations.ts:53-87`). Focused tests prove captured-generation execution, refusal of new leases after retirement, exactly-once close, and forced-close unknown outcome (`packages/core/src/mcp/mcp-generations.test.ts:255-307,419-432`).

`McpManager.snapshot` builds these same `buildTurnTools` closures and returns them as `McpToolSnapshot` entries (`packages/core/src/mcp/mcp-manager.ts:30-39,76-95`). `snapshotMcpExtensions` places each returned closure both in `directTools` and inside an Extension Registry candidate (`packages/core/src/extensions/extension-sources.ts:68-75,121-135`). `extension_call` invokes the candidate's captured `entry.tool` once (`packages/core/src/extensions/extension-registry.ts:79-103`; `extension-tools.ts:26-30`). Thus direct MCP keys and `extension_call` are two model-facing entry points to the same governed/leased closure, not two transport executions.

Conclusion (high confidence): instrument the shared captured MCP dispatch closure once. Move lease acquisition to the post-Approval/final-revalidation boundary, then commit the Tool Effect intent, call the exact leased generation, settle the same effect, and release in `finally`. Do not instrument both `extension_call` and the underlying MCP tool; that would double-record one logical effect. A retired generation must fail closed, and forced close/transport ambiguity must settle `outcome_unknown` without redirecting to a replacement generation.

### 8. Extension/Host bridge paths need identity threading without a new authority

The immutable Extension Run context captures host-qualified MCP/Skill/Capability candidates and a bounded call budget (`packages/core/src/extensions/extension-run-context.ts:31-58`; `packages/core/src/extensions/extension-registry.ts:60-105,108-128`). Host capability candidates call the supplied route closure with a captured `targetHostId` (`packages/core/src/extensions/extension-sources.ts:78-107`). The extension composition currently accepts only `{capabilityId,input,targetHostId}` plus optional interactive context (`packages/core/src/extensions/extension-composition.ts:18-44`), so it cannot carry the enclosing model Attempt or Effect identity.

Conclusion (medium-high confidence): extend the route/extension call context with a sealed per-turn execution context rather than making the Extension Registry a lifecycle authority. The registry should continue to enforce snapshot/generation/budget checks and return bounded outcomes; Core Effect creation/settlement belongs in the shared target dispatcher used by both direct capability tools and `extension_call`.

### 9. Existing tests provide strong domain regressions but no cross-boundary exactly-once Effect proof

Approval tests cover owner-connection binding, deny/late, expiry, cancellation, disconnect, generation changes, policy invalidation, durable always/session decisions, and unattended fail-closed behavior (`packages/core/src/approval/approval-interaction-service.test.ts:83-138,141-227`; `packages/core/src/governance/governed-tool.test.ts:67-107`). Host tests cover route ambiguity, exact target selection, stale generation, duplicate/late, disconnect/deadline, unknown outcome, and challenge/resume authorization lineage (`packages/core/src/capabilities/route-capability.test.ts:12-43`; `packages/core/src/capabilities/capability-broker.test.ts:52-134`; `packages/core/src/capabilities/capability-challenge.test.ts:108-248,276-329`). MCP tests cover generation lease/drain/forced-close (`packages/core/src/mcp/mcp-generations.test.ts:255-307,311-432`). Extension tests cover immutable snapshots, stale generation, collision rejection, and bounded call budgets (`packages/core/src/extensions/extension-registry.test.ts:39-93`).

Missing coverage (high confidence): no test currently proves one AI SDK tool call produces exactly one durable Core Effect across Core Governance, Host routing, MCP direct calls, MCP `extension_call`, parallel tool calls, or Approval wait/resume. No test proves a Host/MCP stale or duplicate callback is rejected against the same `(runId, attemptId, effectId, captured generation)` tuple at the Core Effect settlement boundary.

## Smallest bounded 3B API/file plan

The following is a research boundary, not implementation authorization. Names are illustrative; the invariants are the required part.

1. Shared effect contract (`packages/shared/src/effect-lifecycle-schema.ts`, `run-event-schema.ts`): add a bounded Approval wait reference (approval id, approval/policy generations, expiry/binding digest) and a legal waiting/target-intent transition. Keep one Tool Effect row; Host operation, MCP generation/lease, and Approval IDs remain typed references. Do not add arbitrary JSON payloads.
2. Effect transition surface (`packages/core/src/harness/effect-lifecycle-service.ts`, `packages/core/src/db/effect-repo.ts`): add waiting/approval-settlement and post-revalidation intent CAS operations, or one equivalent coordinator API that atomically emits `effect.waiting`, commits target `effect.intent_committed` immediately before dispatch, and delegates terminal settlement to the existing CAS path. Preserve exact duplicate no-op and stale classification.
3. Shared tool dispatch coordinator (new Core harness/governance adapter or the smallest existing equivalent): accept `{runId, attemptId, effectId, kind, sourceRef, replayPosture, captured authority}` and an awaited `dispatch` callback. Governance wrappers call it after final revalidation; direct Host/MCP/Extension paths use the same coordinator so each AI SDK tool call creates exactly one Effect.
4. Governance seam (`packages/core/src/governance/governed-tool.ts`, focused tests): invoke the coordinator after auto authorization or after Approval result plus final `isCurrentAuthority` validation. Approval request/decision callbacks must persist waiting and terminal wait outcomes without treating approval as target execution.
5. Host identity/dispatch (`packages/core/src/capabilities/route-capability.ts`, `capability-broker.ts`, `capability-broker-state.ts`, `capability-response.ts`, shared Host control schema, Rust serde/control path if fields cross the wire): thread Core `runId`, model `attemptId`, and `effectId` separately from Host-local `operationId`/attempt. Preserve broker control digest, generation checks, terminal cache, duplicate/late semantics, and unknown unsafe outcomes. Resolve the auto-vs-ask ordering gap with a Host preflight/explicit execution phase or record the exception as an explicit contract decision before implementation.
6. MCP seam (`packages/core/src/mcp/mcp-turn-tools.ts`, `mcp-manager.ts`, `mcp-generations.ts`, extension source/registry tests): reorder lease acquisition to occur after Governance/Approval final revalidation and immediately before target intent; settle forced-close/transport ambiguity as unknown; ensure direct MCP and `extension_call` share one instrumentation point.
7. Production wiring (`packages/core/src/agents/chat-agent.ts`, `chat-send.ts`, `extensions/extension-composition.ts`, `main.ts`): pass the mutable enclosing TurnContext identity into the shared coordinator and route/extension closures. Preserve overflow replacement-Attempt rebinding (`chat-send.ts:126-139`) and admission-captured Extension context.

## Test matrix for 3B

| Boundary | Required cases | Expected Core truth |
| --- | --- | --- |
| Governance auto | auto tool, raw closure throws, abort before dispatch | intent commits only immediately before raw call; failure/cancel settles once; no raw call after failed intent |
| Governance ask | approval request, allow-once/session/always, deny, expiry, cancel, operator disconnect, policy/approval generation invalidation, stale answer | waiting reference has canonical approval id/generations; denial/expiry/cancel settles wait without target intent; allow revalidates before target intent |
| Parallel AI SDK tools | two concurrent tool calls, mixed auto/ask, one stale/late callback | distinct effect IDs, each CAS-settled once; one does not advance or settle the other |
| Host route/broker | exact target, ambiguous target, auto, dynamic ask challenge/resume, unattended ask, wrong Host, stale connection/catalog/policy, duplicate/late response | same Core tuple reaches Host boundary; Host-local operation identity preserved; stale/late cannot mutate current Effect |
| Host lifecycle | disconnect before dispatch, disconnect during cooperative read, disconnect during unsafe effect, deadline, replacement generation | cooperative read cancelled; unsafe result `outcome_unknown`; no automatic redirect/replay |
| MCP direct | auto/ask, lease refusal after retirement, drain, forced close, transport failure, replacement generation | one Tool Effect; lease acquired only at target boundary; forced close/ambiguous result unknown; no generation switch |
| MCP extension bridge | direct MCP key and `extension_call` for same captured entry, stale snapshot, call-budget exhaustion | exactly one underlying dispatch/effect per model call; no double instrumentation; bounded extension failure |
| Settlement races | duplicate terminal result, wrong run/Attempt/effect, stale generation, post-terminal callback, overflow replacement Attempt | duplicate no-op; stale classified and ignored; replacement Attempt cannot settle predecessor |
| Evidence/privacy | raw arguments/results/prompts/credentials in Host/MCP output or exceptions | canonical effect/event rows contain only bounded refs, digests, generations, outcome, counts, and safe summary |

## Related specs and artifacts

- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/prd.md` — Slice 3 requirements, one logical Tool Effect, Approval/Host/MCP boundaries, and Slice 4 split.
- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/design.md` — effect state machine, intent/settlement ordering, and adapter responsibilities.
- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/implement.md` — sequential 3A/3B/3C execution split and verification gates.
- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/research/implementation-seams.md` — prior seam map.
- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/research/implementation-evidence.md` — 3A-only approved status; 3B remains not started.
- `.trellis/spec/backend/host-operation-lifecycle.md` — Core-first/Host-later, generation-bound control, unknown outcome, and no replay.
- `.trellis/spec/backend/mcp-lifecycle.md` — generation/lease/draining/forced-close authority.
- `.trellis/spec/backend/permission-authorization.md` — canonical Governance/Approval and stricter-only Host enforcement.
- `.trellis/spec/backend/tool-design.md` — tool execution/error/idempotency conventions.
- `.trellis/spec/backend/agent-runtime.md` — full tool-call/result persistence and one AI SDK loop.
- `.trellis/spec/backend/database-guidelines.md`, `error-handling.md`, `logging-guidelines.md` — persistence, bounded errors, and observer/logging constraints.

## Caveats / Not Found

## Adopted implementation decision

The Host ordering caveat is resolved by a required two-phase Host boundary; an ordering exception is rejected.
`capability.request` is preflight-only and cannot invoke the handler. The Host returns bounded trusted classification
evidence for the sealed current generation. Core handles canonical Approval where required, performs final
policy/generation revalidation, commits the one logical Tool Effect target intent, and only then sends an explicit
execute/resume frame. The Host revalidates the same control/input/generation immediately before execution. Core
Run/model-Attempt/Effect correlation remains separate from Host-local operation and execution-attempt identity.

For MCP, generation lease acquisition moves after final Governance/Approval revalidation and directly before target
intent. The shared captured MCP closure is the single instrumentation point for both direct tool keys and
`extension_call`; wrapping both layers is forbidden.

The exact additive wire names may follow the smallest existing Host protocol pattern, but the phase distinction,
authority ownership, ordering, cross-language parity, and tests above are mandatory.

## Caveats / Not Found (historical research notes)

- The current Host wire path has no Core-visible preflight result for dynamic input classification. `capability.request` can auto-execute on the Host or emit an Approval challenge; proving the frozen pre-Approval target-intent order requires a protocol/Host execution-phase decision, not only TypeScript wrapper code.
- The current shared Host control has `runId`, Host-local `operationId`, and Host-local `attemptId`, but no explicit model Attempt/effect correlation fields. Reusing Host-local IDs would violate the stated authority separation; adding typed correlation fields may require Rust serde, golden fixtures, and process tests.
- `EffectLifecycleService` currently does not provide durable Approval wait, approval settlement, or waiting-to-intent CAS operations. Treat any implementation that only calls existing `prepare` before `wrapGovernedTool` as incomplete.
- Direct MCP and Extension Registry paths share the same captured governed/leased closure; adding wrappers at both layers would create duplicate Effects. This conclusion is based on current code and should be retained as an explicit regression test.
- No code, spec, task pointer, Git state, or migration registry was modified by this research. The active pointer remains `.trellis/tasks/08-12-approval-productization`; this report intentionally follows the explicitly assigned Slice 3 task path.

## Implementation evidence added on 2026-08-25

- Core Broker reserves correlation identity in the sealed Host control but creates no durable target Effect during
  `capability.request`. Auto preflight commits intent immediately before `capability.execute`; ask preflight persists
  Approval waiting, final-revalidates, CAS-transitions the same Effect to intent, then sends `capability.resume`.
- Denied Host Approval settles waiting without target intent. Host terminal settlement is bound to the same Core
  Run/model-Attempt/Effect tuple; stale settlement fails closed rather than returning an uncommitted Host result.
- Rust preflight no longer receives the handler registry and has a deterministic test proving classification produces
  no executor/audit side effect. `capability.execute` now has shared/Rust valid and strict-invalid golden fixtures.
- Captured MCP/Extension closures retain a mutable per-Run interactive identity reference. Governance reads its
  Run/Attempt/Effect service lazily; overflow retry updates the Attempt on that same reference without generation
  recapture or redirect.
- Still missing before 3B completion: real Core/Host socket smoke, direct MCP versus `extension_call` durable
  exactly-once proof, and parallel AI SDK tool Effect identity/result-ordering coverage.
