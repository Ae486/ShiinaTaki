# Superseded by the final C3 verification checkpoint

C3 integration and automated gates completed on 2026-09-28. Read implementation-evidence-2026-09-28.md, formal-review-2026-09-28.md and verified-source-2026-09-28.json before resuming. Manual acceptance and C4 remain pending; no commit/push/archive. The following is preserved historical in-flight state, not a remaining-work list.

# C3 active implementation checkpoint (2026-09-28)

## Goal, owner and boundaries
- Latest owner messages: "同意" to start existing C3; then "rate limit 直接继续即可". Continue to finish C3 implementation, integration, tests, formal review/specs. Do NOT stop at module completion or another plan.
- Earlier user asked to understand Hermes/OpenClaw + Taki design and readiness; answered with source-backed design and C1/C2 readiness. Those assessment turns are complete.
- Current window: 01a0e700-4c6f-7831-a73a-8ca397cadfeb. User/tool item IDs are not exposed in this environment.
- cwd H:/TakiAgent-worktrees/t4, branch task/t4-skills-mcp-productization, HEAD 06a8090118a45a8c4f06472be4917108f93aea44.
- Current task .trellis/tasks/09-11-initiative-pattern-authoring is in_progress. Native pointer source session:codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167. Global .current-task is stale Avatar Lab: never touch it. No replacement task.
- No commit/push/reset/rebase/archive, real-user DB/model calls or other worktree edits. QQMM independent edits preserved. Owner manual ACs stay unchecked.
- Chinese user updates at least every ~60 sec, structured progress. Code/comments/docs English except product strings Chinese.
- Last progress 3/5: native UI and source modules tested; root finishing production Core wiring.
- Workflow uses trellis-implement/check agents; named AGENTS explicitly authorizes this. First context_explorer failed unsupported luna 404; root did ONE broad jbcontext search and read actual hits. Do not repeat broad search. Rate-limited agents are resumed with followup_task; no model changes.
- Memory used for worktree guidance; final response must cite MEMORY.md:17-19, rollout 019ff509-d2c4-7b63-bdc3-ece6b53b855b.

## Prior baseline already completed
C2 automated-verified: Shared610/Core3460+1 existing skip/Desktop1104/CLI50/E2E17/Rust205; typechecks/build/Clippy passed. Independent root lint qqmm-home-native-smoke.mjs 361/360 and repository vs installed QQMM lock mismatch remain. C2 verified-source JSON inventories 2104 files. Those source hashes matched before C3 start. Do not reimplement C1/C2 or claim whole workspace green.
C2 evidence under .trellis/tasks/09-11-initiative-presence-feedback/research. C2 task remains in_progress manual pending; parent next child was C3.
C3 parent docs/research already read broadly (current design, decision-register, domain-contracts, reference-designs, earlier t4 grill/engine and owner corrections). Reuse accepted design.

## Live agents / ownership
1. /root/c3_pattern_domain (trellis-implement, resumed after rate limit):
   - Owns packages/shared/src/interaction-pattern*.ts; packages/core/src/initiative/patterns/; migration052 + tests.
   - Foundation done, evidence research/pattern-domain-implementation.md. ~28 Core +18 Shared tests passed, typechecks/lint at that point.
   - ADDITIONAL current ownership: perception/perception-evidence.ts and associated activity source helper/tests; presence/presence-service.ts / presence-sources.ts, new presence return tracker/tests; Shared presence-schema.ts optional inputContinuity + tests; Desktop features/presence source/window tracking + tests; related specs.
   - Exact usable APIs: perception.evidence.foreground(now): InitiativeForegroundFact|undefined; presence.service.recentReturn(): InitiativePresenceReturn|undefined. PresenceService constructor supports onSourceChanged?:()=>void.
   - Source tests: 43 Perception/old invalidation tests, combined Core66+, Desktop18+, Shared12 passed before last fixes. Real Desktop source->Core integration covers 44 native refresh rounds and real return. Last fixes: rate-limited negative closure cannot piggyback return; document.hidden ends tracking. Finishing final focused tests/evidence.
2. /root/c3_wake_policy (trellis-implement):
   - Owns initiative/wake/, shared/initiative-wake-schema.ts, config/initiative-wake-config.ts, migration053+tests.
   - Wake done ~33 Core+3 Shared, evidence research/wake-policy-implementation.md.
   - ADDITIONAL current ownership: provider-neutral Memory initiative assembly in canonical-memory-run.ts, memory/initiative-memory-assembly.ts, minimal Legacy/Local/Hindsight assemblers/captures/tests/specs. Root has not edited these.
   - Exact new API CapturedMemoryRun.assembleInitiative?: (selection:{global:boolean;character:boolean})=>{text:string;sources:InitiativeContextManifest['sources']}. Always full Persona, only selected bounded Blocks/index, no pinned/old intention picker/auto recall/model/primary pressure. Default primary assemble unchanged. Actual content digests/source refs, authority fence. Implemented, final runtime tests/lint pending.
   - Fixed wake currentness: drafting pending Pattern revision doesn't invalidate unchanged effective accepted revision (ignore view.version if accepted revision/state same).
