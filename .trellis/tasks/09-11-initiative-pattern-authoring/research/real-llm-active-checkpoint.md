# Completed real-LLM C3 continuation checkpoint (2026-09-28)

The work below is historical and complete. Final evidence is `real-llm-acceptance-2026-09-28.md` and
`real-llm-verified-source-2026-09-28.json`: final real 8/8; Core 3627 passed plus one existing skip; Shared 632;
process/local HTTP 29; five-package typecheck and root lint all passed. All 2207 inventoried source/config and nine
policy hashes, HEAD and index stayed unchanged during the final Core gate. The child remains in_progress at
real_model_verified, with residual prose/owner acceptance pending. C4, commit, push and archive were not performed.
Completion window: 01a0e7b0-2232-7d01-9a80-cc106e24d0a5. User/tool item IDs are not exposed by this environment.
No test process or implementation item from the list below remains pending.

## Goal and authorization
- User clarified size rules: cohesive files may modestly exceed line caps; no line caps on test files or pointless splitting.
- User asked whether real LLM testing is necessary; root recommended natural-language creation/clarification/tool-selection/management/heartbeat tests, key scenarios 2–3 samples, real Core/Skill/DB in isolated data.
- User explicitly replied "同意": AUTHORIZED implementation of test harness, actual paid real-provider tests, proportional fixes/regressions, and size-rule alignment. Later user supplied config location: "H:\TakiAgent下有配置文件".
- Current task remains .trellis/tasks/09-11-initiative-pattern-authoring. DO NOT create new task or start C4. No commit/push/reset/rebase/archive.
- cwd H:/TakiAgent-worktrees/t4; branch task/t4-skills-mcp-productization; HEAD 06a8090118a45a8c4f06472be4917108f93aea44.
- Native task binding restored via process-scoped TRELLIS_CONTEXT_ID='codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167' then python .trellis/scripts/task.py start <C3>. CLI no longer has --session option. Global .trellis/.current-task remains stale Avatar Lab, never edit.
- Current context window 01a0e75f-576b-7262-ae2c-bd38c52c6b4e. User/tool item IDs not exposed in model context. Earlier original approvals were recorded in previous checkpoint/session logs; no need re-read them.
- Chinese progress every ~60 sec, structured panel. English code/docs. Current progress 4/5, real fixes tested; remaining final harness review, real rerun and regression/evidence.
- Skills read/applied this turn: trellis-continue, trellis-before-dev, diagnose. Workflow step2.1/2.2 explicitly requires implement/check subagents; dispatch prompts start Active task and forbid recursive delegation.
- Memory used worktree/authorization boundaries. Final MUST append one citation block MEMORY.md:17-18, rollout019ff509-d2c4-7b63-bdc3-ece6b53b855b.

## Real provider and secrets
- Actual file H:/TakiAgent/.env.local now exists (user provided). Only READ it; no edits in main worktree.
- Model deepseek-v4-flash, host api.deepseek.com, API key present; TAKI_MAX_STEPS=20; context default; includeUsage originally default/off.
- Do NOT print/copy API key. Existing e2e fixture realProviderEnv() reads file from TAKI_E2E_REAL_ENV_FILE. Tests pass credentials only in child env.
- New real suite opt-in requires BOTH config and TAKI_E2E_REAL_INITIATIVE=1. Ordinary test run cannot accidentally call these cases.
- Isolated tests use actual model/SDK/Core/Skill/Pattern APIs/SQLite, Local canonical Memory seeded with synthetic blocks. No real user DB or memory sent.
- Test mode turns TAKI_PROVIDER_INCLUDE_USAGE=true solely for accounting, TAKI_MONITOR_MODE=FULL_LOCAL and checkInterval1000 for deterministic source polling. Actual maxSteps20 is read from source config.

## Existing C3 gate before this extension (already delivered)
Shared632; Core3620+1 existing skip (444 files, serial717sec); Desktop1165; CLI50; C1/C2/C3 process20; 5-package typecheck/build/Clippy green. Native8 WebView2 groups. Root lint previously only QQMM361/360; size policy now fixed without touching QQMM file.
Evidence research/implementation-evidence-2026-09-28.md + verified-source-2026-09-28.json. These describe prior gate, must append/update extension evidence without falsifying old results.
Source baseline inventory2204, HEAD/index unchanged. All old gates log files under research/validation/.

