# S8-S10 combined production review — 2026-10-30

Later narrow follow-up: the [check-in presentation addendum](followup-review-checkin-presentation-20261030.md) records
the subsequently identified raw-system-snapshot attribution defect, its Desktop-only repair and fresh final checks.
The later [native temp-root repair](followup-review-native-temp-root-20261030.md) corrects two acceptance scripts to
honor the unchanged native fixture guard; it does not alter production behavior or claim native acceptance passed.
The [supplemental native UI sequencing addendum](followup-review-native-ui-sequencing-20261030.md) records the later
client-reconciliation/ACK-loss harness correction and its six-check native UI pass, with production-Core acceptance separate.
The final [exact-input feedback repair](followup-review-exact-input-feedback-20261030.md) fixes the stale current-state
warning subsequently identified in those screenshots; it changes production Desktop and requires refreshed Desktop gates.

## Conclusion and authority

The reviewed S8-S10 implementation preserves the original continuing-conversation design and its October 30 uniform
check-in contract. Two concrete presentation/model-guidance issues were repaired, the check-in specification was made
executable, and three missing boundary cases were added. No additional production defect was established in the reviewed
Runtime, Shared or Co-Watching paths. This is an independent scoped review, not completion of S11/S12 or human acceptance.

Work stayed in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `6b36d0d`. The global
`.current-task` still names `09-03-avatar-presentation-lab`; the coordinator explicitly assigned this existing October 25
task, and no pointer was changed. The original PRD requirements 1-14, design, implementation plan, curated check manifest,
maturity assessment, independent check-in advice including the final uniform Co-Watching addendum, S7a recheck and both
Core/Desktop follow-up reports were loaded. Historical memory supplied only worktree/ownership context, verified live.

Review followed `trellis-check`; repairs followed `trellis-before-dev`, and specification completion followed
`trellis-update-spec`. The Runtime manifest and Desktop handoff include untracked new files; the review did not treat the
old checkpoint's entire dirty diff as this follow-up. No other agent was spawned. No dependency, migration execution on
real data, credential/environment-file read, native/provider run, commit, push, reset or task close/archive occurred.

## Findings (fixed)

### F1 — Home attention discarded the actual decision and refusal explanation

- Files: `apps/desktop/src/features/subagents/subagent-attention.tsx:32`, `subagent-labels.ts:26`,
  `subagent-inbox-recovery.tsx:8`, corresponding test/index, and `.trellis/spec/frontend/home-window.md`.
- Evidence: `db/subagent-inbox-repo.ts` commits a `needs_user_input` action and its attention row together;
  `db/subagent-attention-repo.ts` returns the actual action note as `reason`. The Home component rendered only the kind's
  generic text. It also dropped the current reconciliation refusal, even when that refusal disabled its recovery action.
  Opening the child does not project the main consumer's decision note into the child's transcript.
- Reproduction: two new static-render assertions failed against the inherited component: the requested choice was absent,
  and `SUBAGENT_INBOX_UNCERTAIN_EFFECT` had no readable explanation. Existing three cases still passed.
- Repair: show the actual decision note as escaped persistent text with preserved line breaks; reuse the existing Chinese
  recovery vocabulary through `inboxRecoveryReason` in both surfaces. Generic Toasts still contain no private note/name/body.
  Existing exact-target, freshness, unknown-outcome, disabled action and reconnect behavior is unchanged.
- Result: the same assertions now pass, including HTML escaping and absence of internal refusal codes. This is static
  rendering/controller evidence; native layout and owner usability remain separate.

### F2 — delegate guidance did not distinguish final record-only policy from mandatory check-ins

- Files: `packages/core/src/agents/subagent-delegate-tool.ts:19`, its folder index.
- Evidence: the executable tool description said `record_only` retained the result without a new parent inference, while
  `subagent-work-boundary.ts` and `subagent-checkin-repo.ts` correctly create eligible check-in events for that same policy.
  A model selecting the policy should receive its actual semantics.
- Repair: qualify final-result inference and state that periodic check-ins independently reach the main inbox. No tool
  signature, authority or runtime behavior changed; no unrelated prompt tuning was performed.
- Consistency check: current message/inbox tool descriptions explicitly describe optional current-work resolution,
  unversioned ordinary messages, exact Continue/question targets, `continue=true` plus `replyToEventId`, `continue_child`,
  and direct-user-only waits/Stop. No stale instruction to read `controlVersion` before every ordinary message, or to use
  Continue only after parent interruption, remained. Stop's description correctly describes its own parent pause.

### F3 — delivered infrastructure specification lacked executable sections

- File: `.trellis/spec/backend/private-worker-checkin.md`.
- Repair: retain the delivered contracts while adding concrete method/payload signatures, an error matrix, good/base/bad
  cases, assertion-oriented test requirements and a wrong/correct boundary example. The seven required sections are now
  present. This records implemented behavior and does not change product decisions.

