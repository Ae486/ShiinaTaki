# Native multimodal main flow and model capabilities

## Goal

Route every image source directly into the primary model, remove the separate vision configuration and image-to-text translator pipelines, and reuse model-capability metadata without building a new detection framework.

## Owner decision and scope

The owner clarified that **all** image sources are included: user images, agent/tool screenshots, ambient perception and proactive/co-watching evidence. The separate translator was introduced for a text-only main model; it is no longer the desired architecture. Merely changing the translator's model to the main model while retaining the translation step does not meet the requirement.

Created on 2026-11-02 under the owner's instruction to isolate items 2 and 3 into one task if they are not small. The work crosses configuration, native request construction, tools, perception/initiative inputs and image history. The owner subsequently approved execution; status is in progress. This remains one bounded linked task, not a new general multimodal platform.

Parent: [Context attribution and token efficiency](../11-02-context-attribution-token-efficiency/prd.md). The parent retains attribution and cost work; this task owns image-flow simplification and the directly related capability metadata.

The owner subsequently requested coordinated planning for parallel progress. Image work advances alongside parent attribution investigation; the shared request boundary has one implementation owner, and capability metadata is not a dependency of native image transport. See the [coordinated sequence](../11-02-context-attribution-token-efficiency/implement.md#coordinated-work-sequence-2026-11-02).

## Requirements

1. Use the configured primary model for native image input from every existing image source. Combine text and images in the normal request as the supported SDK/provider protocol permits.
2. Remove the separately configured vision model/credentials/settings and translator-specific prompts, model calls and redundant routing. Do not retain a hidden vision fallback or another image-description call using the primary model.
3. Preserve screenshot capture, attachment storage/references, source identity and actual permission/retention behavior as separate responsibilities. Migrate their consumers to image input; do not delete these capabilities because the translator is removed.
4. Preserve useful tool status, call/result identity, errors and retry semantics. Reading an image must not rerun the capture or another side effect merely to recover old evidence.
5. Support normal follow-up use of retained image evidence through the existing conversation/tool machinery. Make unavailable/expired images truthful. Do not silently discard original images in request replay or invent permanent details after removal of the description writer.
6. Keep primary/proactive decision and presentation semantics. Images should become evidence in the main-model decision, not a reason to introduce an extra model call or bypass wake/admission rules.
7. At model configuration, reuse available framework/provider/catalog metadata to identify declared tool and image-input capabilities. Search support must distinguish provider-native search from application tools. Incomplete metadata remains unknown; model names and an OpenAI-compatible URL are not proof of effective endpoint support.
8. Capability discovery must stay small and must not block native image integration on a new framework. Do not add automatic paid capability probes or import another agent runtime just for its catalog.
9. Use the normal request usage accounting. Images belong to their enclosing message/tool source; no dedicated image token counter, metric category or billing subsystem.
10. Preserve historical image descriptions/usage as historical records. Removing a producer is not permission to rewrite existing memory or billing data.

## Acceptance Criteria

- [x] User-supplied images reach the main model as real image/file parts and produce a correct response with a supported endpoint.
- [x] Agent screenshots and proactive/perception image evidence reach the main model natively, including the next step of a tool loop where applicable.
- [x] No separate vision slot or pre/post image-to-text model call is required or executed; translator-only prompts and configuration are removed/migrated coherently.
- [x] Request inspection proves image bytes are not accidentally serialized as ordinary text/JSON, and call/result associations remain valid.
- [x] Image follow-up/replay works for retained evidence; missing/expired data produces honest behavior without recapturing side effects or pretending to know the original.
- [x] Existing capture permissions, wake policy, silent/express/speak behavior and source constraints remain correct through the migration.
- [x] Configuration displays known declared capabilities from a reusable source and preserves unknown/custom-endpoint cases; native web-search availability is not confused with tool calling.
- [x] Total request usage includes images through normal accounting, with no separate image meter or double counting.
- [x] Runtime, UI/configuration and real supported-model evidence cover the changed user paths. Manual acceptance is not inferred from automated tests.

Automated criteria above are supported by research/execution-progress.md. Native Tauri owner acceptance and a live user-service restart were not performed; these checkmarks do not stand for manual acceptance.

## Boundaries and review

- No new vision model, translation service, general image archive, automatic paid probe framework or unrelated model-routing rewrite.
- No forced rewriting of historical descriptions or attachment retention policy. Any required behavioral tradeoff must be explained before implementation.
- The owner's statement that the main provider now supports multimodal establishes the requested direction; the actual configured route still needs normal supported-model verification, not speculative rejection based on an older model name.
- The complexity decision authorizes this planning task. Complete the concrete migration design and independent challenge before the project's implementation review/activation gate.
- Keep work in `H:/TakiAgent-worktrees/t4`; preserve unrelated work and pre-existing artifacts. Use the owner-approved astra / 5.6sol / 6.1sol model families for development subagents.

## Model catalog follow-up (2026-11-04)

The owner clarified and approved using a maintained external source for model names, capabilities, icons and related information, avoiding application-maintained per-model correspondence. The original image/capability delivery remains recorded above; the expanded metadata scope is now implemented.

- [x] Display names, provider identity, explicit canonical model relationships and declared capabilities come from the shared maintained catalog integration.
- [x] Provider/brand icons come from maintained assets, with a generic icon for unknown entries; unique icons per model snapshot are not assumed.
- [x] Unknown models/custom endpoints and unavailable catalog data remain usable without losing valid request statistics.
- [x] Request/response model names remain distinct facts; request accounting uses its existing Effect association, independently of catalog lookup.

Selection and verified upstream coverage: [model catalog follow-up](../11-02-context-attribution-token-efficiency/research/model-catalog-followup.md).
Implementation, real-data/browser evidence and quality gates: [delivery record](../11-02-context-attribution-token-efficiency/research/model-identity-catalog-delivery.md). Checkmarks are automated acceptance, not owner/native manual acceptance.

## References

- [Design draft](design.md) and [ordered plan](implement.md).
- [Actual image paths and scope](../11-02-context-attribution-token-efficiency/research/native-image-flow-scope.md).
- [Capability discovery research](../11-02-context-attribution-token-efficiency/research/model-capability-discovery.md).
- [Heartbeat data chain](../11-02-context-attribution-token-efficiency/research/heartbeat-message-flow.md).