## Agents
1. /root/c3_size_rules (trellis-implement) COMPLETED:
   - Owned eslint.config.js, CLAUDE.md size guidance, backend/frontend quality specs, e2e-harness test grouping guidance.
   - Test/spec JS/TS extensions and test/tests/__tests__/testing/e2e dirs exempt max-lines/max-lines-per-function ONLY. Other lint rules unchanged. Production still error360/50 with narrowly justified finite local overrides allowed. Root lint green; print-config21 checks. Evidence research/size-rule-alignment-2026-09-28.md.
   - Follow-up timezone fix completed: owns chat-agent.ts/current-time-tool.ts + existing tests/spec/index. Added ChatAgentDeps.userTimezone?:()=>string; capture once per attempt shared day/time plus explicit 'User timezone: ...' instruction. createCurrentTimeTool({userTimezone?:()=>string}={}) reads live once each execute; invalid supplied zone fails rather than host fallback; absent port preserves legacy.
   - Deterministic red5 new cases /22 old green then27/27; all ChatAgent+time128/128, Core typecheck/lint. Evidence research/real-llm-timezone-fix-2026-09-28.md.
   - ROOT HAS NOW WIRED main.ts: lazy createCurrentTimeTool({userTimezone:()=>userTimezoneService.timezone()}) and chatAgent userTimezone:userTimezoneService.timezone.
2. /root/c3_formal_check (trellis-check) RUNNING review of extension:
   - Owns e2e/src/fixture/real-provider-observer.ts and its NEW local-only tests; root owns real test suite.
   - Last message: observer ready, keeps baseUrl/requests/close. Optional probeMarkers {selectedMemory,primaryHistory} gives per-request selectedMemoryPresent/primaryHistoryPresent by checking messages only. Non2xx records bounded safe enum/error code/type + schemaObjectRootRejected, never raw body. Prefix bounded8192bytes. All upstream success/error bytes forwarded unchanged with drain backpressure. Idempotent close, abort on client close/stop, no fakeJSON appended to partial success stream.
   - Local HTTP8 tests passed incl64MiB backpressure; E2E typecheck/lint pass, production scoped34tests pass. Finishing partial-stream regression and research/real-llm-formal-review-2026-09-28.md.
   - Review findings root addressed: robust allSettled cleanup in real suite, preserve original assertion error, explicit context presence/no-primary-history assertions. Need wait final report and review fixes.
- Other earlier agents inactive, no need spawn.

## Files root added/changed THIS extension
- e2e/src/initiative-pattern-real.e2e.test.ts (~300lines cohesive test suite; exempt caps by owner). 8 cases:
  * authoring+5-turn lifecycle twice: natural user asks complete '晚间近况' clock19–21+presence, chance.25,60min, only Character Memory; actual propose, operator exact confirm, ask90min revision, confirm, pause,resume,rollback to60 pending (active90 remains).
  * unsupported stress/fatigue clarification twice: require no Pattern/no Schedule/nonempty response; textual semantics ROOT reviews saved replies.
  * one-shot tomorrow09:00 UTC reminder twice: actual schedule_task tool + real row + exact requested UTC instant (strengthened after baseline exposed wrong timezone).
  * real automatic heartbeat twice: first allowed silent-only, second all outcomes and seeded Character Memory about 赤隼计划 index finished/upcoming Friday demo. Operator creates/confirms test rule; actual clock/policy->Core->LLM->collector/delivery; simulated authenticated avatar outcome ack if expression. No dispatch injection. Outcomes may legitimately be silent; never force speech.
