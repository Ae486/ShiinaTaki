# Runtime implementation checkpoint

Current owner: `/root/runtime_inbox`. Workspace `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. Implementation authorized; full task/native/human acceptance remains open.
The current status below supersedes unfinished TODOs in the retained historical milestone log.

## Current status (2026-10-25, stable for coordinator native validation)

- Recovered and preserved the actual predecessor child changes through 11:21:46Z in session
  `01a172b1-7368-7941-bf7b-d0a0401c25b9`, including post-checkpoint patches and successful tests.
- Completed Runtime slice: durable event/wait/actual-intent/action receipts, Stop suppression, no generic default expiry,
  source/unknown-effect boundaries, explicit atomic inbox reconciliation, continuous private source-order/body paging,
  real activity/native item references, authenticated methods and discoverable recovery targets.
- Migrations 061 and 062 append presentation and explicit resume identity to the exercised T4 058/060 lineage.
  Applied migrations were not rewritten. Main max 059 was inspected read-only; convergence remains out of scope.
- Lazy first foreground claim is integrated with the Context owner: bindings exist before SDK construction, only the
  first nonempty batch is claimed at a safe request boundary, and one immutable consumer remains per Attempt.
  Later events after that claim remain accepted for a subsequent handling opportunity.
- Primary speech witnesses require real committed text plus matching persisted program-owned event source sidecars.
  Early public preface without the late-delivered event attribution produces no event speech witness.
- Fixed the actual empty-primary-history idle SDK failure; its projection now carries an explicitly attributed Core
  control message, with no Timeline/Memory user row. Updated obsolete legacy-outbox and intrinsic-tool assertions
  without dropping selected-source or child/main Memory isolation checks.
- Explicit recovery captures fresh authority and links the new consumer/membership/operation key inside existing Run
  admission. Busy, unknown non-model effects and stale predecessor targets refuse; repeated accepted operations read
  the original result. Earlier action outputs remain private evidence and never become fresh action/publication grants.
- New seven-section spec: `.trellis/spec/backend/private-agent-inbox.md`; backend index linked. Folder indexes updated.
  Existing delegation/publication spec updates remain coordinator-owned; private-context spec remains Context-owned.

## Independent-review correction (2026-10-25, 22:32 local)

- Verified P2 from `research/final-runtime-review.md`: one transient idle admission failure left the Character refused,
  while production queue releases never reset it. Added actual SDK/SQLite regression; both pre-intent recovery cases
  initially failed with accepted events stranded, then passed after the repair.
- Chosen fix uses existing producer/lifecycle facts: new accepted work/addressed inputs, eligible interaction/final
  events and successful primary terminal commits provide Character-scoped fresh retry opportunities. Existing explicit
  `authorityChanged` remains supported. No main.ts hook, new timer, dependency or scheduling framework is required.
- Ordinary release hints remain non-retrying, including the failed attempt's own release. A genuine new opportunity
  arriving during capture is remembered. Once intent exists, durable membership preserves reconciliation while later
  unrelated eligible events can proceed; no fresh replay of the failed batch occurs. User-Stop-derived suppressed
  events and repeated idempotent inputs do not manufacture a retry opportunity.
- Compared alternatives: clearing refusals on every release risks a failure loop; a new timer/backoff introduces an
  unrequested scheduler policy. Existing new acceptance/success facts supply a precise, testable production trigger.
- Tests: `pnpm --filter @taki/core exec vitest run src/harness/subagent-inbox-retry.test.ts src/harness/subagent-inbox-recovery.test.ts src/harness/subagent-interactive.test.ts src/harness/subagent-service.test.ts src/harness/subagent-completion.test.ts src/db/subagent-inbox.test.ts src/db/subagent-repo.test.ts`
  passed 7 files / 59 tests (22:32 local). New tests cover no retry on repeated release, fresh work after failure,
  successful primary opportunity, and a real post-intent provider failure with a later event advancing independently.
- Core typecheck and scoped ESLint passed. A follow-up scoped ESLint run with the normal size rules also passed;
  no global rule change or size exception was needed for this repair.
- Repair preimages: `target/agent-delegation-runtime-preimages-20261025-retry-review/`. Updated exact source manifest
  includes the interaction collector, state port and new retry test. Source is stable for coordinator native rerun.

## Final checks actually run

Environment: Node `v24.18.0`, pnpm `10.22.0`, installed AI SDK `7.0.148`; isolated synthetic fixtures only.

```powershell
pnpm --filter @taki/core exec vitest run src/harness/subagent-inbox-recovery.test.ts src/db/subagent-conversation.test.ts src/db/subagent-inbox.test.ts src/db/subagent-repo.test.ts src/harness/subagent-service.test.ts src/harness/subagent-interactive.test.ts src/harness/subagent-recovery.test.ts src/harness/subagent-completion.test.ts src/harness/subagent-materials.test.ts src/server/methods/subagent-methods.test.ts src/harness/delegation-tools.test.ts src/db/migrations/058-agent-inbox.test.ts src/db/migrations/056-subagent-conversations.test.ts
# 13 files, 73 tests passed, 2026-10-25 21:50 local; 10.94 seconds.
pnpm --filter @taki/core typecheck
# Passed after lazy adapter/interface integration.
pnpm --filter @taki/shared typecheck
# Passed.
pnpm exec eslint packages/core/src/db/subagent-*.ts packages/core/src/db/run-message-repo.ts packages/core/src/db/run-linked-state.ts packages/core/src/db/migrations/058-agent-inbox*.ts packages/core/src/db/migrations/060-agent-conversation-order.ts packages/core/src/db/migrations/061-subagent-presentation.ts packages/core/src/db/migrations/062-subagent-inbox-resume.ts packages/core/src/harness/subagent-*.ts packages/core/src/agents/subagent-*.ts packages/core/src/server/methods/subagent-methods*.ts packages/shared/src/subagent-*.ts packages/shared/src/index.ts
# Passed, including existing size rules; no global rule/exemption change.
```

Context owner separately reported seven actual lazy/mixed primary tests passing, including an early-preface witness,
late first event at model steps 1/2, second later event remaining accepted, and private activity/transcript exclusion.
This is collaborator evidence, not an additional test run by this slice.

`git diff --check` reported a new blank EOF line in Context-owned `packages/core/src/agents/chat-agent.ts:337`, plus
ordinary CRLF normalization warnings. The coordinator was notified; no source changes during native freeze.
Root owns full-workspace lint/test/build and native validation. No paid provider calls, real-user database changes,
commit/push/reset/archive or main-worktree modifications were performed.

## Remaining acceptance and resolved S5 audit

- The coordinator's native/source-frozen run is in progress; no native/UI/human acceptance is claimed here.
- S5 timing hypothesis was reproduced after the coordinator lifted the native freeze: a real SDK completed-step
  callback exposed active canonical output before presentation references existed. Desktop confirmed fallback rows
  could coexist with live items until a later mapping. The new actual-SDK test first failed, then passed after the fix.
  Continuous conversation reads now withhold only active unmapped step output/interaction rows until all native rows
  have presentation sidecars; raw history/events remain unchanged. Public finish-step persists mappings then emits the
  existing changed invalidation immediately. Legacy/terminal fallback remains readable.
- `pnpm --filter @taki/core exec vitest run src/db/subagent-conversation.test.ts src/harness/subagent-interactive.test.ts src/server/methods/subagent-methods.test.ts`:
  3 files / 7 tests passed at 22:02 local. The regression proves the early callback exists and the mapped invalidation
  arrives while the Run remains active. Scoped ESLint of the four touched files passed; post-fix Core typecheck also passed.
- Publication-source lifetime integration, primary Memory proof and whole-task coverage remain coordinator gates.
  Native Hindsight, paid campaigns, T4/main migration convergence and human acceptance remain unpassed/out of scope.

## Changed source/test files in this resumed slice

The exact source hashes are in `research/runtime-source-manifest-20261025.json`. Preexisting predecessor implementation
files outside this list were retained and validated; they are not misreported as edits made by this resumed turn.

- `packages/core/src/db/run-linked-state.ts`
- `packages/core/src/db/subagent-conversation-repo.ts`
- `packages/core/src/db/subagent-conversation.test.ts`
- `packages/core/src/db/subagent-execution-repo.ts`
- `packages/core/src/db/subagent-inbox-repo.ts`
- `packages/core/src/db/subagent-inbox-recovery-repo.ts`
- `packages/core/src/db/subagent-input-repo.ts`
- `packages/core/src/db/subagent-speech-repo.ts`
- `packages/core/src/db/migrations/056-subagent-conversations.test.ts`
- `packages/core/src/db/migrations/058-agent-inbox.test.ts`
- `packages/core/src/db/migrations/061-subagent-presentation.ts`
- `packages/core/src/db/migrations/062-subagent-inbox-resume.ts`
- `packages/core/src/db/migrations/index-list.ts`
- `packages/core/src/harness/run-service.ts`
- `packages/core/src/harness/delegation-tools.test.ts`
- `packages/core/src/harness/subagent-activity.ts`
- `packages/core/src/harness/subagent-completion.test.ts`
- `packages/core/src/harness/subagent-execution.ts`
- `packages/core/src/harness/subagent-inbox-context.ts`
- `packages/core/src/harness/subagent-inbox-execution.ts`
- `packages/core/src/harness/subagent-inbox-recovery.test.ts`
- `packages/core/src/harness/subagent-materials.test.ts`
- `packages/core/src/harness/subagent-service.ts`
- `packages/core/src/server/methods/subagent-methods.ts`
- `packages/core/src/server/methods/subagent-methods.test.ts`
- `packages/shared/src/subagent-api-schema.ts`
- `packages/shared/src/subagent-conversation-schema.ts`
- `packages/shared/src/subagent-inbox-schema.ts`
- `packages/shared/src/index.ts`

Additional documentation: backend inbox spec/index; `packages/core/src/{agents,db,db/migrations,harness}/index.md`;
`packages/shared/src/index.md`; this checkpoint and its source manifest.

## Retained historical milestone log

# Runtime implementation checkpoint

Updated: 2026-10-25. Owner: `/root/runtime_inbox`, resumed after session
`01a17209-6722-75f3-a033-d93955391f91`. Production implementation is authorized by the PRD.

## Scope and coordination

- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- The global `.trellis/.current-task` still names the avatar task. The coordinator explicitly selected
  this task; do not overwrite another session's global pointer.
- Own S1/S2 delegation DB/schema/runtime/collector tools, actual primary inbox transcript association,
  and S3 generic task-expiry removal. Coordinator owns ChatAgent, turn recording/activity/context,
  direct-request integration and main wiring. Publication owner owns publication validity and delivery.
- Preserve the extensive dirty baseline and other collaborators' edits. No dependencies, paid calls,
  real-user DB changes, commit/push/reset/archive, context compaction or UI implementation in this slice.

## Recovery and actual changes

- Re-read PRD/design/implementation plan, interface review and curated context.
- Located previous runtime rollout; prior production edits still require recovery verification.
- Created migration 058 and Shared inbox/validity contracts; input storage now carries explicit `workValidity`,
  nullable legacy deadline and exact addressed request references. The migration rebuilds the three exact known
  private tables with their data/triggers/indexes/sequence intact, then adds event/consumer/action/wait/route tables.
- Extended the migration runner's exact schema object contract to known attached triggers; only a fully matched
  trigger on a replaced table bypasses the unknown incoming-reference refusal. Unknown references still refuse.
- Added conditional source-only deadline/currentness handling across child/legacy parent execution, removed
  lifetime from the model delegation tool, and added the publication owner's legacy/new acceptance union exports.
- Added paged pending-input reads for the context owner. Source-compatible internal lifetime remains optional;
  omitted generic lifetime creates until-cancelled validity and no Run deadline/timer.

## Verification

- Confirmed cwd, branch and worktree list.
- `pnpm --filter @taki/core exec vitest run src/db/subagent-repo.test.ts`: 35/35 passed (2026-10-25).
  This checks the existing finite-work repository baseline on fresh migration 058; new inbox/runtime tests pending.

## Next work

1. Recover previous rollout/preimages; read known current runtime/DB interfaces.
2. Send the coordinator an exact foreground inbox port and publication validity handoff.
3. Implement immutable accepted events, actual-intent delivered receipts, explicit action handling,
   waits/addressed replies/stop suppression, real primary private transcript association and migration.
4. Remove generic age expiry while retaining finite source validity and unknown-effect reconciliation.
5. Run focused SQLite/runtime checks and record commands, results and remaining integration gates here.

## Resumed implementation milestone (2026-10-25, 19:20 local)

- Recovered actual response_item custom_tool_call/input and tool outputs from runtime rollout `01a1723f-136d-7dc0-9994-78fa87ae48c5`; the earlier checkpoint omitted post-checkpoint event/inbox/interaction/recovery changes. Those changes are preserved.
- Saved actual owned preimages under `target/agent-delegation-runtime-preimages-20261025-resume/`. Verified T4 branch and read-only main registry through 059. Keep exercised 058; new T4 additions use 060. No production database opened.
- Added Shared continuous conversation/activity schemas, Core source-reference commit order and stop history, immutable accepted-event work frontier, authenticated conversation/activity RPCs, private real SDK activity producer/readback, and accepted-report deduplication.
- Repaired idle admission shape, intrinsic governance registrations, source frontier publication API, canonical delivery-state readback, explicit failure deferral, actual unknown-effect frontier gate, async accepted-event scheduling, addressed reply forwarding and foreground speech witness storage.
- Added model-facing compact control acknowledgements and bounded one-category inspection through existing exact self-history reader.
- `pnpm --filter @taki/core exec vitest run src/harness/subagent-service.test.ts src/server/methods/subagent-methods.test.ts src/db/subagent-repo.test.ts`: 39 passed, one obsolete legacy-outbox assertion failed; updated that assertion to require the new accepted event and no legacy replay.
- `pnpm --filter @taki/core exec vitest run src/harness/subagent-interactive.test.ts`: 3/3 passed. Actual SDK + SQLite covers async message/wait, answer-before-terminal race, Stop-derived suppression, user-latch protection, four-day same-work continuation and real private activity.
- Core typecheck previously reduced to two nullable legacy fixture deadline errors; both fixed. Fresh final typecheck/lint, migration/inbox atomicity/recovery/read pagination tests and adjusted legacy completion/material regressions remain in progress. UI/native acceptance remains coordinator-owned.

## Resumed verification milestone (2026-10-25, 21:23 local)

- Recovered predecessor actual patches/tool results through 11:21:46Z, including three SQLite inbox tests absent from its checkpoint. Current preimages are under `target/agent-delegation-runtime-preimages-20261025-current/`.
- Added immutable private presentation metadata in migration 061, exact visible-step batch references, authenticated long-body digest-fenced pages and selected-child activity unsubscribe. Existing ChatActivity producer supplies real item identities; no fabricated activity.
- `pnpm --filter @taki/core exec vitest run src/db/subagent-conversation.test.ts`: 2/2 passed (actual SDK/SQLite, split native pairs, stable item identities, newest/older/newer, cross-child cursor refusal, exact long Unicode body reconstruction).
- Replaced obsolete completion-outbox test expectations with explicit accepted/delivered/handled inbox checks, retaining actual selected-source and child/main Memory boundaries. This exposed and fixed a real idle empty-history SDK failure: the private handler now appends an explicitly attributed Core control input, as the legacy continuation did.
- `pnpm --filter @taki/core exec vitest run src/harness/subagent-completion.test.ts src/harness/subagent-materials.test.ts`: 8/8 passed. Earlier failure output retained in this session; it was not merely waived.
- Core typecheck passed before the latest test additions; final typecheck/scoped lint and migration/explicit-recovery checks remain.
- Coordinator independently challenged and approved explicit inbox recovery: fresh normal Run authority and atomic new-consumer linkage to the prior consumer, unchanged event/action receipts, no automatic reclaim, repeated operation readback, old completed actions only as evidence, unknown non-model Effects still refuse. Authenticated inspection must expose discoverable exact recovery targets. Implementation is in progress, not accepted.

## Recovery/migration milestone (2026-10-25, 21:36 local)

- Added migration 062 and explicit `subagent.inbox.recovery` / `subagent.inbox.resume` operator RPCs. New consumer + membership + immutable resume-operation link participate in the existing linked Run admission transaction. Historical delivery/action receipts never move or become fresh automatic events. Repeated RPC reads the original Run/consumer even after completion.
- Extended the existing RunLinkedAdmission / RunService mapping narrowly with trusted `agent-inbox` scope, after coordinator ownership handoff; existing child/legacy admission paths preserved.
- `pnpm --filter @taki/core exec vitest run src/harness/subagent-inbox-recovery.test.ts`: 2/2 passed (busy refusal, exact discoverable recovery target, actual SDK handling, repeated request no replay, injected link failure rolls Run/member/consumer inserts back).
- `pnpm --filter @taki/core exec vitest run src/db/migrations/058-agent-inbox.test.ts src/db/migrations/056-subagent-conversations.test.ts`: 7/7 passed (populated historical raw rows/receipts preserved, generic old age authority removed, eligible-only legacy bridge, no wake, unknown index and receipt failure rollback, fresh/reopen).
- Scoped lint found seven oversized cohesive functions in the resumed slice; extracted explicit acceptance/action/read/admission/settlement helpers rather than weakening limits. Current code is being rechecked after those focused refactors.
- Known integration gap communicated to coordinator: primary inbox capture currently happens once at Attempt start; mid-tool-loop arrivals wait for a later primary turn/idle opportunity. The immutable one-consumer-per-Attempt contract is preserved. Coordinator owns any lazy first-claim integration and source/Memory evidence.
- Remaining: unknown-effect and prior-action recovery regression, full focused Runtime tests, final scoped lint/typecheck, folder indexes/spec sync and coordinator-native acceptance. No full task acceptance claimed.
