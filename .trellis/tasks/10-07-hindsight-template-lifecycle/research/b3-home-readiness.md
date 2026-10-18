# B3 Home readiness (bounded read-only pass)

Date: 2026-10-08. Status: preparation only; B2 joint independent acceptance and an explicit root B3 dispatch are
still required. No production, tests, specs or task metadata changed; no tests/builds/generation/services ran in
this pass. References below describe currently inspected source, not an independent B2 correctness verdict.

## Readiness and one producer gap

The approved Home scope has narrow existing integration points. Core already exposes catalog choices, explicit
user revisions, selected/pending state, exact preview consequences and original-plan recovery availability.
Do not add another operation owner or reconstruct user intent/permission in React. One current derived-state
read gap needs Core/root resolution before Home can claim a refresh shows the current child result:

Root resolved this during B2: the Core owner is implementing `memory.templates.derived` for one admitted
`{ planId, bankId, childId }` per request, using the existing Native read-only result endpoint. It returns a real
observation time or explicit stale/unavailable state; lightweight status identifies its values as `rollout_record`.
This is implementation in progress, not an accepted producer. Home must consume the final reviewed interface,
using explicit reads/reconnect/visibility refresh without polling or write replay. No Native API change is planned.

- `template-status.ts:50-56` reads `latestTemplateObservation` and returns its recorded child states.
- `template-rollout.ts:72-85` is the only production caller of `templateRefreshResult` and writer of those child
  observations found by the scoped source search. That is execution verification before publication, not a
  post-publication status producer. `template-lifecycle-service.ts:38-39` and the registered status handler
  (`hindsight-template-methods.ts:25-29`) only read this local projection.
- `memory-template-schema.ts:74-79` has child state but no observation time/source/freshness qualification. A child
  still pending when publication finishes can later complete/fail at Native while every Home status refresh and
  reconnect continues to return the old state. This is a source finding; no reproduction was run in this pass.
- Required handoff: a bounded authenticated Core-owned read of the original child result, preserving original
  target/request/child identity and refusing stale/foreign responses, plus honest freshness/error semantics; or
  root must explicitly resolve the existing display as a recorded observation with current state unknown. The
  latter must not be described as live derived progress. Do not solve this by polling, re-applying, recovering an
  already bound plan, invoking model refresh, or allowing Home to contact Native. Route the decision through B2's
  Core review; no new product scope or user question is proposed here.

## Released-contract usage

All source paths in the following table are relative to the repository root.

| Approved behavior | Actual source seam and Home use |
| --- | --- |
| Bank and scope choices | `packages/shared/src/memory-hindsight-lifecycle-schema.ts:22-38` already supplies scoped `nativeBankId` and readiness through the existing authority read. Use these IDs; do not regenerate Native Bank names from Character names. |
| Catalog/default and per-Bank intent | `packages/shared/src/memory-template-schema.ts:18-28,64-92`: `defaults`, `catalogs`, `bank.latestUser`, `bank.selected.user`, `bank.pending`. Producer: `packages/core/src/memory/hindsight/template-lifecycle/template-status.ts:27-42,59-76`. Keep latest desired user revision distinct from selected/applied user revision. |
| Explicit value / inheritance / suppression | `packages/shared/src/memory-template-user-schema.ts:12-39` defines the complete choices, including complete custom model/directive definitions. Render/store the user's chosen mode directly; equality with effective/template text never changes it to inheritance. A null `latestUser` on an untracked Bank is absence of managed history. |
| Preview, conflict and enrollment | `packages/shared/src/memory-template-schema.ts:22-62`; `packages/core/src/memory/hindsight/template-lifecycle/template-preview-service.ts:26-55,60-89`. Preview is a Core-held five-minute reference. Ready detail includes before-images, exact changes/deletions and stable child IDs. Refused `review` carries actual name-match UUIDs; a reviewed-existing choice requires a new preview with the chosen exact identities. Do not auto-adopt collisions. |
| Removal and updates | `packages/core/src/memory/hindsight/template-lifecycle/template-plan-builder.ts:27` and `template-preview.ts:70` support explicit template revision `none`. Keep current explicit user choices unless the operator separately edits them; removal does not call disable/reset/delete-Bank. Built-in catalog revisions come from status, not hardcoded invented versions. |
| Apply and recovery | `packages/shared/src/memory-template-operation-schema.ts:17-24` uses only `{requestId,previewId,previewHash}` or `{requestId,planId}` through existing `memory.operations.submit`. `packages/core/src/memory/hindsight/template-lifecycle/template-recovery-admission.ts:17-48` supplies both actual admission and `recoverPlanId/recoverUnavailableReason`. No hold/phase inference in Home. |
| Partial/publication/binding/derived | `packages/shared/src/memory-template-schema.ts:74-92` and `memory-template-operation-schema.ts:32-37` expose per-Bank dispatch/receipt/selection, publication, original operation and separate outcome. Native receipt, selected revision, historical operation completion and currently available runtime are different rows. A non-null opaque bound hash alone is not proof that a selected Bank matches it. Preserve historical original-operation outcomes after binding-only recovery; observe recovery separately. Derived freshness has the gap above. |
| Authenticated boot registration | `packages/core/src/boot/hindsight-template-boot.ts:16-24` installs one service; `packages/core/src/server/methods/hindsight-template-methods.ts:13-38` validates Shared input/output and requires an authenticated operator. No new agent or Shell method is needed. |