- Suite reuses startInitiativeProcess({productionEntry:true}) -> pattern-process-entry.ts unmodified Core import/readiness/stop only.
- e2e/src/fixture/seed-canonical-memory.ts extends optional {globalUserCard?,characterIndex?}, seeds actual StructuredMemoryBlockRepo before Core writer starts; old default behavior unchanged.
- e2e/src/fixture/real-provider-observer.ts now REVIEWER owned. Real byte-preserving loopback proxy, no mock responses. Request structural metadata/errors/context booleans only; actual usage from run_usage.
- Real test artifacts save synthetic dialogue, usage rows, tool names/limited Pattern+Schedule traces, statuses, delivery decisions, request metadata. Key value redacted. Not raw provider/model input bodies.
- ROOT latest suite changes not yet rerun after reviewer readiness:
  * HISTORY_MARKER='PRIMARY_HISTORY_C3_REAL_ONLY' seeded only into ordinary primary history.
  * observer probeMarkers selectedMemory:'赤隼计划', primaryHistory:HISTORY_MARKER.
  * Scenario.providerRequests() exposes observed metadata. Heartbeat asserts every request has selectedMemoryPresent true and primaryHistoryPresent false.
  * finalizeScenario uses Promise.allSettled for socket/process/proxy cleanup, always attempts evidence and removeFixture; only throws cleanup AggregateError if exercise passed, preserving original failure. mkdir moved inside try.
  * semantic assertions no longer demand equivalent weekday ordering or null startsAt; exact requested values and expiresAt remain checked.
  * heartbeat waiter now waits for any terminal state then immediately asserts completed (baseline incorrectly waited180sec on already-failed Runs).

## Real findings and fixes
1. Timezone deterministic bug:
   - UserTimezone UTC but hostAsia/Shanghai; primary prompt/current-time tool showed18:40 vs10:40Z.
   - Real schedule sample2 explicitly overrode user's UTC and scheduled local09 instead; initial weak test only checked schedule exists. Now exact timestamp asserted.
   - Fixed by timezone worker + root main wiring; initial source-less fallback retained only for callers not supplying authority.
2. Provider schema incompatibility:
   - Baseline both heartbeat requests failed before tools (provider_error).
   - Exact observed DeepSeek HTTP400: heartbeat_respond schema must root type object, got null. Its schema was {$schema,oneOf}.
   - Added deterministic failing test using actual AI SDK asSchema().jsonSchema; then fixed.
   - packages/shared/src/initiative-schema.ts adds HeartbeatDecisionToolInputSchema + type: strict object with ALL required outcome,selectedCandidateIds,text(nullable),presentation(nullable),responseExpectation(nullable), superRefine unused fields null/outcome requirements. Existing HeartbeatDecisionSchema persisted/domain union UNCHANGED.
   - packages/shared/src/index.ts exports new wire schema/type.
   - agents/heartbeat-respond-tool.ts advertises wire object; validates and maps via toDecision() to old strict domain union; all original candidate/outcome/presentation/currentness/conflict guards unchanged. Description explicitly says call tool even for silence and supply nullable fields.
   - Updated owning tests' model inputs to wire shape: heartbeat-respond-tool.test.ts (new object-root and missing-fields tests); initiative-runtime.test.ts; wake/wake-engine.test.ts. E2E initiative-runtime responseFor/other decisions now decisionInput adds null fields; speak-shaped existing C3 script already all-fields.
   - Focused62 tests passed after schema fix; Shared/Core/E2E typechecks passed.
3. Prose-only unsaved proposal:
   - Baseline authoring sample2 called load_skill + manage_interaction_pattern but persisted0 Patterns, then claimed review card exists. Exact original args unavailable (initial evidence saved names only); failure is real, don't invent action cause.
   - Strengthened manage-pattern-tool description and standard Skill guidance: actual propose required when user requests creation and fields clear; list/read/history/prose doesn't save; only applied/duplicate containing candidateRevision permits claiming card; refusal notsuccess.
   - Added no invented revision dates guidance after initial reply said 'yesterday' for changes made seconds before.
   - Round2 both full lifecycle samples passed and no 'yesterday' appeared. Small sample evidence, no universal reliability claim.

## Executed real batches / results (all under research/validation/)
A. real-llm-2026-09-28/authoring-1.json + real-llm-smoke.log:
   - first smoke1passed7deselected,31.93sec;5-turn full lifecycle success.
   -14 usage rows,218990 input+4103output (known reported); wrong host time and 'yesterday' wording observed.
