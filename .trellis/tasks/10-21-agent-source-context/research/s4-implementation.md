# S4 publication-storage implementation checkpoint

Date: 2026-10-22. The coordinator-released independent S4 subset is implemented and locally verified. This is a storage/publication handoff for independent review, not completion of the source child, Co-Watching adapter, semantic evaluation or owner acceptance.

Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. The source child was activated by the coordinator; the Runtime task remains the coordinator's session authority. No commit, push, reset, archive, deployment, model trial or real-user database operation was performed.

## Changed files and saved state

The exact 28 production/test/index paths and before/after SHA-256 values are in [s4/changed-files.json](s4/changed-files.json). Two are new: migration `057-source-context.ts` and its test. Other changes are the three released Shared schemas, Timeline/Delivery repositories, prepared-publication source/owner, the `ConversationStore.appendDelivery` signature/writer, focused tests, and necessary migration expectation/index mirrors.

[s4/preimages.json](s4/preimages.json) and `s4/preimages/` preserve the actual dirty-working-tree bytes. They include 28 owned paths and 16 additional source/prompt/replay/Memory baseline paths; newly created files are marked absent. The baseline includes the Runtime owner's already released mapper signature narrowing, before source rendering changes. It is not a runnable pre-delegation build or a live before/after semantic comparison.

[s4/working-preimage.diff](s4/working-preimage.diff) compares these working preimages, with line endings normalized for readable review. Directory index files also receive independent Runtime additions; S4 owns only its named existing lines plus the new migration line. Their whole-file hashes include the shared integration state. No Shared barrel, ChatAgent, RunService, main composition, S2/S3 module, general mapper, source producer, Co-Watching adapter or Memory consumer was edited by this subset.

## Exact field/API handoff

Reuse the existing S1 `SourceContextSchema` and `SourceContext`; no new source registry, role model or permission service was added.

| Boundary | Implemented contract |
| --- | --- |
| `PreparedPublicationCandidate` | Optional `sourceContext`. Candidate parsing clones its data; the retained source object, material array/objects and generation identity are frozen. Currentness compares the sidecar as well as text/expiry. |
| `DeliveryStage` / `DeliveryRecord` | Optional `sourceContext`. Staging validates it and rejects same-identity source changes with `DELIVERY_CONFLICT`. Original decision/status and selected candidate identity remain separate. |
| `PreparedPublicationOwner` | Copies the admitted candidate sidecar into staging. Its final publication guard compares the exact admitted/staged sidecar. Existing whole-candidate Run snapshot/provenance digests already include the new field, so `run-prepared-publication.ts` needed no change. |
| `RunDeliveryRepo.commitPublication` | Calls `append(characterId, text, sourceContext?)` inside the existing Timeline/quota/link/event transaction. Unsourced publication retains the original two-argument callback invocation. |
| `ConversationStore.appendDelivery` | Signature is `appendDelivery(characterId: string, text: string, sourceContext?: SourceContext): TimelineEntry`; the writer forwards optional source data without changing `content` or role. |
| `TimelineEntry` / `AppendInput` | Optional `sourceContext`, round-tripped through every existing Timeline SQL projection. Missing historical fields remain absent. Corrupt non-null source evidence fails explicitly instead of silently becoming unknown history. |
| Native tool-result parts | Timeline sanitation now retains S1 `sourceMaterials` beside the original output/name/call ID. It still removes only raw tool-call inputs; result failure/empty/status data is unchanged. |
| SQL storage | Nullable bare `source_context_json TEXT` on `timeline_messages` and `run_deliveries`. Absent metadata writes SQL NULL. Two migration triggers refuse later source changes, including historical null-to-source backfill; ordinary lifecycle fields remain mutable. |

Source context remains descriptive, not authority. The helper request still accepts only candidate reference and expected revision. No model-authored source label can supply acceptance, class, root, currentness or generation identity. Publication generation remains distinct from the Run that generated its material-derived text.

