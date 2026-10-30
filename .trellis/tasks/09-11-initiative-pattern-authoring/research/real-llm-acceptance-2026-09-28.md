# C3 real-model validation and follow-up fixes (2026-09-28)

## Scope and disposition

The owner approved real-provider validation and proportional fixes in the existing C3 task, then supplied
`H:/TakiAgent/.env.local` as the configuration source. All code, fixture data and evidence work stayed in
`H:/TakiAgent-worktrees/t4`; the main-worktree configuration was read only. No new task, C4 activation, commit,
push, archive or real-user database write was performed.

After three concrete fixes, both the first repaired batch and the final strengthened batch passed all eight
structural real-model scenarios. Final requests also prove the selected Character Memory marker is present and
the primary-history marker absent in every heartbeat request. This is bounded engineering evidence for one
configured model, not a general reliability or owner/manual acceptance claim. Residual prose issues are below.

This report extends [the earlier integrated C3 gate](implementation-evidence-2026-09-28.md). Its earlier local
scripted-provider results remain historical evidence; this extension contains actual external-provider calls.
The final full Core gate passed: 444 files, 3,627 tests passed and one existing skip in 636.82 seconds.

## Actual test path and isolation

- Provider/model: `api.deepseek.com`, `deepseek-v4-flash`; the key is passed only through the isolated child process
  environment. Existing model tuning is read from the supplied file (`TAKI_MAX_STEPS=20`); no credential is copied
  into evidence. Usage reporting is explicitly enabled for these tests.
- `initiative-pattern-real.e2e.test.ts` requires both real-provider configuration and
  `TAKI_E2E_REAL_INITIATIVE=1`. An independently checked flag-off run skipped all eight cases and made no calls.
- Each scenario starts the unmodified production Core entry with separate temporary SQLite/canonical-local Memory,
  synthetic Persona/Memory/history, ordinary operator RPC, real standard Skill installation and the actual SDK/model.
  Fixtures configure UTC and a short source polling interval; they do not inject a heartbeat Run or replace answers.
- Natural-language creation and management use actual primary chat. Candidate confirmation uses the operator RPC
  bound to the exact candidate revision. Heartbeat starts through the normal clock/policy source and C1 adapter.
- The loopback observer forwards original request/streamed response bodies, preserves backpressure and aborts
  disconnected work. Its stored diagnostics contain schema shapes, status, closed error categories and context
  booleans. Final fixture errors never retain upstream body text. Synthetic test replies are saved separately for
  semantic review. An initial diagnostic artifact retains the original bounded schema-error response as evidence.
- Simulated authenticated Avatar acknowledgements establish protocol completion only. No native rendering or human
  acceptance is inferred from those acknowledgements. Temporary processes/data are closed/removed independently
  even when an assertion or cleanup fails; the original failure is preserved.

## Failures exposed and repairs

| Finding | Original evidence | Final behavior |
| --- | --- | --- |
| User/host timezone mismatch | With User Timezone fixed to UTC and the host in Asia/Shanghai, primary instructions/current-time tools used host time. One real reminder explicitly chose host-local 09:00 despite the user's UTC request. | ChatAgent captures one authoritative User Timezone per attempt for both stable day and volatile time. `get_current_time` reads current authority per call. Main wires both ports lazily. The test now compares the stored reminder's exact UTC instant. |
| Provider rejects heartbeat schema | Both baseline heartbeat requests failed with HTTP 400 before a decision. Diagnostic reproduction identified an untyped root `oneOf` for `heartbeat_respond`. | A separate all-required, nullable strict object input validates outcome-specific fields and maps into the unchanged persisted decision union. SDK-rendered JSON Schema is tested. Existing candidate, outcome, presentation, currentness and conflict guards stay enforced. |
| Claimed candidate without saved candidate | One baseline authoring sample called the management tool but left zero Patterns while claiming a review card existed. Original arguments were not captured, so the exact failed action is not inferred. | Tool and standard Skill guidance require actual `propose` for a sufficiently specified creation request and an `applied`/`duplicate` result with a candidate before claiming the card. Listing/reading/history/prose cannot substitute for saving. Four subsequent lifecycle samples persisted the expected state throughout. |

The baseline also used invented relative wording about a revision being from "yesterday". Guidance now requires
actual returned dates for such claims; no such claim appeared in the repaired/final lifecycle samples.

The new wire shape was exercised against this configured compatible endpoint without enabling provider token-level
strict mode. Nullable support here does not prove universal strict-mode compatibility. Storage schemas/migrations and
the domain decision union were not changed for the provider workaround.

