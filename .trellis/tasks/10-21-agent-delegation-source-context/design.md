# Coordination design

Status: coordination plan ready; the owner authorized development after global-rule optimization and readiness checks. Those prerequisites have passed for the first SDK child. Later children retain their stated contract/dependency gates. Authorization comes from that owner instruction, not merely the presence of these artifacts.

## Task placement

Create a new cross-cutting parent instead of enlarging `08-22-t4-agent-architecture-observability` or `09-11-companion-initiative-implementation`. The former delivered runtime/observability foundations and excluded runtime replacement; the latter owns initiative policy and delivery. This request adds independent upgrade, reusable-child and source-context deliverables across those foundations. Existing tasks retain their status and acceptance; relevant contracts are referenced, not reopened or reparented. OpenBiliClaw/plugin setup is not the same scope.

## Deliverables and dependencies

| Child | Delivery ownership | Prerequisites |
| --- | --- | --- |
| [AI SDK upgrade and regression baseline](../10-21-ai-sdk-upgrade-baseline/prd.md) | Exact package/lock changes and necessary SDK compatibility fixes; before/after baseline | Global-rule validation and independent readiness review completed; owner authorized development |
| [Shared-runtime agent delegation](../10-21-agent-delegation-runtime/prd.md) | G1-G4 lifecycle, addressed child context/input, completion policy and child conversation controls | Upgrade evidence; joint source boundary reviewed |
| [Source-preserving context and prompts](../10-21-agent-source-context/prd.md) | CS01-CS11 across publication, replay, compaction and memory; evidence-based input rendering | Upgrade evidence; joint child-result boundary reviewed |
| [Agent context end-to-end acceptance](../10-21-agent-context-acceptance/prd.md) | Integrated Co-Watching, child controls and semantic/recovery acceptance | Prior three deliverables and their targeted checks |

The task tree is not a dependency scheduler. Runtime and source design can be researched together; overlapping production owners must be sequenced explicitly after the joint contract is reviewed. E2E scenarios are specified early and executed against the final integrated path. No automatic transition follows completion of research.

## Architecture boundary

- Retain one Core-owned Runtime, admission/Run/Attempt/Effect lifecycle, authorization authority and Character relationship Timeline. Both parent and child use the same model/tool execution layer.
- Keep reusable child working continuity distinct from a single execution. A child may receive a later execution; terminal Runs remain terminal. Native SDK session handles, if ever selected, are adapter state rather than independent truth.
- Keep selected context and addressed work messages distinct from ordinary user speech. Material source and generation origin are separate. Private child work remains private until a bounded result or actual publication is deliberately projected.
- Completion records are durable regardless of whether parent inference is requested. Completion, continuation admission and publication use separate identities and deduplication boundaries. Parent stop cannot mutate a child's completion intent.
- Cancellation addresses the correct execution scope; parent and child controllers are independent. User-directed child stop is distinct from parent-directed interruption. Existing permissions, revocation, budgets, process shutdown and unknown-effect rules still apply.
- Relationship publication remains serialized and subject to foreground/source/revision/playback checks. Independence of background execution is not permission to bypass publication eligibility.

## Package-first choice

The reviewed recommendation uses [SDK upgrade evidence](research/sdk-upgrade.md) and [runtime evidence](research/delegation-runtime.md): upgrade the existing packages, retain the shared ToolLoopAgent, and extend existing Core owners only for the demonstrated delegation gaps. The research has compared current WorkflowAgent and HarnessAgent; no runtime replacement is needed for this delivery.

| Surface | Verified value | Decision for this delivery |
| --- | --- | --- |
| Existing AI SDK packages | Installed exact targets `ai@7.0.148`, `@ai-sdk/mcp@2.0.81`, `@ai-sdk/openai-compatible@3.0.75`; aligned provider `4.0.31` and provider-utils `5.0.65`; local Node `24.18.0` satisfies metadata | Exact pins and the scoped working-lock delta are verified. The owner-approved cancellation repair passed real HTTP/WS regressions, required checks and [independent final review](../10-21-ai-sdk-upgrade-baseline/research/final/independent-review.md). The SDK implementation dependency gate is satisfied; its lifecycle remains unarchived. |
| ToolLoopAgent | Full caller-controlled messages, per-step preparation/capture, governed host tool execution and separate per-call abort | Keep as the shared parent/child engine. Core must supply retained child identity/history, addressed messages, independent lifetime and completion admission. |
| WorkflowAgent | Durable model/tool steps, streaming and approvals through a Workflow runtime | Do not adopt here. It adds execution/checkpoint ownership and requires rebinding serializable tool context; retry is not external-effect exactly-once proof. |
| HarnessAgent | Native sessions and real experimental steering on several published adapters | Do not adopt here. Latest-user-only message reduction conflicts with direct Replay View replacement. Built-in tool callbacks cannot substitute for execution-before-effect governance. A deterministic fake-adapter probe found active `stop()` suspends rather than invokes native stop with a caller-owned sandbox; actual adapter/process behavior is untested. |

