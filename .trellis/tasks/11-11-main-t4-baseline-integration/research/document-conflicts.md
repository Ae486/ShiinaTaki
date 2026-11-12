# Document Conflict Integration

Date: 2026-11-12. Scope: documentation and source indices in the isolated `G:/TakiAgent-integration` checkout.
Frozen inputs: main `9b98794` and T4 `63faf81`; authority follows this integration task's PRD/design.
This report does not establish integrated runtime, branch alignment, original-profile rollout or owner acceptance.

## Resolution

- Resolved 47 conflict blocks in 13 owned documents. Added the explicitly assigned Compaction guide update and
  consolidated 10 additional non-DB source indices: 24 changed documentation files in total, listed below.
- Main's newest Hindsight application/cache/binding/curator/admission, exact replica request/waiting, transition,
  activation, backup, template, custody and status contracts remain authoritative. T4's older timestamp/global-error
  replica attribution and obsolete no-workflow UI prose are not retained as active rules.
- T4 Local retention capture, source descriptions, exact primary-source durability/currentness, finite Tidy backlog,
  committed-progress/finish/retry semantics, initiative assembly and private delegation UI remain present.
- Compaction is scoped by the actual published binding: only `scope.local.current()` omits the fact-flush port.
  Hindsight, Legacy and unavailable bindings retain factual `prepareRetirement` coverage before generation. Legacy
  alone retains maintenance-before-compaction ordering. Explicit ingestion/activation/retirement coverage remains
  separate from published Local summary progress. This resolves the conflict without broadening the Local exemption.
- Historical T4 migration 064/067 feature contracts remain documented as historical lineage, without manufacturing
  those receipts on main/fresh installs. Guarded convergence follows `sqlite-migration-lineage.md`; the canonical
  integrated sequence remains main 001-063 plus 073-077, with existing historical receipts unchanged.
- Handoff and the documentation index now lead with the current isolated integration task and in-progress gates.
  Dated main/T4/ZCODE history and prior acceptance limits remain historical; old lifecycle instructions do not grant
  new production, Git or real-data actions in this task.
- Deferred decisions preserve distinct `main-D77` through `main-D81` and `T4-D77` through `T4-D81`, all newer main
  Hindsight rows and independent T4 rows. D84's old T4 Stage 1 limitation is superseded by main's exact-request W0
  closure rather than duplicated as an active contradictory status. Existing owner-deferred product choices remain.
- Removed 46 duplicate source-index rows while retaining combined actual responsibilities. Corrected application >
  environment > default precedence, independent provider maintenance/compaction ownership and durable-only migration
  mutations. Added `ws-client-binding.ts` as transport/frame/retire owner with a type-only route dependency; routing
  keeps its compatibility re-exports. Removed the nonexistent retired VLM translator entry, preserving historical-data
  wording under the actual single-primary native-image contract. Fixed one historical Avatar evidence link to its
  existing archived file.
- Memory operation signatures/table now cover all 21 current Shared kinds, including Tidy/index, templates and
  candidates, and the actual producer-checkpoint ports. No new operation or production behavior was implemented here.

## Grounding

Read the task PRD/design/manifests and runtime-contract research, applicable Trellis indexes/checklists and the shared
cross-layer guide. Direct production reads grounded the important seams:

- `packages/core/src/memory/runtime-compaction-composition.ts`: positive published Local branch, selected factual
  flush fallback and Legacy maintenance ordering.
- `packages/core/src/agents/compaction-coordinator.ts`: captured fact flush precedes model generation and records
  actual flush evidence; absent Local port does not emit fabricated success.
- `packages/shared/src/memory-operation-schema.ts`, Core operation contract/service/kind registry: all 21 kinds,
  exact producer arms, wait/checkpoint ports and automatic-origin ownership.
- `packages/core/src/config/config-source.ts`: application values outrank eligible environment fallback.
- `packages/core/src/agents/turn-registry.ts` and `memory/auto-memory.ts`: private scopes, idle/drain and independent chains.
- `apps/desktop/src/lib/ws-client-binding.ts` / `ws-client-routes.ts`: actual transport versus routing ownership.
- Settings page and `native-image-input.md`: current composition and retirement of separate VLM translators.

## Changed Paths

| Area | Paths |
| --- | --- |
| Main documents | `docs/index.md`; `docs/HANDOFF.md`; `docs/deferred-decisions.md` |
| Frontend specs | `.trellis/spec/frontend/index.md`; `.trellis/spec/frontend/home-window.md` |
| Backend specs | `.trellis/spec/backend/canonical-local-memory-runtime.md`; `.trellis/spec/backend/hindsight-application-runtime.md`; `.trellis/spec/backend/memory-current-state-cutover.md`; `.trellis/spec/backend/memory-operations.md`; `.trellis/spec/backend/memory-replica-sync.md`; `.trellis/spec/backend/compaction-harness.md` |
| Desktop source indices | `apps/desktop/src/lib/index.md`; `apps/desktop/src/windows/home/pages/settings/index.md`; `apps/desktop/src-tauri/src/index.md` |
| Core source indices | `packages/core/src/index.md`; `packages/core/src/agents/index.md`; `packages/core/src/boot/index.md`; `packages/core/src/config/index.md`; `packages/core/src/harness/index.md`; `packages/core/src/memory/index.md`; `packages/core/src/server/index.md`; `packages/core/src/server/methods/index.md`; `packages/core/src/testing/index.md` |
| Shared source index | `packages/shared/src/index.md` |

This report is the only changed integration-task artifact. DB indices, other task artifacts, production and tests are
owned by other collaborators. No original H: worktree, real config/data, Git ref/commit/push/archive was changed here.

## Checks and Remaining Limits

- `git -c core.safecrlf=false diff --check -- <all 24 paths>`: passed with no output.
- Explicit owned-path scan: no conflict markers, UTF-8 BOMs, duplicate named source rows or missing source files.
- Relative Markdown destination check: all 153 local links resolve. Fragment anchors are not evaluated by this check.
- Named source-index destination check: all 648 current `.ts`/`.tsx`/`.rs` rows exist. Grouped names and directory
  prose are not counted as individual file coverage; this is not a whole-repository file inventory.
- Decision-ID check: no duplicate IDs; both distinct 77-81 families remain.
- Extracted `MemoryOperationKind` set versus current Shared enum: exact agreement on 21 kinds.
- Whole non-DB source-index duplicate scan: no repeated explicit `.ts`/`.tsx`/`.rs` filename rows remain.
- These are static documentation checks and direct source reads. No runtime/model/native/UI test was run by this worker.
  Root owns the integrated quality and acceptance gates. Existing human/deployment/provider/data-scale limitations remain;
  no new owner decision is unresolved within this documentation scope.
