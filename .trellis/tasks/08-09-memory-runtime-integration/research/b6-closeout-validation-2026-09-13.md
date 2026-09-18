# B6 Bounded Closeout Validation

## Scope and result

The owner approved the sequence B6 closeout, existing B7 design/grill and implementation, then D79-D83.
The bounded B6 closeout is implemented and verified. The temporary blanket observation refusal is removed;
ordinary observations again use their own exact binding, lifecycle, visibility, retention and mood rules.
The earlier foreground waiting, cancellation, lease, pinned-binding and Reflect-budget corrections remain intact.

This is not complete derived-policy propagation, whole-library model review, subjective owner acceptance, original
environment activation, B7 implementation, Git publication or task archival. The B6 task remains `in_progress` for
owner/manual disposition; the existing B7 task remains `planning`. Its design can proceed under the approved sequence.

## Exact workspace and implementation

- Taki: `H:/TakiAgent`, `main`, HEAD `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`.
- Native: `H:/hindsight`, `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Session task: `codex_01a07553-c738-75f0-93c4-bd8a7cd0b014` resolves to this existing B6 task.
- Core changes are confined to policy admission, runtime view, their directly affected tests and the Hindsight index.
  The original required-pin rebinding guard remains; a bound eligible observation no longer fails merely for its type.
- Native changes remove the experimental observation branch and fix the independently reproduced own-mood defect:
  null, empty or whitespace-only disclosure now refuses guarded Reflect, consistently with Core. Existing nonempty
  keyword matching, native callers without the hook, schemas and G1/D78 meanings are unchanged.
- New task-only closeout consumers use exclusive per-consumer evidence writes. Native mutation dispatch is counted
  before awaiting HTTP, independently of the historical response counter. A response timeout cannot prove no dispatch.

Final critical source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| Core `hindsight-policy-admission.ts` | `a8f76fc18de2ef8bd240e7954557b3844f01ed5c1cbab4b075c7e4ea58a896f6` |
| Core `hindsight-runtime-view.ts` | `5e5407b3f479bf064a5671ccbd8e34a2c42bafcc3ad9a8ec084aa61ceae169b9` |
| Native `application_state/read_admission.py` | `15d1c7671e0a690cacac53a8e3d703a51101f4213a0fd1b04df45b6e854ed295` |

## Automated verification and independent review

| Check | Actual result |
| --- | --- |
| Core observation policy/projection/runtime regressions | 200 passed across seven files. The old guard produced 25 expected failures in the restoration RED group. Three initially incorrect curator fixture assertions were aligned with the existing finish-without-assessment failure/retry contract. |
| Final complete Core suite | 3,055 tests in 373 files passed. |
| Workspace typecheck | All five workspace packages passed. |
| Lint | Core worker's final root `pnpm lint` passed; independent review also linted the five specified Core files successfully. |
| Final task consumer | Strict standalone TypeScript check passed; changed Python launchers passed Ruff and format checks. |
| Native ordinary-observation RED | Two positive cases failed under the old blanket guard; fixture `6b528674bcdb`. |
| Native storage/admission regression group | 31 passed in 122.93 seconds; fixture `cafc7a213213`, before the subsequent narrow mood correction. |
| Native own-mood RED | Null/empty/whitespace failed; three nonempty controls passed. Fixture `d41da0b229cd`. |
| Final native Reflect group | 16 passed in 77.66 seconds; fixture `0037265d7e4f`. |
| Actual HTTP to full Core and provider-only reconstruction | Passed before the mood correction (`796d8eabda20`) and again on the final source (`05be851c922d`, 39.67 seconds). |
| Native static checks | Four owned files passed Ruff, format and ty. The runtime fixture requires the existing G1 helper directory as a command-level extra search path. |

The native groups overlap and must not be added as distinct test totals. Existing `ReflectRequest.context`
deprecation warnings remain. Every model-free fixture reported `Stopped`, `DataRemoved` and `RegistryRemoved` true.
The unrelated whole-native auto-fixing hook/platform baseline limitations are unchanged and are not called green.
No endpoint/schema changed, so earlier generated-client gates remain historical evidence rather than being rerun.

Independent review found and resolved the own-mood discrepancy, dispatch-count timing, and overbroad curator
completion assertions. No remaining in-scope blocker was reported. Review did not reopen D81.

## Final actual-data and real-model run

Consumer: `api-b6-closeout-1`, under the already prepared private target
`.trellis/.runtime/d77-api-acceptance/ca744d0f8a27`. The stopped prior acceptance target and original user storage
remained read-only. The run used the production API reranker `Qwen/Qwen3-Reranker-4B`, the unchanged local embedding
index and the previously authorized model configuration.

Ordinary HTTP requests use 10,000 ms, with no generous pre-synchronization or whole-foreground business cutoff.
Reflect retains its 300-second operation allowance, process-only native base-four iteration setting and explicit
8,192-token completion request. Curator uses the normal 60-second timeout and normal 12-step ceiling, with the
existing acceptance sample cap of three records per Bank. It does not claim a full-default-size library benchmark.

| Scoped check | Actual result |
| --- | --- |
| Character original Recall target | Passed in 17.950 s; rank 2, 25 hits, including 11 observations. |
| Global original Recall target | Passed in 15.586 s; rank 2, 25 hits, including seven observations. |
| Direct hidden-record exclusion | Passed in 14.782 s: the hidden original was absent. Eleven observations remained eligible; the synthetic nickname was still present in derived content. That latter result remains D81, not a passing propagated-visibility test. |
| Automatic Recall | Passed in 8.108 s after 17.713 s of real Run capture; 1,353 characters, no Timeline append. |
| Grounded Reflect | Completed in 60.018 s, with 2,620 characters and 73 evidence memory IDs. Reported usage: 24,230 input and 1,702 output tokens. Subjective quality remains ungraded. |
| Curator bounded continuation | Passed the recovery/applied-progress contract described below. It did not complete every original memory's later assessment. |

All 1,614 observed HTTP responses were 200; the observation file is complete. There were 14 application commits
and zero native mutation dispatches from the consumer. HTTP success is not a substitute for policy or model assertions.

## Curator continuation: three different outcomes

The original unfinished cohort was read from the real copied SQLite journal: three policy attempts with saved prompts
but no saved model result, plus one Block attempt. The checks preserved their identities and command request IDs,
validated actual claim/revision progress, and reopened SQLite after each pass. No row, retry time, FIFO ordering or
model result was rewritten to help acceptance.

| Pass | Time | Newly assessed / actual applied proof | Producer status | Original work |
| --- | --- | --- | --- | --- |
| 1 | 60.102 s | Three | `failed`, four pending | Three old policy attempts were correctly completed as `assessment-failure`; the old Block remained queued. |
| 2 | 56.582 s | Five | `failed`, zero pending in this pass | The old Block became `superseded` after its source-policy revisions changed. All four original work records were terminal. |

The eight successful assessments each have a completed durable work record and an exact native head/current
application body matching the saved assessment result. User-owned Blocks were unchanged; the curator dispatched
no native mutation. One first-pass Utility Slot call has unknown usage, so no complete cost total is invented.

The three original memory policies still have `assessment.state=failed`, their original failed attempt evidence,
and actual retry timestamps. Their new application revisions join the normal due queue behind earlier work. They
were **not** relabelled assessed. `originalPoliciesAllAssessed=false`, `eventualCompletionProven=false` and
`wholeLibraryReviewed=false` are explicit in the result.

The passing closeout condition is original-work recovery **and** real, durably applied subsequent model progress.
The individual pass statuses remain `failed`; those historical failure/supersession outcomes are not erased.
This proves the existing bounded continuation mechanism, not guaranteed eventual success of every model assessment.

## Preservation and teardown

- The 2,779 recorded source/config/helper files matched before and after the run.
- All three original database files and all 1,612 prior-acceptance files remained byte-identical.
- Supervisor `10ec9b52272f436c887ae65d50eacb96` ended with `consumer_complete`, consumer/launcher exit 0.
- Consumer, HTTP, engine, background work and PostgreSQL all stopped; no forced termination, zero remaining Job members.
- The owned data copy and evidence remain preserved. No original Authority activation, commit, staging, push or archive occurred.

Private evidence includes `api-b6-closeout-1-source-fingerprint.json`, `*-summary.json`, `*-curator-summary.json`,
`*-http-observations.json`, `*-preservation-before.json`, `*-preservation-after.json`, the per-pass files, and the
per-supervisor completion record. Earlier failed attempts remain unchanged.

## Reproduction and next step

```powershell
pnpm --filter @taki/core exec vitest run --maxWorkers=2
pnpm typecheck
pnpm lint
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --allowImportingTsExtensions --skipLibCheck --strict .trellis/tasks/08-09-memory-runtime-integration/research/validation/d77-b6-closeout.ts
```

The native model-free entry is `research/validation/run_d77_runtime_validation.py`. The real-model entry is
`research/validation/run_d77_b6_closeout.py --root <the exact owned target>`, using the established supervisor and
an explicit fresh `api-b6-closeout-*` control identity. Do not reuse this completed identity or overwrite its evidence;
the stored cohort is historical and the copied queue has advanced.

Proceed to the existing B7 design/grill using [the source-based operations inventory](b7-existing-operations-foundation-2026-09-13.md).
D79-D83, subjective owner acceptance and original-environment activation retain their documented boundaries.