## Additional boundary evidence

- `harness/subagent-checkin.test.ts:40`: actual SDK + SQLite, generic `record_only`, N=1, a parent correction accepted by
  the finishing tool after task-model intent. Exactly one task step produces one eligible check-in. The factual snapshot
  reports one pending input; that input remains unconsumed until explicit continuation. The next real model request
  contains it, and final completion remains ineligible with `suppressionReason=record_only`.
- `co-watching/child-adapter.test.ts:82`: extend the existing actual-SDK/source fixture with an exact answer while the
  checkpoint producer is still active, before terminal callback. The existing source adapter reaches `ready`, preserves
  the same artifact path, has exactly two task calls and one check-in, and publishes no Timeline row during preparation.
- `co-watching/child-adapter.test.ts:138`: an actual governed `write_file` writes an invalid proposal, followed by natural
  final text on N=2. Existing owner validation yields `plan_invalid`/failed/nonvalidated evidence, no checkpoint and no
  public output. No extra final marker, eager file probe or task-model request was introduced.

These cases passed without Runtime/Co-Watching repair. They extend requirement coverage; they are not relabelled former
failures. Each touched source directory's existing index was synchronized.

## Whole-scope review map

| Original requirements / concern | Actual owners and conclusion |
| --- | --- |
| 1-3: main availability, durable accept/deliver/handle, interaction waits | `subagent-inbox-execution/context`, inbox/event repositories and linked terminal participant retain bounded background-lane admission, actual Effect delivery, immutable membership/action identity and answered-before-terminal waits. Fresh retry/contract/check-in suites exercise relevant changes. S7a's unchanged foreground/SDK privacy passes are prior evidence, not re-executed here. |
| 4-5: independent user Stop, validity and restart | `subagent-input-repo`, service continuation/currentness, scheduler, execution deadline and terminal suppression retain user-only latch clearing, genuine source expiry and unknown non-model Effect refusal. Fresh check-in tests recreate the service without resetting approvals or auto-running the child; source tests retain owner-yield and user Stop. Full process restart belongs to S11. |
| 6: bounded context and truthful pending input | `agent-attempt`, `run-message-store`, work boundary and summarizer wiring retain the actual-intent receipt and failure latch. Fresh N=50 test crosses pressure rollover with Utility Effects counted only in usage. New N-boundary test proves pending corrections are neither reported as consumed nor dropped. S7a raw-retention/recording-failure evidence was read, not claimed as a fresh rerun. |
| 7,14: compact actionable model interfaces | Message target resolves transactionally, explicit work stays explicit, strict control/question paths remain. Result/history/inbox model projections omit their selected canonical digest/receipt fields and page full bodies; canonical repositories remain intact. Fresh tests reconstruct a large Unicode result and check unchanged canonical evidence plus stable ordinary-message operation/work identity. Raw self-history/material retrieval intentionally remains exact. |
| 8-9: continuous child UI and read/control lifetimes | Existing conversation/controller/paging/activity owners remain; new Home attention mounts outside selected-page content. Read observation precedes acknowledged subscription; hidden/replaced generations retire reads, mutation identity is retained and reconnect does not replay actions. Fresh Desktop tests exercise controller races, explicit recovery and the repaired persistent note. Native Chat/IME/scroll/rendering acceptance remains S11/human work. No permanent-close behavior was added. |
| 10: source-owned record-only and privacy | Boundary's natural source completion defers to post-drain owner validation; immutable `checkInForRun` prevents checkpoint artifact validation even after early answer. Co-Watching preserves artifact/edit/source and final publication ownership. New tests cover invalid natural final and actual early answer. Source review retains separate private Run/inbox evidence and public Timeline/Memory/speech owners. |
| 11: N/K, unique steps and usage | Completed-step source/progress/event/wait participant uses real model Effect identity, counts empty outputs once and latches SQL failure. Ordered final/question/check-in precedence, exact early continuation, K=3 escalation and K=0, per-interval captured configuration, user-only reset and restart persistence pass fresh tests. Actual usage projection includes child Utility Effects and excludes parent consumers; missing/single-sided/in-flight usage remains null/incomplete. No local/UI fake counters are added. |
| 12: no idle child creation | Final work tool selection removes `delegate_subagent` before disclosure/SDK construction. `assembleTurnTools` binds the selected executable names through `bindExecutableToolSelection`; `extension-registry.extensionSelected` refuses indirect targets without selected mapped aliases. The only other production child creator is Co-Watching, whose control factory requires a genuine primary user entry/current operator and is absent from idle tool construction (`main.ts:519`). Fresh actual request test confirms child creation is absent and existing-child tools remain. |
| 13: retry and actionable stuck states | One timer sequence is 1s/5s/15s; fresh opportunities coalesce and exhausted state persists. Delivered membership never returns to the eligible pool. Fresh tests cover timer recovery, exhaustion, explicit retry, later events after delivered failure and one delivery. Home's four attention kinds preserve exact work/recovery identity; F1 supplies the missing actionable explanation. |
| Migration/config/template touch points | T4 063 adds counters/sidecars/attention only, preserves prior receipts and creates no execution/check-in. Fresh migration/reopen test and current fixture schemas pass. N/K flow from registry/config reader through `main.ts` and Shared into existing Settings, with K=0 and next-interval wording. No platform template/update generator is involved. T4/main convergence remains explicitly outside this review. |