Regression details: [timezone evidence](real-llm-timezone-fix-2026-09-28.md),
[formal review](real-llm-formal-review-2026-09-28.md). Review also fixed observer privacy/streaming/cleanup and caught
a context-probe false positive: the project name appeared in both purpose and Memory. Final probes use distinct
Memory-only and history-only markers instead.

## Real batches and final scenario evidence

| Batch | Result | Evidence |
| --- | --- | --- |
| Initial smoke | 1 passed / 7 deselected; 31.93 s | `validation/real-llm-smoke.log`, `validation/real-llm-2026-09-28/` |
| Remaining baseline | 4 structural passes / 3 failures / 1 deselected; 435 s | `validation/real-llm-round1.log`, `validation/real-llm-round1-2026-09-28/`. One structural reminder pass was semantically wrong; it is not counted as correct UTC behavior. |
| Provider diagnosis | Reproduced heartbeat HTTP 400 once | `validation/real-llm-provider-diagnosis-2026-09-28/` |
| Repaired batch | 8/8 passed; 110.72 s | `validation/real-llm-round2.log`, `validation/real-llm-round2-2026-09-28/` |
| Final strengthened batch | 8/8 passed; 119.29 s | `validation/real-llm-final.log`, `validation/real-llm-final-2026-09-28/` |

Final semantic review read every saved final reply and decision, separately from the automatic assertions:

| Scenario, two samples each | Observed result and boundary |
| --- | --- |
| Creation and five-turn lifecycle | Real candidate stores daily 19:00–21:00, known presence, Character Memory only, silent/speak, 25% chance and 60-minute judgment gap. Exact confirmation activates it; a 90-minute revision leaves the accepted 60-minute version intact until confirmation; pause/resume persist; rollback creates a new pending 60-minute candidate while 90 remains accepted. No internal Pattern/revision binding appears in the saved explanations. |
| Unsupported fatigue/stress source | Both replies explicitly deny such detection and ask the user to choose supported observations/thresholds. No Pattern or Schedule was created. This establishes the clarification boundary in these samples, not that every explanatory sentence is accurate. |
| One-shot reminder | Both use `schedule_task`, create exactly one active one-shot Schedule and no Pattern. Both stored instants equal `2026-09-29T09:00:00.000Z`; replies explicitly say UTC. This tests scheduling, not tomorrow's actual delivery. |
| Automatic heartbeat | Both Runs complete with valid silent decisions; silence is allowed, including the all-outcomes sample. All four final heartbeat HTTP requests include the unique Character Memory marker and exclude the unique primary-history marker. No silence is fabricated from a failed/missing decision. |

The repaired batch also contains a real non-silent decision grounded in the seeded completed-index/upcoming-Friday
demo facts, with a `smile` expression. Its context probes were weaker than the final ones, so the strong request
isolation claim rests on the final batch. The final batch was not repeated merely to force speech.

### Residual prose issues, not hidden by the structural pass

- One revision explanation says speech is allowed and immediately includes a contradictory "do not speak" parenthesis;
  the stored definition and later readback correctly retain both silent and speak.
- Clarification sometimes describes foreground activity/dwell as time physically sitting continuously at the computer,
  and application matching as any program being open. The actual producer provides narrower accepted observations.
  These paraphrases do not establish sensing of posture, fatigue, all open applications or continuous human presence.
- Some lifecycle replies loosely say the habit will run after confirmation, without restating the separate disabled
  initiative master policy in these fixtures. Stored state and policy remain authoritative; confirmation alone does
  not enable the global switch or bypass shared quotas.

These are recorded language-quality limitations for subsequent authoring/owner acceptance. They did not create an
unsupported executable rule or override Core policy. Native trusted input, OS IME and subjective interaction quality
remain outside this real-process gate; manual acceptance boxes are deliberately unchanged.

## Usage accounting

`validation/real-llm-usage-summary-2026-09-28.json` aggregates all retained attempts, including failures, from actual
canonical `run_usage` rows. No synthetic zeros replace unknown usage and no currency estimate is inferred.

| Batch | Known input | Known output | Usage rows |
| --- | ---: | ---: | --- |
| Initial smoke | 218,990 | 4,103 | 14 reported |
| Remaining baseline | 154,141 | 7,867 | 11 reported, 2 unknown |
| Provider diagnosis | unknown | unknown | 1 unknown |
| Repaired batch | 591,081 | 12,326 | 39 reported |
| Final batch | 642,260 | 12,798 | 43 reported |
| Known subtotal | **1,606,472** | **37,094** | **107 reported, 3 unknown** |

