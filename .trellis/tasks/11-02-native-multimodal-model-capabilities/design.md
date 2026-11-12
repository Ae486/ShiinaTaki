# Native multimodal main flow

Status: implementation authorized by the owner on 2026-11-02; task is in progress. All images go to the primary model and no separate image-to-text translator remains. The independent design challenge has completed; the concrete execution decisions below govern the migration.

## Execution decisions (2026-11-02)

- One agent-owned native projection emits SDK FileParts, preserving original source and call/result association. Screenshot images use a sibling native user message after the complete tool result when the compatible endpoint cannot accept image tool parts. Projection is idempotent across steps; image bytes never become ordinary JSON/text results.
- Native replay accounting changes with replay selection, folds and complete-request preparation. Existing estimator image costs are reused; there is no separate image meter. The calibrator's estimator window must not be used as the denominator for real provider input occupancy.
- Perception/viewing supplies a narrow ephemeral observation with image parts, source/currentness and idempotent release. Agent code validates it at every provider dispatch, holds it through one Attempt, and releases it on success/failure/cancellation. Default ambient drop ends on consumption, expiry, replacement or withdrawal; GC cannot remove the current leased frame. Existing keep/days settings remain explicit retention choices.
- Removing the translator necessarily removes its programmatic pre-main `SENSITIVE_SCREEN` verdict barrier: the primary model now receives permitted pixels and makes any visual/privacy judgment in its normal decision. Keep deterministic process/consent/Host screening and cleanup; use normal concise source/privacy guidance. Do not claim prompt abstention is equivalent to the former sentinel filter, add an independent classifier, or build a new response-buffering framework. This consequence follows the owner's explicit all-image/no-translator direction.
- Raw evidence is available only while retained and selected; TTL/compaction does not gain a new permanent visual-memory guarantee. Historical descriptions and usage remain untouched. No replacement image-description call is introduced.
- Ownership: request/replay/native carrier/screenshot integration is one implementation slice; perception/initiative/viewing is a second, using that carrier; root owns configuration, main composition, settings and integration. Parent attribution remains read-only until the shared request surface stabilizes.

## Existing behavior and why this is a separate task

- A user image already becomes an AI SDK native FilePart for the foreground answer, but image turns select the separately configured vision model.
- A detached image-description writer makes another model call after the turn and writes a permanent textual memory. It is not the foreground answer pipeline, but it is an extra translator the owner wants removed.
- Screenshot/ambient/proactive consumers also use the vision slot to create textual screen evidence. These consumers are in scope for native migration, not reasons to preserve the translator.
- Current Timeline-to-model projection turns user rows into plain text and omits image references. Retained attachments exist, but native future-turn access is not automatically provided by changing model selection.
- Current initiative/volatile context includes screen-description strings. Its main decision must receive image evidence directly instead.
- Configuration, context calibration and UI contain separate vision settings. Removing only one runtime call would leave misleading configuration and remaining translator consumers.

Detailed evidence lives in the linked parent research files; do not duplicate it here or reopen unrelated heartbeat policy.

## Target data paths

```text
User text + retained image reference
  -> normal conversation preparation
  -> native text/image parts
  -> primary model

Agent screenshot tool
  -> capture outcome + image reference/payload
  -> next normal tool-loop request, with valid tool feedback and native image parts
  -> primary model

Admitted perception/proactive work + selected captured frame
  -> existing selected context, including native image evidence
  -> primary model's normal decision/reply
```

There is no independent caption/vision completion between image capture and the main decision, and no mandatory description call after an image response. Normal conversation summaries/memory processing may use the primary conversation's resulting content; do not disguise a replacement image translator as background memory work.

Reuse existing attachment references, file-part construction, agent preparation and source identity. Preserve capture/admission/presentation boundaries without building another runtime. For optional ambient capture, carry a selected eligible frame into the next admitted main request; do not introduce a model call for every sampling tick.

## Implemented SDK transport and history

