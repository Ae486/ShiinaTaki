# S5/S6 source projection and Memory implementation

Historical status: original scoped implementation and paused test handoff, 2026-10-23. The owner subsequently authorized completing machine-observable work before human acceptance. The current implementation, bounded live trials, preserved failures, exact usage and remaining limitations are recorded in [Source acceptance results](source-acceptance-results.md). The sections below preserve the original deterministic handoff; their paused/live-unstarted statements are historical, not the current task state.

## Recovery and ownership

The native Codex session is bound to the existing Source child. The legacy global pointer was read and left unchanged. Work is confined to `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. Every one of the prior S4 28-path hashes matched its delivered value before this recovery. `s5-s6-recovery/preimages.json` records 77 candidate paths, with original bytes under `preimages/`; the two subsequently released shared test helpers have separate `test-preimages.json` and preimages. These are dirty-working-tree preimages, not a clean HEAD rollback.

Runtime released the narrowed mapper and now owns its ChatAgent/private input/continuation integrations. Source owns the common renderer, publication/Co-Watching adapter and exact original-primary consumers. Desktop independently owns the `paused_child` view and navigation. No commit, push, reset, clean, archive, main integration, release or real-user data mutation was performed. The exact 46 changed production/test/index paths and hashes are in [s5-s6-recovery/changed-files.json](s5-s6-recovery/changed-files.json), with a working-preimage diff and clean UTF-8/whitespace audit beside it. Directory indexes also contain concurrent Runtime entries; Source owns its named entries, not all peer index changes.

## Consumer contracts

| Boundary | Implemented carriage and lifetime | Limits and retained behavior |
| --- | --- | --- |
| Common source interpretation | `agents/source-interpretation.ts` supplies one source/role/subject rule. Base response, canonical advertised prompt through its existing derivation, description prompts, Write Gate, extraction, Compaction and tidy through `MEMORY_VOICE_RULE`, and Hindsight policy curator compose it. | The narrator/remembering Companion is distinct from the remembered subject. Explicit user self-report stays valid. No source classifier or eligibility change. |
| Native replay | `turn-mapping.ts` prepends source context to the same assistant/user model message. Tool source sidecars retain native call IDs, names, output kind and complete native payload. | Stored speech is unchanged. Unknown rows remain unknown. Tool inputs remain privacy-minimized. UI/TTS never receives the replay header. |
| Tool output rendering/reduction | `source-context.ts` emits source facts in actual SDK content. A projection-local WeakMap retains the association with the original tool body so the reducer can reduce the body and keep its source header. | It never parses arbitrary tool text as trusted source metadata. Error/denied/empty outcomes remain distinct. The map is not a source authority or durable catalog; each retained replay reconstructs it from its sidecar. |
| Replay folds / compactor | Source sidecars survive folded result traces; failure kinds remain failure kinds. `renderSafeTranscript` puts the source header outside the separately bounded original body and reports native tool outcome. | Source facts are not hidden in the middle of a large trimmed JSON payload. Existing credential/media omission, pure projections, native pairing and summary lifecycle remain. |
| Conditional source hashes | `primaryEntryDigest`, the Local and Hindsight source readers, C3 pattern/intention readers and `readPrimaryMemorySource` use the same optional-source interpretation evidence. Compaction capture/CAS adds optional row source context. | Absent/SQL-null source preserves previous digest property order/bytes. Source mutation cannot inherit old witnesses. Existing primary acceptance, routing and authority are unchanged. |
| Gate / extraction | `IngestionMessage.sourceContext` is optional and immutable within the saved span. Actual requests render its source description beside the exact eligible text. | Only positively witnessed original primary rows enter. Child/private/tool/delivery/summary rows do not become eligible. Source metadata itself is not an extractable user claim. |
| Retained original / native wire | `retainedIngestionSource` preserves exact original text and UTF-16 slices; optional context travels in existing per-entry metadata. Local batch checks bind sourced metadata to the exact selected span; native plan comparison already re-derives its whole request. | No wrappers are appended to retained text. Native metadata/wire carriage does not establish provider-owned extraction/reflection prompt consumption. No native prompt/config changes or memory rewriting were performed. |
| Co-Watching native stage | Existing accepted root owns native submission/read/verification, protected input files and original publication authority. | Native stage releases the Character lane after durable child acceptance. Zero bounded moments produce an empty no-publication plan without a model Run. |
| Co-Watching private stage | `child-adapter.ts` uses the shared service, private transcript, actual model intent and terminal result. Every new child Run receives a new artifact revision/path; existing `readCoWatchingPlan` validates the exact artifact/native moments/committed-candidate baseline. | No separate model pump. Missing/invalid artifacts become a typed domain failure proposal and failed canonical result. Source/edit/stop/work currentness is rechecked before the committed result can open publication. |
| Co-Watching publication | Committed plan and candidate sidecars retain original child Run/Attempt, video title/reference and validated moment locator. Existing original accepted root remains the prepared-publication parent. | A current result is inspectable before edit confirmation. Source/Host/Skill/revision/playback/foreground guards remain authoritative. Transient artifact removal does not remove already-published source meaning. |

## Ports handed off

Source exports `renderSourceContext`, `renderContextMaterial` and `renderToolResult` from `agents/source-context.ts`. Runtime integrates them at actual child, newly completed tool and parent continuation inputs; it also owns `read_file` program-known metadata and selected `MaterialRef` resolution. The mapper handles retained private and primary tool parts through the same renderer.

An actual-SDK primary test exposed a conversion boundary that a direct mapper test did not: non-enumerable producer source metadata is absent from SDK-converted response values. Source added `retainStepToolSources(messages, rawCompletedResults)`; Runtime calls it before canonical primary recording. It annotates only exact matched call ID/name pairs with facts present on the original completed producer output. The mapper retains the sidecar separately from native output. The actual SDK/SQLite regression now passes; arbitrary model-authored JSON source labels still cannot mint those facts.

The adapter consumes `SubagentWorkBinding.prepareExecution`, `validateAndPropose`, post-commit `onCommittedResult`/`onControlChanged`, `SubagentValidationError`, owned submit/yield/resume and `isWorkCurrent(token, phase)`. Runtime wires `deps.subagents` in main. Exact-work publication currentness ignores independent work B while refusing same-work newer inputs and child stop latches. The dependency is optional for existing callers, but bounded preparation requires the shared service; there is no old direct-model fallback.

Shared Co-Watching read state adds `paused_child` plus optional exact `subagentId` and `workInputId`. Desktop uses these fields to open its existing child page. The child page's authenticated Continue command owns user-latch removal; the Co-Watching scheduler cannot clear it.

## Verification and repaired failures

Environment: existing upgraded SDK on Node 24 / pnpm 10; all commands ran from the T4 worktree. Test databases, native/model/browser producers and temporary workspaces are isolated synthetic fixtures. No source-semantic live request was made. [checks-final.json](s5-s6-recovery/checks-final.json) records the static exits; [final-test-summary.json](s5-s6-recovery/final-test-summary.json) records the test reports and the latest result per file/full test name.

| Evidence | Actual result |
| --- | --- |
| `focused-first.json` | 26 passed in 5 files: actual compatible-provider request serialization, replay/reduction, exact Local/Hindsight primary readers/digests, source framing/text offsets and Co-Watching lifecycle/null-end paths. |
| `adapter-controls.json` | 21 passed in 4 files: shared-child committed plan before original-root publication; source replay after transient input/artifact directories were moved; user stop, owner revision while stopped, authenticated continue, foreground yield/fresh Run artifacts; existing real Governance/Approval native-read regressions, native progression and conversation context. |
| `compatibility.json` | 168 passed, 2 failed across 9 files. One failure was a legacy compactor tool-label format expectation; the source-aware renderer restored that existing `toolName(callId)` display while retaining outcome/source framing. The other was the actual SDK primary source-loss boundary described above. Both pass in the later `consumers-final.json` run. Remaining passing cases include exact historical compaction digest bytes, source-CAS rejection, actual compactor request/summary replay and Local/native ingestion compatibility. |
| `consumers-final.json` | 59 passed, 39 failed across 10 files. Exactly 38 failures were explicit old migration-list fixtures stopping at 052/054 while constructing the current Timeline reader; their error was `table timeline_messages has no column named source_context_json`. The remaining failure expected curator prompt version v1 after the deliberate source-aware v2 change. This was not a failure of a fresh/current migrated database. |
| `consumers-repaired.json` | All 51 tests passed in those 3 files after adding the already-existing 057 migration to their explicit test lists and expecting curator v2. Original primary/source/authority assertions remain. No production schema fallback or historical migration rewrite was added. |
| `shared-final.json` | 2 Co-Watching schema tests passed. |
| Final Core typecheck | `pnpm --filter @taki/core typecheck`, exit 0; `typecheck-final.log`. |
| Final Shared typecheck | `pnpm --filter @taki/shared typecheck`, exit 0; `shared-typecheck-final.log`. |
| Final Source lint | `pnpm exec eslint <all .ts paths in changed-files.json>`, exit 0; `lint-final.log`. The initial four-parameter adapter helper and unused test binding were corrected without disabling checks. |
| Final source diff/audit | `git diff --check -- <all manifest paths>`, exit 0; `diff-check-final.log`. All 46 changed paths are UTF-8 without BOM and have no trailing whitespace. |

Across these listed reports, the latest result for each distinct file/full-test-name pair is **290 passed, zero remaining failed**. This is a deduplicated scoped evidence summary, not one 290-test invocation and not whole-tree clearance. Earlier Core typechecks observed concurrent Runtime errors that its owner repaired. Source's early fixture-field error was corrected to inspect real SQLite.

`cowatching-first/second/third.json` retain intermediate observations. The moved fixture now executes real ChatAgent and SubagentService rather than bypassing WorkContext input receipts; its artifact-writing model producer remains synthetic. An assumed hard-coded tool allow-list was removed to preserve the original captured governed tool contract, rather than invent availability. The shared child read-only Memory restriction remains. Native-stage and foreground release now explicitly hint the existing shared scheduler; no second model pump was added.

Reproduce only an affected group when new changes justify it. Commands used for the repaired/new boundaries include:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/source-context.test.ts src/agents/source-compaction.test.ts src/agents/context-reduction.test.ts
pnpm --filter @taki/core exec vitest run src/co-watching/child-adapter.test.ts src/co-watching/runtime-permissions.test.ts src/co-watching/native-analysis.test.ts src/co-watching/conversation-context.test.ts
pnpm --filter @taki/core exec vitest run src/initiative/patterns/pattern-source.test.ts src/initiative/intentions/intention-service.test.ts src/memory/hindsight/hindsight-policy-curator.test.ts
pnpm --filter @taki/shared exec vitest run src/co-watching-schema.test.ts
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared typecheck
$sourcePaths = @((Get-Content .trellis/tasks/10-21-agent-source-context/research/s5-s6-recovery/changed-files.json -Raw | ConvertFrom-Json).path)
pnpm exec eslint @($sourcePaths | Where-Object { $_.EndsWith('.ts') })
git diff --check -- @sourcePaths
```