B. real-llm-round1-2026-09-28/*.json + real-llm-round1.log:
   - selected7 cases:4pass3fail1deselected,435sec because old heartbeat waiter.
   - authoring2 failed no persisted candidate.
   - clarification1/2 structurally passed and texts correctly reject stress/fatigue sensing, ask supported sources.
   - schedules1/2 old structural test passed, but actual scheduled2 text admits wronglocal time (count as semantic failure, now exact-time assertion added).
   - heartbeat1/2 failed provider400 before tool, usageunknown.
C. real-llm-provider-diagnosis-2026-09-28/heartbeat-1.json + log:
   - one failed case reproduces400 quickly; artifact contains bounded raw upstream error from pre-review observer, already inspected no key; no need erase original failure. Final fixture no longer stores raw errors.
D. real-llm-round2-2026-09-28/*.json + real-llm-round2.log:
   - AFTER production fixes,8/8 pass,110.72sec.
   - authoring1/2:14 requests each, actual Skill load+manage operations; full5turns eachcorrect.
   - clarification1/2:2requests each. Root read both: explicitly deny fatigue/stress detection, ask threshold/source/interaction choices; no Pattern/Schedule. Some broad wording about 'program open'/physical computer use remains paraphrase, not new producer proof; don't overclaim subjective style.
   - schedule1/2:2requests each, both exact tomorrow09UTC asserted, texts correctlyUTC.
   - heartbeat1:1request, valid silent.
   - heartbeat2:2requests, speaks about actual seeded index complete/Fridaydemo + smile + invitation; no primary replay persisted.
   - This batch predates final observer-safe errors/context boolean assertions and robustcleanup; final rerun still needed.
- No running real test process now. Last session54975 completed8/8. Old81221 completed per logfile but toolsession may still need closing if queried. No ongoing Core test suite.

## Commands / next steps
1. Poll reviewer final state and read report; fixture now ready for final run.
2. Run current E2E typecheck/lint (new suite depends on reviewer fields now available), deterministic non-paid observer tests, and existing C1/C3 process20 due wire+seed/main changes.
3. Run FINAL real suite8 cases (separate artifact dir, e.g real-llm-final-2026-09-28) preserving all prior files:
   PowerShell process env:
   $env:TAKI_E2E_REAL_ENV_FILE='H:/TakiAgent/.env.local'
   $env:TAKI_E2E_REAL_INITIATIVE='1'
   $env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/09-11-initiative-pattern-authoring/research/validation/real-llm-final-2026-09-28'
   pnpm --filter @taki/e2e exec vitest run src/initiative-pattern-real.e2e.test.ts > .../real-llm-final.log 2>&1
   $testExit=$LASTEXITCODE; Get-Content ... -Tail...; exit $testExit
   Env scoped per exec shell, never keys in command.
4. Review saved actual responses, not just8/8. Ensure UTC actualinstants, proposaltruth, no internal binding disclosure, heartbeatgrounded Memory/nohistory booleans.
5. Appropriate final quality gate: combinedtypecheck/rootlint/Shared full; Core all changed Agent/time/schema/initiative tests already128+62 but given main/shared changes consider full Core serial (prior717sec; don't overlap timed full Core with cargo/native heavy). Desktopcode unchanged this extension; source-typechecks + relevant checks sufficient unless formal spec requires broader. Existing fullC3 baseline in evidence. Run process20, build if warranted.
6. Update indexes: new real suite, observer+its tests, seed description; shared initiative-schema entry says objectwire; backend initiative-runtime/interaction-patterns/tool-design specs about model objectroot vs domain union; primary timezone spec already worker updated.
7. Write real-llm acceptance evidence report with failures->fixes, final results, model/config source, usage totals across ALL batches including failed attempts, unknown usage rows explicit (never fabricate0), privacy/isolateddata, no realuserwrites, no manualownerAC claims.
8. Update C3 task metadata currentstage real_model_verified only once final done, preserve in_progress manualacceptancepending/noarchive/C4notstarted; append to parent/current integrated evidence. Old rootlint limitation superseded by new policy alignment nowgreen; unrelatedQQMM lock reproducibility remains.
9. Final source inventory reconcile HEAD/index unchanged; no secrets/rawkeys artifacts. Use existing research/verified-source JSON baseline and newextension checkpoint, don't falsely claim old gates cover changedcode.
10. Final conciseChinese outcome and limits; memorycitation as above.

## Caution
- Native 'no_task' workflow notices are stale per current shell missingenvidentity. Existing C3 task explicitly authorized/bound; don't ask to create task/reconfirm realcalls.
- jbcontext search this turn returned main fccfc index; root read actual t4 returned files and did no second broad search. Known locations now use direct reads/rg.
- User line rules specifically remove test caps, don't weaken security/other lint rules or split tests arbitrarily.
- Do not fake 'manual AC passed', don't claim100% reliability from2samples, no automaticcommit/push/C4/realapp deployment.