Sidecars live with their owning result/delivery/speech; removing transient producer data does not erase published meaning. Existing owning row deletion removes the sidecar with it. No new sweeper or independent material copy was introduced. This subset does not automatically attribute every seen material, add private work to the relationship Timeline, or expand Memory eligibility.

## Verification

Environment: Node `v24.18.0`, pnpm `10.22.0`, existing upgraded SDK; real `node:sqlite` fixture databases. No model requests were made by these checks.

| Check | Result and evidence |
| --- | --- |
| Deterministic pre-fix reproduction | Two source-carriage tests failed: Delivery rejected `sourceContext`; Timeline dropped source context/tool material sidecars. [s4/red-core.json](s4/red-core.json) |
| Core focused publication/repository/migration suite | 127 passed in 11 files. [s4/core-final.json](s4/core-final.json) |
| Delivery/ConversationStore/source-owner compatibility | 106 passed in 5 files, including two overlapping files from the focused suite; do not add these counts. [s4/compatibility-tests.json](s4/compatibility-tests.json) |
| Shared schemas | 34 passed in 2 files. [s4/shared-tests.json](s4/shared-tests.json) |
| Shared and Core typechecks | Both exit 0. [s4/shared-typecheck.json](s4/shared-typecheck.json), [s4/core-typecheck-final.json](s4/core-typecheck-final.json), corresponding logs |
| Root ESLint on all S4 changed TS files | Exit 0. [s4/lint-final.json](s4/lint-final.json) |
| Real Node Core boot | Listening log and socket connection confirmed; loopback provider trap received 0 requests. [s4/boot/boot.json](s4/boot/boot.json). Only the spawned process tree was stopped; its forced-stop exit is not an application crash claim. |
| Working-preimage audit | 28 changed paths, UTF-8 without BOM, no trailing whitespace, scoped `git diff --check` exit 0. [s4/source-audit.json](s4/source-audit.json), [s4/diff-check.json](s4/diff-check.json) |

Covered failure cases include source-only candidate drift at final publication, staged source identity conflicts, defensive copying, source mutation refusal, malformed source input before batch writes, corrupt stored sidecars, event-write rollback of speech/link/quota, fresh and populated-056 migrations/reopen, historical T4 migration fixtures, old text/sequence/receipt preservation, guarded-column refusal, migration receipt failure and an actual deferred-constraint COMMIT failure.

The first expanded Core run had five migration-fixture failures: an explicit historical registry omitted the new tail and full-row expectations omitted the new null column. The fixtures now include the required migration/nullable field while preserving all original data assertions. Two intermediate Core typechecks observed concurrently changing Runtime callback/export issues; the Runtime owner fixed them, and the final Core check above passed. No check was weakened to conceal a source regression.

Reproducible commands from the T4 root (report destinations must be absolute; `pnpm --filter` changes the child CWD):

```powershell
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared exec vitest run src/timeline-schema.test.ts src/prepared-publication-schema.test.ts
pnpm --filter @taki/core exec vitest run src/db/timeline-repo.test.ts src/db/run-delivery-repo.test.ts src/delivery/prepared-publication.test.ts src/db/migrations/057-source-context.test.ts src/db/migrations/056-subagent-conversations.test.ts src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/pending-memory-repo.test.ts src/db/scheduled-task-repo.test.ts src/db/migrations/048-memory-operations.test.ts src/db/migrations/041-canonical-memory-maintenance.test.ts
pnpm --filter @taki/core exec vitest run src/db/run-delivery-repo.test.ts src/delivery/prepared-publication.test.ts src/agents/conversation-store.test.ts src/delivery/delivery-coordinator.test.ts src/co-watching/publication-source.test.ts
$sourceFiles = @(Get-Content .trellis/tasks/10-21-agent-source-context/research/s4/changed-files.json -Raw | ConvertFrom-Json | Where-Object { $_.path.EndsWith('.ts') } | ForEach-Object path)
pnpm exec eslint @sourceFiles
node .trellis/tasks/10-21-agent-delegation-runtime/research/s1/boot-smoke.mjs H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-source-context/research/s4/boot-next
python .trellis/tasks/10-21-agent-source-context/research/s4/finalize-evidence.py
```

