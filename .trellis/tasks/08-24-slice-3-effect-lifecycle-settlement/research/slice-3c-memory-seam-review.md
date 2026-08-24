# Research: Slice 3C Memory Effect Seam Review

- Query: Confirm the production Memory composition, the Slice 3B Effect/Governance API, and the minimum Core-owned Effect boundary for explicit Memory tools, including authority epochs, request receipts, `recall(both)`, detached Memory hooks, and non-primary turns.
- Scope: internal / mixed (TakiAgent source, Trellis artifacts/specs, and the local PI/DSH reference research already recorded for Slice 3)
- Date: 2026-08-25

## Findings

### 1. Production Memory composition is authority-selected, not dual-registered

- `packages/core/src/main.ts:136-140` composes one `memoryRuntime` and exposes its delegated `memory` engine; `main.ts:307-315` injects that engine into `createChatAgent` and selects the canonical or legacy system prompt from the same runtime marker.
- `packages/core/src/memory/runtime-selector.ts:17-35` reads the persisted authority selection. For `canonical-local`, it does not construct the legacy subsystem (`legacy = null`) and constructs `createCanonical(epochId)` instead. For legacy mode it constructs only the legacy subsystem. The delegated engine switches only through the explicit migration `bindCanonical` path.
- `packages/core/src/memory/runtime-composition.ts:25-49` preserves this single selection and returns `memory.createTools` through the delegated engine. It exposes legacy `autoMemory`, tidy, and write surfaces only when the legacy subsystem exists; canonical activation therefore has no normal Markdown writer or background legacy Memory tool path.
- `packages/core/src/memory/canonical-local-runtime.ts:24-38,56-60` creates one Local provider, one `MemoryCoordinator`, and canonical tools for the global/character Banks. Missing Banks returns an empty tool set. The file header still calls the factory “dormant,” but the actual production composition is activated by the persisted marker and is already wired from `main.ts`.
- `packages/core/src/agents/chat-agent.ts:298-312` merges admission-captured `memoryTools` or `deps.memory.createTools(characterId)` with Core/avatar tools, then applies `coreToolGovernance.wrap` once. This is the active boundary for explicit Memory tools; there is no separate production registration of canonical tools beside legacy tools when the selector is operating correctly.
- `.trellis/spec/backend/permission-authorization.md:186-192` confirms the stable Governance identities: `recall`/`reflect` share the search cell, retain/update/restore share the write cell, and invalidate/archive share the archive cell. A model-facing rename must not create a new grant or bypass Governance.

### 2. Slice 3B already owns the generic Effect lifecycle, but Memory is currently classified as a generic tool

- `packages/core/src/harness/effect-lifecycle-service.ts:4-16` exposes the current Core API: `prepare`, `prepareWaiting`, `commitIntent`, `settleWaiting`, `settle`, `get`, and `unfinished`.
- `packages/core/src/db/effect-repo.ts:7-27,52-119,120-152` persists one typed effect row, reserves result/usage references, performs active-Attempt/version CAS, appends bounded effect events, and classifies duplicate/stale callbacks. Waiting approval can be settled or promoted to intent using the same CAS path.
- `packages/shared/src/effect-lifecycle-schema.ts:8-26,34-52` already has a closed `memory` effect kind and bounded Memory source/executor references: `sourceRef.memory` carries `requestId` and `authorityEpoch`; `executorRef.memory` carries the authority epoch. `replayPosture` is closed to `safe|never`; summaries reject prompts, credentials, tokens, cwd, and env markers.
- `packages/core/src/governance/governed-tool.ts:68-175` performs Governance, Approval wait, final revalidation, target intent, raw execution, and terminal settlement. `effectIntent()` defaults to `kind: "tool"` and `replayPosture: "never"` unless the binding supplies effect metadata. Therefore canonical Memory bindings in `core-tool-governance-adapter.ts:13-23` are governed, but currently create generic `tool` Effects unless Slice 3C supplies a Memory-specific effect declaration/adapter.
- `packages/core/src/agents/model-effect-middleware.ts:12-53` proves the intended model pattern: the real AI SDK `doGenerate`/`doStream` request receives one Effect intent before dispatch and settles with authoritative usage or `outcome_unknown` on ambiguous interruption. Memory should reuse this lifecycle service rather than introduce a second Memory lifecycle.
- `.trellis/spec/backend/database-guidelines.md:156-219` is the current contract: EffectRepo owns intent/settlement transactions, exact terminal duplicates are no-ops, stale/wrong-Attempt callbacks cannot mutate truth, Memory actions are included in the same intent-before-dispatch scope, and raw prompts/arguments/provider errors/secrets never enter canonical rows or events.