## Verification

Environment: Windows/PowerShell, Node `v24.18.0`, pnpm `10.22.0`, installed AI SDK `7.0.148`, native `node:sqlite` and
locked workspace dependencies. All fixtures are isolated/synthetic; source/authority/browser/native adapters remain
fixture-controlled even where SDK, governed file tools and repositories are actual production modules.

Evidence directory: [`target/followup-review-20261030`](../../../../target/followup-review-20261030/).
`owned-files.json` and `preimages/` identify every review-owned source/spec change and preserve the inherited dirty bytes.
`source-hashes.json` and one no-index patch per file describe only this review's delta; `worktree-status-before.txt`
includes untracked files. No preimage was restored over another collaborator's work.

| Command / scope | Fresh result and log |
| --- | --- |
| `pnpm --filter @taki/core typecheck` | PASS, including final test additions; `core-typecheck-final.log` |
| `pnpm --filter @taki/shared typecheck` | PASS; `shared-typecheck.log` |
| `pnpm --filter @taki/desktop typecheck` | PASS; `desktop-typecheck.log` |
| `pnpm exec eslint @lintFiles`, 58 exact paths saved in `lint-files.json` | PASS after final changes; `lint-final.log` |
| Initial attention reproduction, same test file | 2 FAIL / 3 PASS before repair; `attention-before.log` preserves the expected exit-1 failure |
| Desktop attention component/controller plus existing inbox controller | 3 files / 15 PASS; `desktop-focused.log` |
| Core check-in, follow-up contracts, retry, retry-timer, Co-Watching and migration 063 | 6 files / 27 PASS; `core-focused.log` |
| New generic record-only/pending-input and source-invalid-final cases | 2 PASS; `core-additional.log` |
| New source early-answer case | 1 PASS; `source-early-answer.log` |
| Final whole check-in + Co-Watching suites after test additions | 2 files / 18 PASS; `core-final-boundaries.log` (overlaps earlier passes; not an extra 18 distinct cases) |
| Shared subagent and progress schemas | 2 files / 6 PASS; `shared-focused.log` |
| `git diff --check -- <review-owned tracked paths>` | PASS, CRLF normalization notices only; `diff-check.log`. No-index patches/owned-file checks also include untracked changes without staging. |

The executed test commands use these exact package-relative selections:

```powershell
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-attention.test.tsx src/features/subagents/subagent-attention-controller.test.ts src/features/subagents/subagent-inbox-controller.test.ts --reporter=verbose
pnpm --filter @taki/core exec vitest run src/harness/subagent-checkin.test.ts src/harness/subagent-followup-contracts.test.ts src/harness/subagent-inbox-retry.test.ts src/harness/subagent-inbox-retry-timer.test.ts src/co-watching/child-adapter.test.ts src/db/migrations/063-subagent-progress.test.ts --maxWorkers=2 --reporter=verbose
pnpm --filter @taki/core exec vitest run src/harness/subagent-checkin.test.ts src/co-watching/child-adapter.test.ts -t 'generic record_only|invalid natural final' --reporter=verbose
pnpm --filter @taki/core exec vitest run src/co-watching/child-adapter.test.ts -t 'early answer=true' --reporter=verbose
pnpm --filter @taki/core exec vitest run src/harness/subagent-checkin.test.ts src/co-watching/child-adapter.test.ts --maxWorkers=2 --reporter=verbose
pnpm --filter @taki/shared exec vitest run src/subagent-schema.test.ts src/subagent-progress-schema.test.ts --reporter=verbose
```

## Findings (not fixed) and remaining acceptance

No additional independently verified in-scope production defect remains from this review. Source/fixture evidence does
not close the coordinator's frozen-source full workspace checks, real Core/authenticated WS/Home campaign, full-process
restart, actual WebView2 rendering/IME/scroll, goal-only production-provider campaign or owner acceptance. Source-loss,
unknown-effect and publication contracts were traced through their existing owners; this review did not fault-inject every
source retirement/publication race. Native Hindsight, T4/main migration convergence, retained-data cleanup and routed
background approvals retain their existing separate gates/deferrals. The acceptance owner's evolving native/E2E harness
was not audited as a completed production deliverable and was not edited.