## Bounded live fixture handoff

For external/self-report/mixed cases, use `testing/prepared-publication-fixture.ts` with program-owned `candidate.sourceContext`, its real prepared-publication/Timeline transaction and `createChatAgent` with the selected real provider. Label the accepted source and playback producer synthetic. Drive Compaction via the existing `createCompactionPass` over the same Timeline/Summary repos and an explicit test-owned flush boundary; inspect its actual Utility request and a later ordinary ChatAgent request. This exercises the real source merge without adding a chat debug endpoint or bypassing original-primary eligibility.

This remains a handoff recommendation, not an implemented or executed live fixture. The coordinator approved up to three scenarios with at most three generations each and a separate physical-request cap, using its `e2e/src/fixture/real-provider-observer.ts` synchronous synthetic capture. Provider credentials would be read only through `e2e/src/fixture/paths.ts` and never copied into evidence. A real eligible primary witness requires the real flush; alternatively genuinely unwitnessed synthetic rows must explicitly label Memory flush as unexercised. Do not report a fabricated no-eligibility result or baseline improvement. The owner paused work before these calls began.

`testing/co-watching-fixture.ts` now also composes real SubagentService/ChatAgent/Run/SQLite, but its model producer writes a fixture artifact directly. It is a deterministic lifecycle harness, not proof of real Skill/file behavior. A live Co-Watching adapter trial must use actual governed file tools and installed Skill against test-owned analysis files, while still labelling synthetic playback separately. Existing `co-watching/real-prepared-playback.test.ts` is historical generic prepared-output evidence; it does not establish the new shared-child adapter.

## Remaining gates / risks

All current Source-owned checks above have finished; no Source-owned test/provider process is still running. The owner explicitly requested pause after this test task, so no live fixture, new scenario, further implementation or paid retry was started. A1-A3 semantic trials, full new Co-Watching Skill/file/model acceptance, native Hindsight extraction/reflection consumption, owner natural-conversation/playback acceptance and whole-tree/integration gates remain unverified. The coordinator owns overall AC01-AC11 disposition; mocks cannot pass semantic criteria. Local 056/057 migrations remain T4-only under the accepted divergent-main lineage limitation; no cross-branch migration clearance is claimed. Task completion/acceptance boxes are not marked complete by this scoped handoff.