### 3. MemoryCoordinator and Canonical Local already provide the domain authority and receipt checks

- `packages/core/src/memory/memory-coordinator.ts:24-39,52-100,142-158` accepts caller-supplied `requestId`, `expectedAuthorityEpochId`, actor, and AbortSignal. Before provider dispatch it validates the active epoch/provider/capability; after dispatch it validates request identity, provider identity, epoch, stable capabilities, and recall vector-state compatibility. Authority or capability drift fails closed.
- `packages/core/src/memory/canonical-local-runtime.ts:24-29` creates the authority repo, Local provider, and coordinator once per selected epoch. `packages/core/src/memory/local-memory-provider.ts:44-79,136-159` declares `idempotentWrites: true`; retain and mutation pass the coordinator context request id into the canonical repositories.
- `packages/core/src/db/canonical-memory-repo.ts:64-85,143-196` is the canonical Local aggregate writer. Mutation/retain receipts use request id plus request hash; same identity and hash can replay, while a different hash returns `MEMORY_REQUEST_ID_CONFLICT`. Mutation also uses expected revision CAS, yielding `MEMORY_REVISION_MISMATCH` for stale edits.
- The provider receipt and the Core Effect row are separate transactions. A Memory mutation can commit its receipt before Core settles the Effect; a crash in that window must remain an unfinished Effect with enough request identity for Slice 4 reconciliation. Slice 3 must not claim cross-repository atomicity.

### 4. `recall(both)` is one model-facing operation but currently two coordinator requests

- `packages/core/src/memory/canonical-tools/canonical-memory-tools.ts:52-66` sends one coordinator `recall` for a single scope, but `scope="both"` runs global and character branches concurrently. Each branch currently omits `requestId` and expected epoch, so the coordinator generates two independent random request ids and reads the active epoch independently.
- The combiner accepts a complete result only when provider identity and authority epoch match (`:59-66`). One failed branch becomes a bounded partial result with a branch error code (`:69-72`); both failures return one failure envelope. The combined result is therefore a single model-facing tool result, even though provider work is two subordinate calls.
- Recommended Slice 3C shape: create one outer Core Memory Effect for the model-facing `recall` operation, with one stable logical request identity tied to that Effect. For `both`, derive two bounded deterministic branch identities from the outer identity (for example, outer id plus `global`/`character`) and pass the captured expected epoch to both coordinator calls. The outer Effect settles once after both branches are joined; branch failure remains inside the bounded Memory result, not a second Core Effect. A branch identity must never be reused across a different outer Effect or different request hash.
- `recall` can be marked `safe` only when the outer request captures the same authority epoch, provider lineage, stable capability contract, and branch identities. Any epoch/provider/capability drift is a failed/unknown Memory operation, not a safe replay opportunity.

### 5. Replay posture and write semantics

- Explicit `retain`, `update_memory`, `invalidate_memory`, and `restore_memory` are target writes and should default to `never`, even though Local advertises idempotent writes. `safe` is justified only when the exact request id/idempotency identity, request hash, expected revision, provider lineage, and authority epoch are reused and the provider contract still explicitly reports idempotent writes.
- A request-id replay with a different request hash must remain `MEMORY_REQUEST_ID_CONFLICT`; a mutation with an old expected revision must remain `MEMORY_REVISION_MISMATCH`. These are domain results, not permission to generate a new Core Effect or silently redirect to a new Memory epoch.
- A future Memory adapter should pass the stable request identity and expected epoch into `MemoryCoordinator` rather than letting canonical tools call it with random generated ids. The adapter must persist only the request id, epoch, provider/capability digest, request digest, bounded outcome/error code, and revision/receipt reference. It must not persist raw memory content, recall query, tool arguments, or exception text.

### 6. Detached hooks and non-primary behavior remain outside explicit Memory Effects

- `packages/core/src/agents/chat-agent.ts:288-296,324-327` fires AutoMemory and image-description writes detached only after a primary turn has completed without retraction. `main.ts:324-327` disables the image-memory hook after canonical activation, because canonical Local has retired the legacy writer path.
- These detached hooks are not the model-facing explicit Memory tool boundary and should not be re-triggered by Effect settlement observers. Slice 3 keeps them as detached projections; Slice 4 may later reconcile their own orphan semantics.
- `packages/core/src/agents/chat-agent-non-primary.test.ts:9-45` protects the non-primary contract: no Timeline write, costume consumption, conversational AutoMemory, or image attachment save. If a non-primary turn invokes an explicit Memory tool, it may receive a normal Core Memory Effect, but it must not advance conversational watermarks or synthesize relationship rows.

### 7. Required 3C adapter and test boundary

The smallest safe implementation seam is an adapter at the existing governed-tool boundary, not a second Memory runtime:

1. Extend the per-tool captured context with `runId`, `attemptId`, `effectId` (or an equivalent stable Effect identity), captured Memory authority epoch/provider lineage, and a bounded request/branch digest.
2. Classify canonical Memory bindings as `kind: "memory"` with `sourceRef: { type: "memory", requestId, authorityEpoch }` and `executorRef: { type: "memory", authorityEpoch }`; retain the existing Governance identity/cell mapping.
3. Commit one Effect intent immediately before the coordinator call, then call `retain`/`recall`/`mutate` with the same stable request id and expected epoch. Settle once from the validated `MemoryResult`; map cancellation and authority/capability drift to bounded outcomes without exposing raw errors.
4. For `recall(both)`, use one outer Effect and deterministic branch request identities; do not instrument the two coordinator branches as two model-facing Effects.
5. Keep explicit write posture `never` by default; permit `safe` only under the exact idempotent-receipt conditions above.

Required regression matrix:

| Area | Cases | Expected truth |
| --- | --- | --- |
| Memory success | recall one scope, retain, edit, invalidate, restore | one Memory Effect; intent precedes provider call; one terminal settlement |
| `recall(both)` | both success, one branch failure, both failure, branch epoch mismatch | one outer Effect; bounded partial/failure result; no duplicate branch Effect |
| Authority | expected epoch mismatch before dispatch; epoch/provider/capability drift after provider call | fail closed; no safe replay; bounded authority mismatch |
| Receipts | same request id/hash, same id/different hash, stale expected revision | provider receipt replay only for exact identity/hash; conflict/revision mismatch preserved |
| Lifecycle races | duplicate settlement, wrong Run/Attempt, stale effect version, post-terminal callback, replacement Attempt | duplicate no-op; stale classification; current truth unchanged |
| Cancellation/uncertainty | abort before dispatch, abort during provider work, ambiguous provider acknowledgement | no provider call before intent; cancellation or `outcome_unknown` according to evidence; never blind replay |
| Privacy | query/content/raw args/provider exception in Effect/event/ordinary logs | structurally absent; only digest, identity, epoch, bounded code/summary/counts remain |
| Hooks | primary detached AutoMemory/image path, retracted primary, non-primary explicit Memory | detached hooks fire only on committed primary path; no observer-triggered duplicate; non-primary no Timeline/watermark side effects |

## External References

- PI reference contract: `references/pi-main/packages/agent/docs/harness.md:129-205,452-464,1894-1916` for intent-before-effect, reserved result/usage identities, and safe/never replay.
- DSH reference: `references/deepseek-harness-master/docs/tool-execution-pipeline.md:4-60` for fixed execution/observation boundaries only; it is not a second Runtime authority.
- Existing Slice 3 reference synthesis: `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/research/effect-lifecycle-references.md`.

## Related Specs

- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/prd.md:40-82` — intent/settlement, Memory, privacy, non-primary, and acceptance criteria.
- `.trellis/tasks/08-24-slice-3-effect-lifecycle-settlement/design.md:18-35,61-67,123-140` — authority separation, effect state machine, Approval/Memory/usage boundaries.
- `.trellis/spec/backend/database-guidelines.md:156-230` — EffectRepo transaction/CAS/privacy/test contract.
- `.trellis/spec/backend/permission-authorization.md:186-192,307-318` — canonical Memory Governance identities and required adapter tests.
- `.trellis/spec/backend/agent-runtime.md:8-15,87-90` — full tool-call/result persistence and cancellation/retraction constraints.
- `.trellis/spec/backend/tool-design.md:187-208` — tool metadata is advisory; replay posture must come from trusted subsystem contracts.

## Caveats / Not Found

- YCE was attempted as required by the repository skill, but this worktree has no `scripts/yce.js`; the search was downgraded to `jbcontext` plus direct reads. `jbcontext` was available and returned relevant canonical Memory/ChatAgent locations.
- No production Memory adapter currently injects `effectId`, stable request ids, or expected authority epochs into canonical tool closures. The existing `MemoryCoordinatorCallOptions` supports these fields, but `canonical-memory-tools.ts:44-49,52-56,87-91` currently passes only `AbortSignal`.
- The exact additive API for branch request identity under `recall(both)` is not implemented; the outer-Effect/derived-branch recommendation above is a Slice 3C design decision, not current runtime behavior.
- The canonical-memory tool factory's header still describes it as dormant/Batch 1 isolated, which conflicts with current marker-selected production wiring. The runtime composition and tests are the stronger evidence; the stale header should be corrected only in the implementation task.
- This research intentionally does not define Slice 4 orphan recovery, scheduler/heartbeat, automatic replay executor, Child Run, monitor UI, or telemetry behavior.
