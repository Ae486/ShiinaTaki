# Maintained model metadata and icons (2026-11-04)

Subsequent status: the owner approved this extension and it has been implemented with the existing reader/cache,
optional metadata projection, Settings display and provider logos. See [delivery record](model-identity-catalog-delivery.md).
The following sections preserve the selection evidence and original proposal.

## Owner clarification

Extend the existing capability work to obtain model names, capabilities, icons and related metadata from a maintained external project. Avoid maintaining model-by-model correspondence inside TakiAgent. This is a planning/research extension of the existing child, not a new task or a completed implementation.

## Recommendation and verified evidence

Extend the existing **models.dev** integration. It already supplies the catalog used by `packages/core/src/config/model-capabilities.ts`; the current implementation only projects model identity, tool calling, image input and update time. It discards display names, canonical identity, limits and other available catalog fields, and has no icon consumer.

Verified public sources on November 4:

- [Project README](https://github.com/anomalyco/models.dev): documents `api.json`, model-only `models.json`, combined `catalog.json`, and provider SVG logos. The raw README was retrieved successfully.
- [Public catalog](https://models.dev/catalog.json) returned 200 with `providers` and `models`; [compatibility API](https://models.dev/api.json) also returned 200 and includes `canonical_model_id`. Switching endpoints is not required merely to consume that field.
- [Development commit feed](https://github.com/anomalyco/models.dev/commits/dev.atom) returned 200 with November 4 commits, latest observed `2026-11-04T10:23:28Z`, including ongoing catalog synchronization. This supports current maintenance activity, not a guarantee of future availability. GitHub's repository metadata REST endpoint returned 403; no maintenance claim is based on that failed request.
- [DeepSeek provider logo](https://models.dev/logos/deepseek.svg) returned 200 as SVG. The documented logo pattern is `https://models.dev/logos/{provider}.svg`; an unknown provider also returned the documented default SVG. These are provider/brand logos, not a unique icon for every model snapshot.

The current catalog explicitly maps both observed names:

| Provider | Endpoint model ID | Display name | Canonical model ID |
| --- | --- | --- | --- |
| deepseek | deepseek-v4-flash | DeepSeek V4 Flash | deepseek/deepseek-v4.1-flash-1017 |
| deepseek | deepseek-flash | DeepSeek V4.1 Flash 1017 | deepseek/deepseek-v4.1-flash-1017 |

Both entries declare tool calling and text/image input. This is dated public metadata, not retrospective proof of which internal model weights handled an earlier request. A family field or similar spelling alone is not an alias mapping.

[Lobe Icons](https://github.com/lobehub/lobe-icons) is a possible later source for richer model-family branding and color variants; its README documents React components and static SVG/PNG/WebP packages under MIT. Provider logos already supplied by models.dev meet the small initial scope. Do not add a second dependency/source just to duplicate those logos.

## Proposed scope

- Share the existing Core-owned catalog lookup between settings and model information displays; retain provider-scoped endpoint model identity and the original configured name.
- Project display name, provider name/ID, explicit canonical model reference, declared capabilities and logo reference. Context/output limits and pricing may be exposed as labeled catalog information when needed; do not silently replace runtime-configured limits or historical billing facts.
- Use the catalog's explicit relationships for model naming/grouping. Keep unknown/custom endpoints usable with their original ID and generic icon. Do not require individual model alias registrations inside this application.
- Preserve the distinction between model capabilities, the selected adapter's implemented features, and tools enabled in the application. Native search is not implied by ordinary tool-calling support.
- Keep the existing request SDK/runtime. This need is served by a metadata catalog and small integration, without another agent framework or model probe service.

## Relationship to the Monitor defect

The catalog can explain and display the two observed names, but it must not become an accounting prerequisite. [The diagnosed outage](attribution-model-identity-diagnosis.md) still requires request correlation by the existing Effect identity. Missing, outdated or unreachable metadata must not discard valid usage/composition. Request names and response names remain distinct historical facts; refreshing today's catalog must not rewrite them.

Recommended order: repair the concrete Monitor read defect and verify the stored cohort, then expand the existing capability module and its UI within the current child. Acceptance includes a catalog-known pair of endpoint aliases, an unlisted model, unavailable metadata, provider/generic logos and different request/response names with valid statistics.

Only public read-only HTTP and repository inspection were performed. No dependencies, production code, live settings/data, paid model calls, task lifecycle or Git history changed.
