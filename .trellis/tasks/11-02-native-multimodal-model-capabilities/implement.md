# Native multimodal migration: execution checklist

Status: in progress following the owner's 2026-11-02 execution approval. Independent design challenge completed; concrete decisions are in design.md. Parent attribution research proceeds in parallel, with shared request/replay files owned by the image implementation slice.

## Coordination with attribution

Follow the [parent's coordinated work sequence](../11-02-context-attribution-token-efficiency/implement.md#coordinated-work-sequence-2026-11-02). The owner requested parallel progress, not concurrent rewrites of the same request surface.

- Advance the concrete image design and native-wire proof while the parent investigates composition and old/new evidence. Do not wait for a completed Monitor or exact historical component breakdown.
- Once implementation is activated, this task owns the shared request, image/replay and composition changes. Parent research may inspect them and supply classification/measurement needs; use explicit handoff before another writer changes the same files.
- Settle source association and actual request correlation early, using existing structures and no image-specific meter. Do not create a generic provenance framework as a dependency.
- Preserve actual source category independently of SDK transport role: screenshot material remains tool evidence even if sent as a user FilePart.
- Adapt existing admission/window/pressure measurement in the same change as native replay. New attribution UI can wait; text-only history selection followed by unbudgeted image hydration cannot.
- Hand over the stable native outgoing shape before final attribution wiring. Metadata/UI polish is not a prerequisite for that handoff.
- Capability metadata remains in this task but is an independent, smaller step; it must not delay main-model image transport or introduce a translator fallback.

## 1. Complete a bounded design

- [x] Read the linked image, heartbeat and capability reports and verify the decisive current seams.
- [x] Inventory all vision-slot consumers and translator-only prompts/configuration, including user images, tool screenshots, ambient perception, viewing/co-watching and any bootstrap/calibration paths.
- [x] Select native SDK serialization for current/next-step/proactive image input; prove the adapter produces actual image parts rather than base64 JSON text.
- [x] Resolve retained-reference replay/recovery and attachment expiry using existing storage. Describe the effect of removing automatic permanent descriptions without retaining a substitute translator.
- [x] Resolve any pre-decision semantic screen verdict dependency within the existing admitted main decision.
- [x] Define the native equivalent of ambient `drop-after-describe` lifetime and semantic-sensitive output/discard behavior without retaining an independent translator/classifier call. Retained-image follow-up and expiry must have a concrete contract before production.
- [x] Select the smallest reusable capability metadata source and unknown handling. Keep it separate from paid tests and from native-image dispatch correctness.
- [x] Obtain an independent advisor challenge for this cross-layer design; review original owner requirements, especially all-image coverage and no translator even on the main model.
- [x] Owner approved execution of the coordinated plan; record concrete native carrier, accounting, lifetime and removed semantic-filter guarantees before production work.

## 2. Implement the coherent native path after review

- First complete native current-input and screenshot-continuation transport, then native perception/proactive material and retained-image replay/lifetime. These are development slices of one all-image delivery, not permission to exclude later sources.
- [x] Migrate all images into primary-model request preparation and preserve correct tool/result/source boundaries.
- [x] Remove the detached description writer, screenshot/ambient translation calls and their dedicated prompts instead of merely renaming their model dependency.
- [x] Remove/migrate separate vision configuration, operator/UI settings, calibration/health references and other obsolete wiring. Preserve original data.
- [x] Hand over the verified native request/source boundary for parent attribution integration; keep ownership of shared files explicit while remaining validation proceeds.
- [x] Update affected current specs and the parent task's request-content assumptions.

### 2b. Add reusable capability metadata independently

- [x] Add the minimal catalog/configuration projection and settings feedback with truthful declared/unknown/adapter states.
- [x] Do not block the native path on lookup success, introduce paid automatic probes, or migrate to another Agent framework for metadata.
- [x] Parallelize with native work only in disjoint files; configuration registry/composition changes still have one owner.

## 3. Validate real paths and accounting

- [x] User attachment and text-plus-image protocol paths go directly to the main model (real provider and isolated chat.send evidence); native desktop paste/upload manual acceptance is not inferred.
- [x] Agent screenshot reaches the next main request, with useful status and no recapture/duplicate side effect.
- [x] Proactive/perception/co-watching consumes a native image while preserving admission and silent/express/speak outcomes.
- [x] Subsequent questions and restart/replay use retained evidence correctly; expired/missing image handling is honest.
- [x] Requests contain valid native image parts for the actual adapter/model route, including tool-loop continuation.
- [x] No independent image-to-text call is emitted; expected request count and normal total input/output/cache accounting are observable.
- [x] Model metadata handles known image/tool support, unknown aliases/custom endpoints, catalog failure and native-vs-tool search accurately.
- [x] Configuration/UI has no orphaned vision control and normal model configuration remains usable.

Use focused deterministic protocol tests and relevant package checks first. Record bounded real supported-model verification within the owner's existing applicable paid-call permission; no automatic capability-probing sweep. UI/manual acceptance remains separate from tests.

## 4. Deliver

- [x] Review the complete migration against the owner's all-image requirement and the parent token-cost objective.
- [x] Record actual removed calls, observed totals, remaining uncertainty and any quality/retention tradeoff.
- [x] Collect the final full Core rerun: 4,524 tests passed, six skipped. Other required checks and spec synchronization are recorded in research/execution-progress.md, including the pre-existing artifact-only root lint exception. Commit/archive remain separate actions and have not been performed.

Research evidence remains linked from the parent rather than copied. Refine this checklist after design review; do not expand it into a new general model-routing or image-management project.

## 5. Approved model catalog extension (2026-11-04)

- [x] Repair the parent's requested-versus-response model association and verify the existing real-data cohort.
- [x] Extend the shared catalog projection with maintained display/provider names, explicit canonical identity, provider logo and relevant declared capabilities/limits.
- [x] Expand the existing Settings section with original IDs, metadata details and a local generic icon fallback; keep catalog declarations separate from runtime state.
- [x] Verify known aliases, absent fields, unknown/custom endpoints, catalog failure, image failure, configuration replacement and native CSP restrictions.
- [x] Run relevant regression, lint/type checks and real isolated Core/WS/browser evidence; update current specs and task delivery records.

**Next resume point:** native delivery, the metadata extension and Monitor identity repair are implemented; see the parent's research/model-identity-catalog-delivery.md for the latest evidence and exact quality gate results. Token-reduction pilots, owner manual acceptance, commit and archive remain separate outstanding work. Do not rerun successful broad gates without a new change or concern.