3. /root/c3_pattern_ui (trellis-implement, fork none, resumed after rate limit):
   - Owns Desktop features/initiative-patterns/, windows/home/pages/initiative/, pages.ts/home-shell.tsx, Chat chat-page.tsx + timeline-view trailing ReactNode slot, narrow tool-result-display.ts + timeline-message for authoring metadata privacy, existing Monitor policy card; related tests/spec/index.
   - Does not own WsClient/shared/Core/main.
   - Native latest EIGHT groups passed actual WebView2 with real PatternService/SQLite, scripted setup/Timeline, no model. Final artifacts apps/desktop/src-tauri/target/c3-pattern-native-evidence/2026-09-28T09-32-19-095Z. Actual reader nonzero scroll/focus/selection; candidate exact confirmation/conflicts, pause/resume, rollback, lost ACK/reconnect/no replay, manual create/retire. Fixed test harness serialization/readiness and real header-scrollbar overlap. No native/Rust process now.
   - Currently running full Desktop tests --maxWorkers=2/build/lint/typecheck then evidence. Need preserve raw native artifacts into task directory and review report, no false packaged/manual acceptance.
4. /root/c3_seams failed unsupported model, inactive.

## Domain APIs already on disk
Shared interaction-pattern-schema.ts: definition {title,purpose,conditions:{all},contextSelectors,allowedOutcomes,timing:{minimumGapMinutes,chance},lifetime:{startsAt,expiresAt}}.
minimumGapMinutes = between ADMITTED judgments incl silence; global utterance gap independent.
7 atoms local_time_window (start,end,daysOfWeek1..7), application_in_set, activity_dwell_at_least.minutes, known_idle_state active/idle, presence_present, intention_due (inert C3), completion_of {runId,label}.
View {patternId,characterId,state,version,effectiveRevision,candidateRevision,createdAt,updatedAt}; revision {revisionId,baseVersion,definition,origin:{kind,description},changes,createdAt,acceptedAt}.
Shared interaction-pattern-protocol.ts: INTERACTION_PATTERN_METHODS interaction-pattern.list/get/history/propose/confirm/change-state/rollback/changed. All exported schemas have same-name types. Mutations commandId + expectedVersion, confirm candidateRevisionId; results applied|duplicate with pattern, refused with reason/current.
Core patterns/pattern-service.ts createInteractionPatternService({db,now?:()=>Date,onChanged?}) returns list/get/history/listActive/findSeed/propose/confirm/changeState/rollback/registerPrimarySource/notificationFailures.
Actor (pattern-source.ts): operator{operatorId}; agent{runId,attemptId,toolCallId}; seed{seedId,seedVersion}. Agent must register actual primary user row, current running Run/active Attempt. registerPrimarySource({characterId,runId,attemptId,userTimelineSeq,userTimelineId}):boolean. Call on actual tool EXECUTE, not every user turn (bounded source records). Stable source content digest blocks retract/edit/foreign/replay.
Seed findSeed(characterId,seedId), reimports/new command/version preserve existing user state, never overwrite. Rollback proposes, confirmation preserves paused state.
Migration exports interactionPatternsMigration052 and initiativeWakePolicyMigration053. ROOT HAS NOT REGISTERED THEM YET. Current registry tail still051.

## Wake APIs
wake/wake-contract.ts holds interfaces.
createInitiativeWakeEngine(deps) => start(), notify('source'|'policy'|'release'), evaluate():Promise<void>, read(characterId):InitiativeWakePolicyStatus, close():Promise<void>.
deps {db,patterns:{listActive},snapshot,policy():C1 InitiativePolicy,wakePolicy,prepareContext,contextIsCurrent?,runtime:C1 InitiativeRuntime,busy,invalidate?,onChanged?,onError?,now?}.
WakeSnapshot {enabled,targetId,targetReady,policyRevision,timezone,timezoneRevision,primaryVersion,privacyPaused,presence,foreground,presenceReturn,completions,intentions:[]}.
Source schemas in shared initiative-wake-schema; foreground requires meaningful boolean. Real completions accept RunInitiator but matcher only scheduled/subagent/webhook, exclude primary/heartbeat/maintenance and ClassA already delivered.
Global claims/cadence/diagnostics in053; C1 still owns Run admission/model charging/utterance quotas. Never second model loop/queue/ledger. pending busy max90sec doesn't interrupt tools; current output lifetime separate.
Root invalidate callback MUST cancel only actual heartbeat Run IDs; use turns.cancel(characterId,runId) after checking run initiator, never character-wide primary cancel.
Shared INITIATIVE_WAKE_METHODS read='observability.initiative-policy', changed='observability.initiative-policy-changed'; Params/Changed strict {characterId}.
WakePolicySchema exported, fields periodicEnabled/eventsEnabled/checkIntervalMs60s/modelCadenceMs15m/jitterRatio.2/quiet23-08.

