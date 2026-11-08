## 1. Outcome

**DONE for P1-T implementation and required checks.** Per-tool whole-review verification is removed. Model-step, publication and failure-saving checks remain unchanged.

[Full report](G:/taki-codex-work/tmp-t/p1t-report.md) · [Exact patch](G:/taki-codex-work/tmp-t/p1t.patch)

## 2. Changes

Five files changed; pre-edit copies are under `G:/taki-codex-work/tmp-t/baseline/`.

- [Curator tools](H:/TakiAgent/packages/core/src/memory/hindsight/hindsight-policy-curator-tools.ts:56): retain liveness and closed/finished refusal; verify only the resolved record for assessment and Block update. Failure envelope unchanged.
- [Curator tests](H:/TakiAgent/packages/core/src/memory/hindsight/hindsight-policy-curator.test.ts:24): verification-cost regression across 15 assessment calls.
- [Lifetime tests](H:/TakiAgent/packages/core/src/memory/hindsight/hindsight-policy-curator-lifetime.test.ts:90): stale-input, submission, publication and late-callback coverage.
- [Folder index](H:/TakiAgent/packages/core/src/memory/hindsight/index.md:120): one description line.
- [Runtime contract](H:/TakiAgent/.trellis/spec/backend/hindsight-application-runtime.md:217): six curator-specific lines.

Exact delta: **175 additions, 5 deletions**, excluding inherited changes. [run G:/taki-codex-work/tmp-t/delta-manifest.json]

## 3. Evidence and checks run

Protections were mapped before editing:

| Failure mode | Remaining protection |
|---|---|
| Another record becomes stale mid-step | Full check rejects the next submission; that record’s save/publication checks refuse it. |
| Blocks change before `block_read` | Captured snapshot may return internally; the next production SDK submission is blocked. |
| Addressed record is stale | Assessment/Block update checks it before saving, including Block dependencies. |
| Saved proposal becomes stale | Existing publication checks and dispatched-command CAS/receipt recovery remain. |

[source packages/core/src/memory/hindsight/hindsight-policy-curator-execution.ts:35] [source packages/core/src/memory/hindsight/hindsight-policy-curator-targets.ts:122] [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:20]

**Red:** 15 assessment calls produced **675 native-head reads**, failing the expected count of 15. [run G:/taki-codex-work/tmp-t/red-cost.log]

**Green:** `vitest run hindsight-policy hindsight-memory-subsystem --pool=threads --maxWorkers=2` passed **5 files / 51 tests**. [run G:/taki-codex-work/tmp-t/green-policy-subsystem-final.log]

Core typecheck, scoped ESLint, scoped `git diff --check`, and patch reverse applicability check all passed. All used `TEMP=TMP=G:/taki-codex-work/tmp-t`. Exact commands are recorded in the full report.

Informational measurement of 15 assessment calls:

| | Before | After |
|---|---:|---:|
| Native-head reads | 675 | 15 |
| Wall time | 3,758.7 ms | 266.7 ms |

Both measurement runs eventually applied all 15 assessments. Timing excludes setup, pre-step validation and publication. [run G:/taki-codex-work/tmp-t/timing-before.json] [run G:/taki-codex-work/tmp-t/timing-after.json]

The first expanded test run hit Vitest’s five-second limit in the new cost test. Its fixture now stops after measuring tool execution; separate tests cover publication. No existing test expectations or production deadlines changed.

## 4. Trade-offs

Unrelated mid-step changes no longer immediately reject every tool. A current independent policy may still publish; affected records remain protected at their own boundaries.

Full pre-step verification and Block dependency checks retain their cost. These results establish reduced tool verification work, not a maximum event-loop delay. [inference]

## 5. Open items / UNKNOWN

- **UNKNOWN:** post-change Home key-status latency and journey `pending` success; the leader owns runtime validation.
- No Core, Native, PG, journey or external model was started. Owned fixtures closed and check processes exited.
- No separate `-o` destination was supplied; the report copy is linked above.
- No scoped implementation/check work remains unfinished.

## 6. Outside scope noticed

The supplied profile includes a **3,749 ms startup module-loader stall**, an exception to “every long stretch is inside the curator.” Template-selection and Bank/connection guard costs also remain visible. None were changed. [run G:/taki-codex-work/tmp-t/profile-stalls.log]

## 7. Follow-up

Extracted `assertCuratorReviewOpen(review)` into the targets module and reused it in `guarded` and `assertCuratorReviewInputs`. The liveness and closed/finished checks retain their order and error; no behavior change. [source packages/core/src/memory/hindsight/hindsight-policy-curator-targets.ts:122] [source packages/core/src/memory/hindsight/hindsight-policy-curator-tools.ts:81]

Reran with `TEMP=TMP=G:/taki-codex-work/tmp-t`:

- `pnpm --filter @taki/core exec vitest run hindsight-policy hindsight-memory-subsystem --pool=threads --maxWorkers=2`: **5 files / 51 tests passed**. [run G:/taki-codex-work/tmp-t/followup-vitest.log]
- `pnpm --filter @taki/core typecheck`, scoped ESLint on the four changed curator TypeScript files, and scoped `git diff --check`: **passed, exit 0**. [run G:/taki-codex-work/tmp-t/followup-typecheck.log] [run G:/taki-codex-work/tmp-t/followup-eslint.log] [run G:/taki-codex-work/tmp-t/followup-diff-check.log]

Refreshed `G:/taki-codex-work/tmp-t/p1t.patch` with the total owned delta, including this follow-up; pre-edit copies remain under `baseline/`. No service or journey was started.
