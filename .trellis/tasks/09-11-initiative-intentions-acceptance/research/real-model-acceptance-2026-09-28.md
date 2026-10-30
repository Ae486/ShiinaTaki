# C4 real-model acceptance and C3 compatibility

## Scope and result

The existing owner authorization covers real-provider validation using `H:/TakiAgent/.env.local` read only.
The actual provider is `api.deepseek.com`, model `deepseek-v4-flash`. Each scenario starts the unmodified T4 Core
with isolated temporary SQLite/Memory and synthetic conversation data. Credentials enter only the child process
environment. No normal user profile is used and no model response is replaced by scripted content in these suites.

The first C4 batch passed two recall scenarios and failed both finite-plan terminal-state assertions. After a
production lifecycle fix and deterministic regression, all four C4 cases passed. A separate eight-case C3 real
compatibility suite then passed with the new plan tool installed. This is bounded structural evidence from one
configured model; owner usability, native appearance and general language reliability remain unaccepted.

## Actual paths and privacy probes

- `initiative-intention-real.e2e.test.ts` uses real primary chat to invoke the governed `plan_follow_up` tool. The
  user describes a finite consideration window, explicitly distinguishing follow-up from reminders and permanent
  habits. No Pattern or Scheduled Task is created. Ordinary master-policy enablement then permits the common Wake
  engine to admit one Heartbeat Run, with no injected dispatch or extra model loop.
- The finite examples use the real wall clock and normal budgets/cadence, verify exact stored bounds, one Run and
  actual transport disposition. They do not prove that the user saw/read the speech or that the underlying matter
  is resolved. Offline expiry and restart are separately proven by the deterministic production-process suite.
- Recall cases seed a canonical retrieved interview record before Core starts. Its outcome is explicitly unknown.
  A newly operator-authored and confirmed independent Pattern selects the topic. Its first model request does not
  include the record-only probe. Actual `recall({scope: "character"})` supplies it to a subsequent request, after
  which the model generates a fresh question. The test does not prepend a fabricated recall answer.
- Every autonomous request excludes a unique primary-history probe. Final C3 heartbeat requests also include the
  independently selected Character Memory probe. The observer forwards original provider bytes and retains only
  structural diagnostics and probe booleans. Saved replies are synthetic test content, reviewed separately below.
- A protocol Avatar acknowledgement, where used by the shared fixture, remains transport completion evidence.
  These process suites are not a native Pet or human-reading acceptance test.

## Real failure and repair

Both initial finite plans were correctly created and their one speech delivery reached `sent`. The Intention,
however, had already terminally closed as `unknown`. Production's committed-event observer reconciled at
`delivery.dispatch_committed`, before the asynchronous send result, using the same rule as restart recovery.

The fix retains the claim during a normal live `dispatch_committed` interval, then settles from the actual sender's
`sent` or `unknown`. On restart an unresolved dispatch still closes unknown and never replays or refunds the effect.
Three new regressions use real repositories, committed event bus, DeliveryCoordinator and deferred transport. They
failed before the fix; the final combined lifecycle/recovery/Wake run passed 52 tests. See
[formal review](formal-review-2026-09-28.md). The failed provider artifacts remain intact.

## Executed batches

| Batch | Result | Retained evidence |
| --- | --- | --- |
| C4 initial | 2 passed, 2 failed | `validation/real-llm-round1.log`, `validation/real-llm-round1-2026-09-28/` |
| C4 repaired | 4/4 passed, 64.96 seconds | `validation/real-llm-round2.log`, `validation/real-llm-round2-2026-09-28/` |
| C3 compatibility | 8/8 passed, 137.07 seconds | `validation/real-c3-compat.log`, `validation/real-c3-compat-2026-09-28/` |

The final C4 cases produced two exact finite plans, each terminally consumed as speech with one actual sent
delivery, and two independent recalled questions. The C3 suite exercised two complete five-turn authoring flows,
two unsupported-source clarifications, two exact tomorrow-09:00-UTC reminders and two automatic heartbeat decisions.
New zero-Intention assertions protect Pattern/reminder/clarification routing. One C3 heartbeat chose silence and
the other asked about the seeded Friday demo; silence was not replaced by forced speech.

## Semantic review and remaining wording limits

All repaired C4 and compatibility replies/decisions were read, not merely counted as passing assertions.

- The two recalled questions refer to the seeded interview and leave its outcome unknown; neither asserts success,
  failure or completion of the real-world matter. They do not quote the internal Memory probe or binding identifiers.
- Finite follow-up wording is imperfect: one asks whether the interview ended after the source already said it had.
  Two saved decision texts contain literal backslash-n formatting sequences. The structural transport test does not
  establish attractive rendering or eliminate repetitive/awkward model wording.
- The compatibility authoring flows correctly distinguish a pending revision from the current accepted version.
  One stale operation is explicitly refused and then retried against current state without dropping the new revision.
- Unsupported fatigue/stress requests create no rule or schedule and receive clarification. One reply still loosely
  describes application matching as a program being open; another describes available screen/activity sensing without
  emphasizing permission/source availability. The actual producer remains current accepted foreground observations,
  not all running programs, physical posture or subjective stress.
- Both reminder rows have the exact requested UTC instant. One reply omits restating UTC, so the row assertion is the
  time evidence; language alone is not used to infer it.
- The synthetic Persona's blunt tone and real interruption/noise quality require owner judgment. No response here
  marks those acceptance criteria passed.

## Actual usage

`validation/real-usage-summary-2026-09-28.json` totals canonical `run_usage` rows across all retained C4 attempts and
the C3 compatibility batch, including the failed attempts. It does not re-count the earlier independent C3 campaign.

| Batch | Known input | Known output | Reported usage rows | Observed HTTP requests |
| --- | ---: | ---: | ---: | ---: |
| C4 initial | 108,115 | 5,613 | 13 | 13 |
| C4 repaired | 103,479 | 6,507 | 12 | 12 |
| C3 compatibility | 698,213 | 15,563 | 43 | 46 |
| Known subtotal | **909,807** | **27,683** | **68** | **71** |

Known total: 937,490 tokens. Input already includes 751,616 reported cache-read tokens; output already includes
18,370 reported reasoning tokens. None of the 68 usage rows is unknown, but three additional observed requests lack
canonical token attribution. Their usage remains unknown, so this is not a complete provider billing total.

## Reproduction and disposition

From the T4 worktree, with an explicitly authorized real provider:

```powershell
$env:TAKI_E2E_REAL_ENV_FILE='H:/TakiAgent/.env.local'
$env:TAKI_E2E_REAL_INITIATIVE='1'
$env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/09-11-initiative-intentions-acceptance/research/validation/real-new-run'
pnpm --filter @taki/e2e exec vitest run src/initiative-intention-real.e2e.test.ts
pnpm --filter @taki/e2e exec vitest run src/initiative-pattern-real.e2e.test.ts
```

Ordinary scripted regressions require no paid key. The final integrated report owns package tests, build, native
fixture results, source hashes and the explicit pending owner acceptance. No commit, push, archive or installed
production deployment follows automatically from these real-provider passes.