## Root files ALREADY written/modified (need integration/tests/review)
- shared/index.ts exports Pattern, Wake and Setup schemas. NOW EXCEEDS reviewed500 lint lines by ~30! Need legitimate same-module value/type export consolidation (many paired blocks) without deleting exports, raising cap or artificial formatting. Do later as part integration.
- shared/initiative-setup-schema.ts root-owned:
  INITIATIVE_SETUP_METHODS read/install-skill/propose-seed/changed
  SetupStatus {characterId,targetCharacterId,targetReady,settings:ConfigEntry[].max24,timezone,timezoneConfirmed,
    sources:{activityAvailable,application,presence,intentionAvailable:false},completions:[{runId,label}],
    skill:{state:missing|ready|disabled|conflict|unavailable,packageId,configRevision},
    seeds:[{seedId:'evening-reflection',title,description,definition,existingPatternId}]}.
  Reuse existing configSet/subscribeConfig for changes; no parallel config store.
- Desktop lib/ws-client-initiative.ts methods initiativePatternsList, initiativePatternRead/History/Propose/Confirm/ChangeState/Rollback, initiativeSetupRead/InstallSkill/ProposeSeed, initiativeWakePolicy, all schema-validated.
- Added it to ws-client-methods.ts requestMethods and WsClient extends InitiativeMethods.
- ws-client-routes.ts 3 isolated PushSlots and addInitiativeChangedHandler, installInitiativeRoutes, close cleanup. WsClient methods onInitiativePatternsChanged/onInitiativeSetupChanged/onInitiativeWakePolicyChanged. Invalidation only to authenticated operators, no special subscribe.
- agents/chat-agent.ts adds primaryTools?({characterId,userEntry:TimelineEntry,turn?}):ToolSet and merges only actual primary userEntry before core governance. Keep existing coreTools API. Actual appended source is passed, never latest-row query.
- initiative/manage-pattern-tool.ts exports createManagePatternTool({service,characterId,userEntry,turn}); name manage_interaction_pattern; action list/read/history/propose/pause/resume/retire/rollback, no confirm. Validates/registers exact source on mutations with options.toolCallId. Returns {ok:true,...domain/query} or {ok:false,code:'PATTERN_REFUSED',reason,message,current?}. UI agent handles semantic-only tool output display; Monitor inspector must also not leak IDs.
- server/methods/interaction-pattern-methods.ts operator-derived live identity, thin Pattern methods. requireInitiativeOperator exported.
- Added governance core.initiative.pattern.manage / interaction-pattern-manage immutable auto internal cell, Core adapter binding, human label 管理互动习惯 in shared governance-presentation + tool-presentation.
- shared/initiative-schema.ts OPTIONAL candidatePolicies [{candidateId,allowedOutcomes}] for C1 compatibility; C3 always supplies; strict complete unique policies incl silent.
- agents/heartbeat-respond-tool.ts acceptsDecision? guard, rejects disallowed outcome; initiative-runtime collector checks captured candidatePolicies. harness/run-snapshot-capture.ts freezes policies and arrays.
- config/initiative-wake-knobs.ts uses WakePolicySchema.shape and registers explicit TAKI_INITIATIVE_TARGET_CHARACTER default null + wake fields. knob-registry imports spreads. config-writer calls validateInitiativeWakeChange.
- resources/skills/companion-pattern-authoring/SKILL.md real runtime guide. initiative/authoring-skill.ts loads FIXED bundled bytes, standard validate/hash/import, never overwrite/re-enable collision/disabled, detects exact immutable hash. No model-selected fs path.
- initiative/initiative-setup.ts actual setup read and seed proposal + Skill action; one explicitly reviewable evening20-22 seed, never auto-enable. OnChanged callback currently can throw after import: consider isolating to preserve durable success. Uses config.effectiveAll filtered prefix, timezone.confirmedAt, real source/completion callbacks, findSeed.
- server/methods/initiative-setup-methods.ts setup APIs and existing-Monitor-enabled policy read; no fake Runs.
- initiative/initiative-context-builder.ts create builder with prepare(selection) and isCurrent(selection); WeakMap stores captured memory lifetime. Calls new assembleInitiative with exact scopes; creates source manifest, candidatePolicies, bounded fenced purposes, optional fresh observations, allowed read tools. IMPORTANT review: currently formats User time with Intl directly; project core/time seam may require switching to renderCurrentTime helper. Also ensure screen/presence optional source manifests/currentness accurate. No tests yet.
- agents/turn-queue.ts adds isBusy(key) read-only and optional createTurnQueue({onAvailable}) release/cancel observer; wraps release once, observer isolated. No second lane, existing API compatible. Needs tests (primary reservation priority/cancel/observer).
Root has NOT modified main.ts for C3 yet; no production integration or process acceptance yet.