## Exact future Home ownership proposal

Only activate this ownership after the joint B2 gate. One Home implementer can own this cohesive surface; no
per-file sub-agents are justified. Core/Shared/Native and backup/restore remain their existing owners.

- `apps/desktop/src/lib/ws-client-hindsight-templates.ts` and its tests: a new sibling to the accepted 5A adapter,
  parsing all released Shared read methods and their parameters, including the bounded derived-result reader.
  Minimal composition edits in `ws-client.ts`, `ws-client-methods.ts`, `rpc-deadline.ts`, and `lib/index.md`.
  Preview/derived are bounded network reads; status/detail are local reads. Preserve generic durable-submit
  ACK/unknown-outcome policy rather than making it a synchronous job.
- `apps/desktop/src/windows/home/pages/operations/hindsight-template-*` plus `use-hindsight-templates.ts` and
  colocated tests/test-only fixtures: focused state/controller, editor, preview/consequence and plan-status views.
  The exact component split follows responsibility/size limits; this is not a mandate to create every helper.
- `operations-page.tsx` composes the section; `operations/index.md` records it. Existing template operation and
  hold labels are already present in `memory-authority-state.ts:48,58`; preserve them rather than duplicating a
  second label registry. Relevant frontend spec edits belong to the future Home owner, not this readiness pass.
- Reuse `memory-operations-controller.ts:62-90,98-115,146-177` for subscribe-before-read, dirty-read coalescing,
  mutation serialization and post-outcome status reread. Wrap it like `memory-transitions-controller.ts:19-78`
  for one consumed request, obsolete preview/detail rejection and selection/client invalidation. A reader closure
  can capture the typed template client; the generic controller does not need a second operation implementation.
- Reuse `use-hindsight-activation.ts:23-45` for authenticated/visible-page lifetime and
  `ws-client-hindsight-configuration.ts:20-29` for the strict adapter pattern. Stage 5A health/observation controls
  stay independent. No browser persisted truth, synthetic subscription, direct Native access or write replay.

## Smallest meaningful implementation/check matrix

| Group | Required scenarios | Reuse / evidence boundary |
| --- | --- | --- |
| Adapter and controller | Strict preview/detail/status schemas; no Native snapshot in writes; subscribe before read; consume one confirmation synchronously; exact original request/plan; scope/editor/connection changes retire preview/detail; expired/conflicting preview disables submit; lost ACK refetches without replay. | Actual WsClient transport plus the existing generic controller; duplicate-click and retired-response cases belong in the focused suite, not a full browser per case. |
| Choice/editor DOM | Explicit equal-to-template value stays explicit; suppress differs from inherit; reset reveals current base/template; complete user resources survive `none`; per-Bank customization versus scope-default update; untracked/reviewed enrollment and same-name UUID selection. | Real hook/controller-backed interactions over Shared results. Do not use effective Native values as the sole editor source. |
| Consequence/confirmation DOM | Fetch exact details for every Bank in the reviewed multi-Bank plan before final confirmation; show config/resource changes, each deletion's history/dependencies/generated content and each requested child/provider consequence; detail failure/stale reference prevents confirmation. Keyboard dismiss/focus and separate explicit enrollment/deletion/provider acknowledgement. | `MemoryTemplateDetail` already supplies consequences. No model job is admitted by preview/read. Static formatting checks only supplement interactive behavior. |
| Actual operator WS + Core | Two observers; partial/lost Native reply; original operation stays identifiable after close/reconnect/reopen; only Core-advertised same-plan recovery; published binding failure recovery causes zero repeated Native apply; unsupported/untracked/conflict/stale/quarantined states. | Reuse `template-lifecycle-fixtures.ts:33-110` and existing `hindsight-template-methods.test.ts:166-217`; preserve its explicit synthetic runtime/checkpoint boundary. Core owns any reusable production-runtime fixture extension. |
| One integrated browser scenario | Real Operations section -> explicit choice -> preview/details -> one apply; hold producer behind an explicit fixture release, close initiator, second observer sees original partial/complete outcome; reconnect; customization -> removal preserves user choice; separate failed/derived display. | Reuse 5A `hindsight-configuration-browser-fixture.ts:20` / browser entry and W7 `memory-transitions-browser.test.ts:18-53` hold/teardown pattern. Keep the actual Core registry/service/operation owner; Native provider work uses deterministic fakes. No guessed sleep as recovery proof. |
| Milestone gate | Focused Desktop tests at <=2 workers, Desktop types and changed-source lint; adjacent Operations/5A/W7 read/reconnect regressions when their seams change. One whole-5B independent Home check after source release. Root schedules consolidated workspace/build/native checks serially. | No check was run in this pass. Packaged WebView2/CSP, installed Native, original credentials/data and owner acceptance remain Stage 6. |

Return contract gaps to the Core owner rather than fabricating UI facts. Once B2 resolves the derived-result
read boundary and releases source, Home is ready for the later explicit implementation dispatch.