SDK native FileParts become actual `image_url` parts through the installed compatible adapter. Screenshot/MCP image siblings follow the complete tool-result message; exact SDK-output sidecars retain source/call association through rendering. Explicit MCP image/resource blocks use this projection in direct and indirect routes. Non-image content, structured content and errors are preserved. Arbitrary JSON is not guessed to contain images.

Retained user/tool image refs use the existing attachment store; both primary and private history hydrate/price originals before window selection. Normal selected replay can use retained images across subsequent Runs. Missing/expired originals are explicit unavailable evidence and never trigger recapture. Temporary ambient/private images remain Attempt-local. Legacy explicitly typed SDK image/file content is normalized on read without rewriting historical rows. Images outside selected context do not gain indefinite replay or a permanent visual-memory guarantee.

Perception and viewing lease permitted frames into the admitted main decision. Consent/source currentness and TTL are rechecked immediately before every physical dispatch. Default drop releases after consumption/expiry/replacement/withdrawal; cleanup does not remove a currently leased frame. The removed standalone semantic sentinel and privacy tradeoff are recorded above and in the native-image spec.

## Model capability reuse

The installed AI SDK's compatible model supplies request/stream/tool plumbing; it does not provide universal endpoint capability inference. `config.modelCapabilities` now projects the maintained public models.dev catalog with exact endpoint/model identity, declared/unknown/unavailable states and independent adapter support. It sends no model credentials to the catalog and performs no model call. Demand cache: one hour after success, one minute after failure; five-second timeout and 16 MiB response bound.

Model-declared tool calling/image input is distinct from an endpoint's effective protocol support. Native web search also needs a provider API/adapter feature; application-provided search is an ordinary tool integration. Do not infer network access merely from a model ID or advertise native search through an adapter that does not implement it.

Native image migration remains usable without a successful catalog lookup. Settings displays the configured model identity and restart application semantics; late responses for retired configurations/clients are ignored. No automatic paid probe, mass-model test, capability retry queue or arbitrary model rejection is added. Both catalog success and actual lookup failure were exercised in the isolated UI verification.

### Approved metadata extension (2026-11-04)

The owner approved repairing the parent Monitor association first, then extending the existing models.dev reader. Keep the current AI SDK, catalog URL, bounded demand cache and `config.modelCapabilities` method. Enrich declared catalog results with an optional metadata object so existing clients/fixtures remain compatible. It carries display/provider names, the upstream explicit canonical model ID, a provider logo URL, declared reasoning/input/output modalities and context/output limits; absent upstream fields stay null. Prices are outside this display slice. Catalog limits never replace effective runtime settings.

The first UI consumer is the existing Settings model information section. Display the original configured ID alongside its catalog name, provider icon and concise capability facts; put canonical identity and catalog limits in expandable details. Unknown/unavailable entries use their original ID and a generic local icon. A failed remote image falls back locally. Reuse the current configuration/client/visibility fencing. Provider logos use only the fixed models.dev asset origin; extend packaged `img-src` narrowly for that origin and exercise the packaged CSP in browser verification. No additional library or arbitrary external icon source is introduced.

Latest-request monitoring continues to show the recorded requested/response model identities. Do not decorate historical requests with current Settings metadata: the existing historical projection does not establish the serving endpoint needed for a trustworthy catalog lookup. A metadata lookup is never on the usage/composition read path.

## Migration and rollback shape

Remove runtime consumers before retiring their configuration/prompts, and make native paths usable as a coherent change. Existing capture, authorization, storage and normal usage producers remain their authorities. Preserve existing records and credentials unrelated to the deleted vision role; state the treatment of obsolete settings explicitly.

Review cross-layer contracts and meaningful failure cases before implementation. Rollback restores the prior code/config interpretation from a known state without deleting historical data; do not leave both translator and native paths making requests in normal production as a permanent fallback.

The parent attribution task can continue measurement research independently. Integrate its final request classification against this native flow when the migration lands, using ordinary total usage and no image bucket.