## Critical ROOT next work
1. Add real composition wiring, not merely passing fake unit ports:
   - main early lifecycle forward ref before bootstrap/source callbacks; PatternService before ChatAgent primaryTools.
   - register migrations052/053 and relevant current-tail/reopen test assertions (preserve explicit historical through050/051 tests).
   - wire createManagePatternTool actual primaryTools + registerInteractionPatternMethods.
   - make new Core composition helper (initiative/...) to build WakeSnapshot from config/UserTimezone/queue/Perception evidence.foreground/Presence recentReturn, actual known-completion repo and explicit target readiness.
   - construct ContextBuilder using memoryRuntime.captureRun, avatarVocabulary.render, existing renderScreenContext; build actual setup from skillBoot.service + patterns + source/complete callbacks.
   - existing composeInitiativeRuntime returns runtime + finishScheduled. Pass runtime to Wake engine, start only after boot/recovery/WS ready, stop/seal before DB close.
   - callbacks for config, Perception, direct source changes, timezone and actual background completion; no fake operator Connection used for subscribing internally.
2. Need minimal real notification ports NOT YET WRITTEN:
   - PerceptionChanges/Layer currently only opt-in frontend subscriptions. Add optional local data-free callback in PerceptionChangesDeps and PerceptionLayerDeps, invoke from changed() after batch coalescing, preserving existing C2 counts. Don't fake authenticated operator to observe.
   - Presence composition input onSourceChanged -> service constructor (already supports).
   - Config bootstrap bootstrapCore currently one arg, returns config subscriptions/writer. Could add optional onConfigChanged callback in bootstrap options; publish config subscriptions AND safe local callback, no duplicate writer.
   - RunEventLiveBus currently per-run subscribe only. Add optional post-commit local observer to createRunEventLiveBus(backfill, onCommitted?) or equivalent; callback observes only actual run.settled then looks up actual background initiator, excluding own heartbeat. No broad every-tool event reeval loop.
   - TurnQueue onAvailable already added; root instantiate with wake.notify('release').
3. Actual existing paths/facts:
   - main.ts boot line137; runEventLive line150; connectionRegistry224; perception constructed~310/start321; presenceRuntime322; turnControls~365; timezone370; chatAgent390; C1 initiativeRuntime513; WS server~550; shutdown~560.
   - Config boot real file boot/core-bootstrap.ts (not guessed config bootstrap paths). ConfigPlane {source,repo,subscriptions,writer}.
   - Runs schema024 fields run_id,character_id,initiator,state,terminal_at,parent_run_id; receipts summary; run_deliveries schema049 has run_id,delivery_class,charged_at,timeline_seq. Add DB READ repo for bounded completed background choices/facts; filter actual completed scheduled/subagent/webhook, exclude delivered ClassA, don't use summaries as trigger facts.
   - RunService.status/queue/requestCancel; TurnRegistry.cancel(characterId,runId).
   - PerceptionLayer screen and renderScreenContext from perception/screen-context.ts.
4. Add root focused integration tests: actual ChatAgent -> actual PatternService -> real operator confirm; strict outcome policy refusal; WS facade parsing/stale notifications; config validation; Skill fresh import/discovery/load/collision/disabled; context privacy/scopes/currentness; queue observer.
5. Real Core process E2E using existing e2e fixture/local scripted provider (e2e/src/initiative-runtime.e2e.test.ts etc). Must demonstrate proposal in primary tool, exact confirmation, real automatic clock/source -> C1 Run/model -> Timeline+Monitor, zero model on forbidden conditions, dedupe/restart. No production bypass to enable tests.
6. Formal trellis-check after full C3 integration, fix findings; spec/index updates; full packages/typecheck/root lint/build/relevant Rust/native/process gates proportionately. Do NOT overlap timed Core full tests with native/cargo jobs. Root lint independently known QQMM file should remain untouched unless directly caused.
7. Update C3/parent metadata/checklists and source/evidence checkpoint accurately; no C4 start or manual AC claims.
8. Poll/resume agent messages and finish handoffs; they own their current files. Full Desktop suite currently running at UI worker.

