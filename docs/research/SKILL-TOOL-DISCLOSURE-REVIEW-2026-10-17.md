# Independent review: Skill tool progressive disclosure

Date: 2026-10-17. Review scope: the current T4 implementation of Skill-owned tool bundles and MCP schema disclosure. This reviewer read production source, the installed AI SDK implementation, reference findings, and tests; did not run tests or modify production files. Other agents were editing in parallel. No task was created or rebound.

## Decision

**One confirmed inventory-evidence wording defect was found after the initial review and corrected; no remaining blocking defect was established in this follow-up.** The initial review incorrectly accepted the term "verified analyses" for a projection of registered catalog references. The owning agent identified the issue, and this reviewer independently confirmed both the registration path and the corrected wording. See the finding below.

The disclosure implementation uses the existing tool registry, governance adapters, MCP execution closures, and AI SDK step preparation. It does not create executable Skill-manifest semantics or turn `allowed-tools` into authorization.

This is a source-review conclusion, not a substitute for the owning agent's test/type-check results or a live provider acceptance claim.

## Confirmed finding and narrow correction

**[P2, corrected] The inventory called registered references "verified analyses" without native-result evidence.** An authenticated operator can register a result reference through `packages/core/src/server/methods/co-watching-methods.ts:69-71`. `analysis-catalog.ts:52-59` validates the input shape, checks its revision, and persists it; it does not read the native result or verify upstream success. `runtime.ts:70-74` maps `catalog.list()` directly into the inventory. Thus an operator-registered entry that has never passed a native read could be returned as `core_verified_analyses`, causing the model to overstate completion or availability. The existing spec explicitly states that a catalog reference does not prove analysis success (`.trellis/spec/backend/co-watching.md:31-33`).

The corrected new action returns `scope: core_registered_analyses` and describes **registered result references**, with no fresh upstream completion, availability, or content verification. The empty-list interpretation is "this Core has no registered references," not "no historical upstream analysis exists." The tool description, Skill/reference guidance, new-action spec wording, and test expectation were independently re-read after the owning agent's update. No additional network call, runtime, or registration behavior is necessary for this correction. At the last follow-up read, two abbreviated guidance phrases still needed alignment: `integrations/taki-co-watching/SKILL.md:15` said "already available video analyses" and `references/tools.md:7` was headed "Query completed analyses". These were reported to the owning agent; the corrected scope and detailed boundary were already present.

Actual reuse retains the existing stronger boundary: `runtime-model.ts:30-41` reads the complete native result through the accepted Run's captured tool and calls `verifyCoWatchingNative`; `native-result.ts:25-44` checks the result envelope, original service/request/job identity, media identity, hash, and moment constraints before publishing source content to preparation. Listing does not perform or imply that verification. This review's original "verified analysis projection" statement and unqualified no-findings decision were incorrect and are superseded by this section.

## Reviewed behavior and evidence