The newer Codex adapter has app-server steering and filtering code; old exec-only descriptions are not current source truth. Conversely, these additions do not prove G1-G4 parity, complete history access or stable retained history across adapter settings changes. Preserve these distinctions instead of treating a capability table as permanent.

For every proposed host addition, identify the missing package capability, existing Taki owner to extend and an observable acceptance case. Do not infer retained-child semantics from one-shot tool delegation, full adapter capability from a generic interface, or pre-execution governance from post-execution events.

## Source and prompt design gate

`research/source-context-prompts.md` owns the evidence comparison. Reuse native role/tool-call/result framing, known material metadata and existing context hooks. At the joint delegation/source gate, settle the smallest durable source description required when private work becomes a result or public speech; specify projection into replay, compaction and permitted memory inputs. Reuse existing durable links when sufficient, and prove retention instead of depending on opaque hashes or transient task files.

Keep stored source meaning independent of model-facing syntax. Inspect captured model requests before choosing a rendering; investigate current official examples again when the actual consuming API differs. XML/JSON/Markdown remains an engineering choice to validate, not a preapproved schema. The default candidate is native framing plus a minimal known material description; compare one alternative only for an evidenced ambiguous boundary. Unknown legacy source stays unknown. Do not infer a user's experience merely because externally informed text was spoken in the Character's voice.

Memory is a parallel consumer of exact eligible original primary sources, not a downstream ingestion of Replay View or compaction summaries. Source preservation across all relevant stages does not authorize raw child material, non-primary publication or summaries to become memory sources. Inspect gate/extraction/maintenance/use independently, and repair misleading primary generation upstream when attribution has already been lost.

## Verification levels

1. Official documentation establishes intended API/practice, with date/version and URL.
2. Pinned source confirms relevant implementation and adapter support.
3. Local deterministic checks establish serialization, durable projection, lifecycle, delivery and deduplication behavior in Taki.
4. Controlled live-model trials assess source interpretation on actual Taki inputs; owner trials assess the requested user experience. Neither is inferred from the earlier levels.

Use the same representative scenario and provider/model settings before and after changes where practicable. Keep generated fixture content separate from user data. Model tests may show improvement, not a universal guarantee. Provider-owned Hindsight prompt behavior must be examined or explicitly left unverified, while preserving current memory eligibility.

## Compatibility and rollback

The worktree has extensive existing changes and a premodified lockfile. Capture touched-file preimages and hashes at each authorized implementation boundary. Apply only task-owned changes; rollback restores that boundary state rather than repository HEAD. If concurrent changes invalidate an expected postimage, reconcile instead of overwriting. Database changes must be additive and respect existing migration lineage; source metadata rollback must not erase accepted speech or memory truth. A framework replacement, destructive migration or changed authority requires a separately reviewable decision.

## Research status

All three original `trellis-research` reports are persisted and integrated. The SDK child has since recorded baseline/target suites, an isolated real Node boot, and matched local HTTP/WS cancellation evidence. Its independent finding was resolved under the owner's explicit cancellation-policy decision; final review and required checks pass. No paid/live-model or owner UI trial ran.

The [joint Runtime/source contract](research/joint-runtime-source-contract.md) specifies storage, APIs, queues, source consumers and implementation ownership. Its [independent review](research/joint-contract-review.md) corrections are reconciled: exact work-scoped supersession, inspectable parent synthesis and direct-request reporting, tool-acquired material selection, Co-Watching integration, and the canonical all-terminal-path participant. The owner's later instructions are included as ordinary task/role instructions plus effective executable tool selection, with fixed child Memory mutation exclusions and unchanged main/provider authority. The coordinator accepts these technical contracts for the bounded implementation slices; they are not claims of implemented behavior or acceptance. Begin Runtime S1, sequence its shared owners before downstream slices, and retain the separate live/owner gates.
