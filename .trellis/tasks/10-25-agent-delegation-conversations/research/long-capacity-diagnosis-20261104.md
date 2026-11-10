# Long-worker summary capacity diagnosis — 2026-11-04

Scope: the owner-approved remaining long-task/eight-agent acceptance after `cd3cd91`. No provider call
was required for diagnosis. Existing unrelated work and original failed artifacts were preserved.

## Reproduction

The latest full long run is `target/agent-delegation-20261030-validation/real-long-global-deadline/
goals-long-audit-checkin-yWfwCu/`. It failed after 27 completed task steps and twelve summary revisions,
without a validated final. Its global deadline did not expire; source/evidence/cleanup checks passed.

`node --max-old-space-size=768 target/delegation-completion-20261104/diagnosis/replay.mjs` opens the
original SQLite database read-only, rejects database writes and model generation, and runs current
private-context projection against the retained failed boundary. Terminal liveness is bypassed only
for immutable historical pricing. Database and WAL hashes are unchanged before/after.

| Quantity | Estimated tokens |
| --- | ---: |
| Calibrated message budget | 9,240 |
| Summary revision 12 text, through sequence 113 | 7,502 |
| Summary plus its wrapper | 7,555 |
| Latest complete round, two exact history pages | 2,216 |
| Total request projection | 9,771 |

There are no pending inputs or older raw rounds left to retire. Current code reproduces
`SUBAGENT_CONTEXT_ROUND_UNFIT`. The historical and current source hashes differ; this replay establishes
that the current pre-repair code still has the capacity failure, not that all historical code is unchanged.

## Hypotheses and evidence

1. **Shrinking is accepted without capacity viability: confirmed.** The candidate passed the existing
   quality/shrink checks and committed before the next loop priced it with the protected round.
2. **A later calibration change caused the failure: refuted for this boundary.** Calibration was last
   updated at 15:33:16 UTC; the final summary request started at 15:42:44 and committed at 15:43:13.
3. **Target and dispatch pricing disagree: no supporting evidence here.** Captured request 66 asked for
   approximately 5,123 tokens. That matches current pricing: 80% of 9,240 minus the empty-summary wrapper
   and the 2,216-token protected round. The generated 7,502-token summary exceeded this soft target.

The protected history round fits by itself. Shrinking its pages or silently removing recent evidence
would address the symptom at the wrong boundary.

## Reviewed repair contract

- Before committing a candidate, price the actual candidate with fixed/pending context and the newest
  complete protected round. Optional older rounds may still retire progressively; existing intermediate
  summaries need not fit every older optional round immediately.
- A persisted summary that blocks an otherwise fitting protected request can be rewritten at the same
  coverage frontier. Append a new revision, keep `throughSeq`, bind the exact previous summary and use
  the existing owner/source/revision transaction guards. Do not consume old inputs again or change raw
  evidence. Ordinary empty-range captures still refuse.
- An otherwise valid, shrinking but oversized candidate gets at most one corrective generation with
  measured capacity feedback and the same captured sources. Do not commit unusable candidates to mint
  a new retry identity. Failure retains the old revision and uses the stable source failure identity.
- No model/thinking/output-limit, latest-round, history-page, task-step or check-in policy changes.

An independent Astra advisor challenged this contract before implementation. Core implementation and
SDK/SQLite regression results will be recorded separately; this diagnosis does not claim repair acceptance.

The implemented repair passed 50 focused tests, scoped lint and Core typecheck; see
`artifacts/delegation-completion-20261104/implementation/checks.md`. The repaired source replay is
`target/delegation-completion-20261104/diagnosis/replay-after.json`: identical 9,771/9,240 pricing now
reaches `PROBE_REWRITE_REQUIRED`, intercepted before generation or mutation. Database and WAL hashes
remain unchanged. This proves repair-path selection on the original failed snapshot, not real-model
summary quality. The original failing `replay.json` remains intact.

## Resource and validation plan

Use one implementation subagent, one Vitest worker and serial suites/scenarios. `NODE_OPTIONS=
--max-old-space-size=768` is inherited by the scenario Core; this is a heap limit, not a total RSS guarantee.
The existing transparent timing relay now supports a FIFO upstream cap of one, including correct queued
cancellation and nonblocking explicit gates. Actual peak concurrency is retained. Five local relay tests
passed after the new concurrency regression first failed against the old implementation.

Before real calls, record a fresh finite campaign budget. Retain the original 24-source long audit and
eight-event assertions, current source hashes and actual request/usage counts. Sample free system memory
and the fixture-owned Core PID during execution; stop only owned validation if resource headroom becomes
insufficient. Human UI acceptance remains the owner's separate final check.