The known total is 1,643,566 tokens, including 1,361,792 cache-read input tokens. Input already includes cache reads;
20,000 reported reasoning tokens are within output, not added again. Round 2/final observed 41/45 HTTP requests but
only 39/43 canonical usage rows. Those four additional requests have no canonical token attribution in the retained
evidence, and the baseline lacks HTTP observation entirely. These figures are known usage subtotals, not a complete
provider billing total. The three failed-provider unknown rows also remain unknown.

## Verification and source boundary

| Check | Result |
| --- | --- |
| Five-package typecheck | Passed; `validation/real-llm-typecheck-final.log`. |
| Root lint | Passed; `validation/real-llm-root-lint-final.log`. |
| Shared full suite | 65 files / 632 tests passed; `validation/real-llm-shared-final.log`. |
| C1/C2/C3 process regression and local observer | 3 files / 29 tests passed in 125.40 s: 20 production-process regressions plus 9 local HTTP regressions; `validation/real-llm-process-final.log`. |
| Core full final | 444 files / 3,627 passed / 1 existing skip in 636.82 s with one worker; `validation/real-llm-core-final.log`. |
| Scoped formal review | Production 34 and local HTTP 9 tests passed; schema/timezone/authoring/cleanup/privacy reviewed. |
| Existing Desktop/CLI/Rust gate | Source inventory confirms these source trees are unchanged by the extension. Prior Desktop 1165, CLI 50, Rust 205, Desktop build and final Clippy evidence remain in the integrated report; five-package typecheck was refreshed against changed Shared exports. |
| Task and whitespace | Curated context validation and `git diff --check` passed; 34 changed source/spec/report files passed UTF-8/no-BOM/trailing-whitespace validation. |
| Credential check | Final scan covered 67 research text/log/JSON artifacts with zero occurrences of the real provider key; `validation/real-llm-credential-check-final.json`. This is a credential-string check, not a general semantic privacy proof. |

`real-llm-source-at-final-gates-2026-09-28.json` uses the earlier inventory's source/config extensions: 2,207 files,
24 changed/new paths relative to the earlier C3 gate. HEAD remains
`06a8090118a45a8c4f06472be4917108f93aea44`; Git index is unchanged. Final reconciliation is recorded in
`real-llm-verified-source-2026-09-28.json`; all inventoried source/config/policy hashes remained unchanged during
the final Core gate. Task/report closeout edits are recorded separately from that executable inventory.

The owner's size-rule clarification is implemented: tests/fixtures have no file/function line caps; other lint
rules remain. Production keeps default limits with finite, responsibility-based documented exceptions. See
[size-rule evidence](size-rule-alignment-2026-09-28.md). This supersedes the earlier QQMM test-size lint limitation
without changing that unrelated script. The existing repository/installed QQMM lock discrepancy remains; no new
dependency, reinstall or frozen-lock rebuild is claimed.

## Reproduction and rollout

Run from the T4 worktree in PowerShell; the supplied configuration path is read-only and the evidence path contains
synthetic conversation content:

```powershell
$env:TAKI_E2E_REAL_ENV_FILE='H:/TakiAgent/.env.local'
$env:TAKI_E2E_REAL_INITIATIVE='1'
$env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/09-11-initiative-pattern-authoring/research/validation/real-llm-new-run'
pnpm --filter @taki/e2e exec vitest run src/initiative-pattern-real.e2e.test.ts
```

Ordinary regression commands require no paid credentials:

```text
pnpm -r typecheck
pnpm lint
pnpm --filter @taki/shared test
pnpm --filter @taki/core exec vitest run --maxWorkers=1
pnpm --filter @taki/e2e exec vitest run src/initiative-runtime.e2e.test.ts src/initiative-pattern.e2e.test.ts src/fixture/real-provider-observer.e2e.test.ts
```

The extension introduces no database migration, production configuration key or dependency. The original C3 rollout
and rollback boundaries still apply: operator-controlled setup/confirmation, separate initiative policy, retained
history and disablement instead of downgrading written schemas. Updated bundled Skill bytes use the existing exact
content/collision rules; an older installed same-name package is not silently overwritten. User installation or
replacement remains an explicit standard Skill lifecycle action.

The child remains `in_progress` with `meta.stage=real_model_verified`; manual acceptance is pending. C4 has not been
activated, and no commit/push/finish/archive action was performed.