| Concern | Source-level conclusion | Evidence |
| --- | --- | --- |
| Initial schema footprint | Registered deferred MCP tools and Skill bundle tools are excluded from the first step; their real definitions remain in the ordinary tool map. | `packages/core/src/agents/tool-disclosure.ts:34-57`; `agents/chat-agent.ts:307-318` |
| Skill activation | A complete successful load must match the captured Skill's content revision. Resource reads do not activate a bundle. | `agents/tool-disclosure.ts:59-76` |
| Direct Skill generation binding | `load_skill` uses the captured `extension_call` closure and captured Skill extension ID instead of a newer same-name compatibility loader. The extension registry checks its captured generation before invoking the normal governed loader. | `tool-disclosure.ts:14-31`; `extensions/extension-registry.ts:79-97`; `extensions/extension-sources.ts:35-52` |
| MCP disclosure identity | Describe exposes an exact native tool name only for an available, callable, current MCP binding. The immutable disclosure map admits only names actually present in the captured direct tool set. | `extensions/extension-registry.ts:78-81,157-161`; `extensions/tool-disclosure-snapshot.ts:22-37`; `agents/tool-disclosure.ts:78-85` |
| Existing authority | Skill bundle definitions pass through `coreToolGovernance.wrap` before model filtering. `manage_co_watching` still has its canonical Core governance binding. MCP tools retain the same governed generation leases. | `chat-agent.ts:372-395`; `governance/core-tool-governance-adapter.ts:36,49-69`; `mcp/mcp-turn-tools.ts:26-47,68-101` |
| Same-step races | The selected tool set is computed before a model step. The installed SDK's streaming path supplies that step's active tool map to parsing/execution; a hidden tool emitted alongside its loader cannot run early. | `chat-agent.ts:318`; `packages/core/node_modules/ai/dist/index.js:9236-9271,8203-8222` |
| History and Run isolation | Disclosure derives only from the current SDK generation's completed `steps`. It does not scan Timeline history or keep a global active set. Replayed historic Skill loads cannot activate tools. | `tool-disclosure.ts:45-61`; `chat-agent.ts:307-318` |
| Overflow retry | Every `runAttempt` creates a new disclosure object. The existing retry guard permits retry only before a completed step, so a completed loader/effect is not silently rerun after overflow. | `chat-agent.ts:232-249,307-318,325-330` |
| Cancellation | The disclosure layer has no asynchronous mutation or retained process-global state. The existing turn abort signal reaches `agent.stream`; Core and MCP execution retain their normal cancellation/governance owners. No new cancellation bypass was established. | `agents/chat-agent.ts:351-360`; `co-watching/manage-co-watching-tool.ts:40-45`; `mcp/mcp-turn-tools.ts:37-47,51-64` |
| Admission context | The immutable disclosure snapshot travels with the captured Run context, alongside the existing tools. | `extensions/extension-run-context.ts:57-63`; `harness/run-snapshot-capture.ts:71-83` |
| Bounded catalog overflow | All direct MCP names remain deferred, including those outside the admitted descriptor budget. Only admitted descriptors can disclose. Raw closures remain present for Core-owned work. | `extensions/tool-disclosure-snapshot.ts:32-37`; `extensions/extension-run-context.test.ts:90-132` |
| Co-Watching inventory | `list_analyses` returns Core's registered analysis references under `core_registered_analyses`; it does not verify completion/availability/content, accept watching, or submit/reconcile native analysis. Actual reuse still reads and validates the native result through the accepted-work owner. | `co-watching/manage-co-watching-tool.ts:29,40-46`; `co-watching/runtime.ts:70-74`; `co-watching/runtime-model.ts:30-41`; `integrations/taki-co-watching/references/tools.md` |
| Package boundary | Tool bundle registration lives in trusted composition code. The package contains ordinary Skill instructions and references; it does not dynamically register arbitrary handlers. | `main.ts:485-486`; `integrations/taki-co-watching/SKILL.md`; `integrations/taki-co-watching/references/tools.md` |

Paths abbreviated after their first table occurrence remain under `packages/core/src/` unless an explicit different prefix appears. Line references describe the source read during this review and may shift as parallel edits finish.

## Test coverage inspected

`packages/core/src/agents/tool-disclosure.test.ts` exercises the real ToolLoopAgent boundary for first-step omission, successful next-step Skill activation, unrelated bundle/MCP omission, next-turn reset despite persisted history, failed/mismatched/incomplete loads, resource-only reads, exact MCP activation and closure invocation, same-step rejection, extension-bridge Skill loading, absent captured Skills, and stale same-name loader prevention. Later additions observed during this review cover governance denial, generic non-primary bundles, and outgoing OpenAI-compatible request bodies through a local fetch fixture.

Extension registry/snapshot tests cover unavailable or unbound names, stale generations, invalid tool names, source mutation, ambiguous Skill names, foreign/resource-only Skills, and descriptor overflow while retaining raw bindings. The new Co-Watching inventory test checks that listing creates no accepted session and makes no native submission/result/preparation calls. Its corrected scope expectation is `core_registered_analyses`; the absence of native calls supports reference-only listing, not native-result verification.

These test bodies substantiate the intended scenarios; this reviewer did not independently execute them. The existing Co-Watching control tests that install `manage_co_watching` directly through `primaryTools` remain useful domain tests, but do not by themselves prove production lazy registration; the separate disclosure and wire tests cover that layer.

## Non-blocking coverage opportunities and limits

- An explicit interleaved two-Run test would document that loading a Skill in one Run cannot affect another. Source currently uses per-generation local derivation rather than shared mutable state.
- An abort-after-loader/before-next-step case would document the cancellation boundary at the new disclosure seam. The inspected implementation delegates cancellation to the existing SDK and governed execution path.
- The existing `maxEntries: 128` descriptor budget still limits model discovery and therefore disclosure. This is a documented product constraint, not a silently bypassed or paginated catalog. No assertion of automatic MCP pagination or unlimited search follows from this change.
- Native Anthropic/OpenAI deferred-loading protocols are not implemented or required here. The verified mechanism is ordinary provider-neutral filtered schemas on each SDK step.