Test fixture TEMP/TMP were directed to the source task's `research/s4/tmp` for the expanded checks. One early red-report destination had an extra parent segment and wrote the test-owned report outside T4; after checking both absolute paths, that exact file was moved into `research/s4/red-core.json`. Unknown parent directories were left alone. All subsequent report paths were verified absolute T4 paths. No production or user data outside T4 was changed.

## Migration scope and remaining gates

Migration 057 is **T4-only, not merge-ready or release-ready against current main**. The local 056 tail had no 057 file, but current main `e260ff4` has a different 049–059 lineage, including a different 056/057. Renumbering only this task's migrations cannot supply the missing older families. The coordinator obtained the [independent current-main scope review](../../10-21-agent-delegation-source-context/research/current-main-migration-scope.md) and explicitly retained local feature validation without unrelated main integration. A single-owner higher guarded union convergence remains mandatory when actual integration/release is requested. No current-main database was opened by this work.

The rest of S4–S6 remains held or unfinished:

- S2/S3's compiled `SubagentWorkBinding` supplies `prepareExecution`, `validateAndPropose`, exact execution identity/token/signal and `yieldable_character_background`; the committed-result/control pump and explicit root handoff still gate the Co-Watching adapter. That adapter must retain the existing Skill/file validator, fresh per-Run artifact revision, foreground yield, user-stop latch, source/Host/revision/playback protections and original accepted publication root.
- S5 must implement common source rendering and prompts for actual child/continuation requests, assistant replay, tool reduction, compaction input/output and relevant description stages. Storage fields and this checkpoint's tests establish carriage only. Source labels must survive with associated retained content; arbitrary provider metadata is insufficient.
- S6 must update conditional primary-entry/C3/ingestion/compaction hashes and every exact SQL reader together before introducing source context on eligible primary rows. Null legacy digest behavior stays unchanged in this subset. No new primary source producer is enabled here. Preserve original wording/offsets, current eligibility and authority; child/private/delivery/summary rows remain ineligible.
- Memory prompt/source framing and supported native retain metadata remain to be implemented. Native Hindsight extraction/reflection consumption cannot be passed from a wire-only test or Local evidence.
- The acceptance owner still needs integrated deterministic requests, isolated authorized live-model comparisons and separate owner UI/playback acceptance. Reuse the existing passed connectivity baseline; do not repeat it as source acceptance. Full workspace/Desktop/Rust/integrated quality gates remain with the coordinated delivery.

Rollback uses only the captured S4 working preimages while reconciling collaborators. Preserve additive schema, accepted speech and retained source data; do not restore a database or drop the new columns. Once sourced speech exists, a supported rollback must retain source-aware readers or hold the affected automatic generation until a compatible forward fix is available.

## Recovery adapter handoff (2026-10-23)

The original checkpoint above remains unchanged as historical evidence. After Runtime released the owned-work, committed-result/control and exact-work currentness ports, Source implemented `co-watching/child-adapter.ts` over the shared SubagentService. The accepted root still owns native acquisition and publication; the model child owns private work, fresh per-Run artifacts and canonical terminal output. Existing Skill/file plan validation runs before a validated proposal; only its committed current result opens the edit gate. Source-aware candidates preserve video/moment/original generation meaning through this checkpoint's existing atomic delivery storage.

The [S5/S6 handoff](s5-s6-implementation.md) records the exact 46 recovery paths, including adapter/runtime/schema changes, and final scoped checks. `s5-s6-recovery/adapter-controls.json` passes 21 tests covering original-root publication, retained source after transient directories are moved, explicit child stop/continue, foreground yield and fresh artifact identity alongside existing native Governance/Approval and source cases. Deterministic zero-bounded-moment behavior remains model-free. Desktop separately consumes `paused_child` and exact child/work IDs.

These checks do not claim live Skill/file/model adapter acceptance or actual playback. A1-A3 source-semantic trials were never started; the owner instructed pause after current tests. No new paid model requests or token usage occurred in Source's recovery. The migration/main lineage limit above still applies, and no user/human acceptance was marked passed.
