# Phase 2 verification and checkpoint readiness

## Owner request and execution boundary

On 2026-11-11 the owner freed memory and authorized testing, result recording,
statistics, and an assessment of a main checkpoint followed by possible T4 baseline
alignment. Session `01a1ca07-857f-7ec2-9adb-11c14229c334` uses the existing
`08-09-memory-operations-ui` task in `H:/TakiAgent`, branch `main`, HEAD `ba5be72`.
Preserve the inherited dirty integration. No commit, merge, push, original-data
operation or task archive is part of this verification.

## Result and decision

The selected checks are complete. Seven typechecks/root lint passed; 6,131 tests
passed with the two already documented Core failures and two conditional skips.
The corrected connected journey passed all 24 steps. Both copied-instance replays
passed recall, one first-attempt backup, verification and cleanup.

A main **stage checkpoint** is appropriate, with these limits recorded. Complete
parent acceptance, a green repository suite and large-memory-scale performance
are not established. T4 alignment should follow as a separate isolated integration
increment after the checkpoint; the current combined baseline is unvalidated.

No production or colocated unit-test source was changed during verification. Changes made here
are the task harness, measurement filter and records. No Git lifecycle action was
performed. Native source identity is `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`;
T4 remains clean at `63faf8119be1747b685aacf43529d754626ab35c`.

## Reproducible evidence locations

- Serial TS gate: `G:/taki-codex-work/phase2-gate-20261111-bf8a/runner.ps1`,
  per-command `results.json`, package/shard Vitest JSON and logs. One worker and
  a 1,536 MiB Node heap, G: temporary paths. Its runner slot was released before
  the first stack start; [the gate report](phase2-validation-gate-20261111.md)
  records commands, baseline failures and fixture restoration.
- Complete controlled Home/Native/Core/PostgreSQL journey:
  `G:/taki-codex-work/phase2-validation-20261111/run-journey.ps1`.
- Stopped copied-instance replay:
  `G:/taki-codex-work/phase2-validation-20261111/run-replay.ps1`.
  Use the existing `--observe-maintenance` mode, including one backup attempt,
  matching the latest retained replay's observation mode.
- Both stack wrappers record command/exit/wall time and sample resources every
  five seconds. Sampling measures observed peaks, not instantaneous maxima.
- Read-only branch assessment:
  [main/T4 alignment](baseline-alignment-assessment-20261111.md).

## Harness correction before execution

The inherited journey still asserted migration head 060. Wave 3 requires 063.
The restart, captured manifest and immutable paired-restore assertions now
require the explicit phase-2 checkpoint 063. They remain independent assertions
instead of deriving the expected head from the same registry being tested.
The Home observer uses Shared's terminal-state list, which now includes waiting.
The three edited helpers passed `node --check`; before-state copies are retained
under `G:/taki-codex-work/phase2-validation-20261111/`.

## Automated gate and retained first failure

The [serial automated gate](phase2-validation-gate-20261111.md) is complete:
seven workspace typechecks and root lint exited 0. Unique final package results
are 6,131 passed, two previously recorded Core failures and two explicit skips
in 785 files. Core alone has 4,532 passes across eight shards, including D104's
25 service cases with migration 063 and the migration's preservation/rollback
tests. The sum of all attempted command wall times is 2,472.683 seconds.

The initial Host attempt failed on a missing historical fake-adapter path;
the supported override with a provenance-verified retained fixture passed all
87 applicable cases. The codec package's declared `--passWithNoTests` script
exited 0 with no tests, correcting the initial generic invocation. Both failed
attempts remain recorded. All 134 captured application/source hashes were
unchanged. No new failing product test was identified; this is not a green
whole-repository test claim.

The first journey, `2026-11-11T11-07-14.409Z` / `G:/taki-first-use-xwOsKt`, passed
nine steps, then stopped at Pending recovery. Its saved operation was a valid
D103 `waiting` with no error; the inherited task helper only retried the former
`HINDSIGHT_PENDING_REMAINS` error and falsely failed. The preceding injected
unreachable outcome correctly remained a real failure and preserved last success.
All owned services exited normally with no listeners or live children. Its
stopped generated PG instance and data are deliberately retained for diagnosis.
Native cold startup took 115.117 seconds, within the original 240-second budget;
the wrapper recorded 460.874 seconds including teardown.

The captured operation was replayed through the actual helper with controlled
dependencies: it failed before the harness correction and passed afterward; a genuine
unreachable outcome still fails. The helper now permits a new independent check
after waiting within its existing budget, still requiring final completion. Live
waiting assertions additionally preserve previous failure count and last success.
No production code changed. Replay script:
`G:/taki-codex-work/phase2-validation-20261111/check-waiting-recovery.mjs`.

## Connected results

The complete second journey, `2026-11-11T11-19-24.469Z` /
`G:/taki-first-use-3eeHxO`, passed **24/24 steps**, exit 0. Wrapper evidence is
under `G:/taki-codex-work/phase2-validation-20261111/journey-2/`; the complete
[result](first-use-runtime/results/2026-11-11T11-19-24.469Z/result.json) records
HEADs, changed-source/harness hashes, operations, step times and owned cleanup.

- The recovery step observed a real waiting attempt, no error, unchanged genuine
  failure history/last success, and a later independent completed attempt. The
  original Native write identity was preserved. The subsequent Core restart did
  not rewrite terminal operation rows.
- Home settings remain usable during a held real Native sync. Original Pending
  restart and automatic recovery passed. Selected v3 templates survived ordinary
  RETURN/REENTRY, capture, emergency Local restart and offline paired restore.
- Core's migration count/head is 63. The pair was captured and verified through
  actual operations, and its restored copy passed authenticated pre-writer proof.
- Four Core exits and Native exits were graceful; the owned PG instance stopped
  and its current registry/data were removed. No owned PID/listener remained;
  original Taki directory metadata and pre-run PG registry state were unchanged.

| Connected timing | Observed result |
| --- | ---: |
| Complete second wrapper, including startup/teardown | 1,696.585 s |
| Native startup | 41.415 s (first cold attempt: 115.117 s) |
| Interrupted write recovery, including waiting | 23.456 s |
| Held-sync Home interaction | 4.217 s |
| Original Pending restart/automatic recovery | 375.479 s |
| Healthy RETURN with Local recall/new retain | 306.528 s |
| REENTRY preserving Banks/templates | 412.052 s |
| Home capture/verify step 11 | 7.484 s |
| Second pair capture before takeover | 29.344 s |
| Offline paired restore/pre-writer verification | 47.039 s |

These are scenario wall times, not individual RPC/Native latencies. The primary
Native log records 3,560 request completions; separate restore-Native access is
outside that primary count. Model responses were controlled fixtures.

## Copied replay, statistics and scale correction

Both fresh clones passed exact recall, first-attempt capture and pair verification,
with original-source hashes unchanged and all owned services stopped. Their data
and stopped PG registrations are deliberately retained as owned evidence.

| Same observation mode | Latest reference, Nov 10 | Replay 1 | Measurement follow-up |
| --- | ---: | ---: | ---: |
| Root suffix | `DUunfJ` | `X1MlPY` | `VYyqCg` |
| Chat acknowledgement | 1.969 s | 1.980 s | 1.958 s |
| Complete chat/recall | 8.972 s | 8.507 s | 8.953 s |
| Post-chat fence settlement | 1.655 s | 1.698 s | 1.665 s |
| Longest observed event-loop delay | 419.5 ms | 406.2 ms | 399.4 ms |
| Native requests in observation / started after chat | 76 / 26 | 76 / 26 | 76 / 26 |
| First capture | 14.524 s | 14.504 s | 14.930 s |
| Pair verification | 2.070 s | 2.161 s | 2.142 s |

Replay 1's wrapper took 95.543 s. Raw results are
`G:/taki-post-reentry-X1MlPY/replay-result.json` and
`G:/taki-post-reentry-VYyqCg/replay-result.json`; corresponding wrappers/logs and
resource summaries are under the evidence root, with the latter in `replay-2/`.
The measurement follow-up wrapper took 97.993 s.
All use the existing `--observe-maintenance` mode. These samples show no severe
degradation of this fixture; their small differences do not establish a causal
speedup or D105's target-publication latency. That narrower live timing stays open.

**Scale correction:** the historical “1,690-source/large-library” label used the
number of entries in `replay-input.json.sourceBefore`: **1,690 filesystem hashes**
covering `core-data`, `credentials` and `pg-data`. It is not a count of memory
Sources. Replay 1's read-only Core projection census is 3 Banks, 3 directives,
8 documents, 68 memory units and 3 mental models (85 rows). These are Core
application projections, not an independent full Native census. Earlier rows
using “1,690-source” must be read with this correction. Real large-memory-scale
coarse/stress acceptance remains **unverified**; this run does not close it.

The first replay's resource filter omitted the hyphenated
`maintenance-native-launcher.py`; its Native component memory is unknown, not 0.
The filter was corrected and one short fresh-clone follow-up collected Native
samples while retaining the original passing result. No runtime behavior changed.

| Five-second working-set sampling | Full journey | Replay follow-up |
| --- | ---: | ---: |
| Core peak | 985 MiB | 517 MiB |
| Native peak (redirector + worker) | 2,001 MiB | 1,431 MiB |
| PG process-group peak | 680 MiB | 477 MiB |
| Home Chromium peak | 474 MiB | No Home in this replay |
| Harness peak | 494 MiB | 241 MiB |
| Lowest available physical memory | 4,229 MiB | 5,720 MiB |

Component maxima may occur at different times; PostgreSQL working sets can
include shared mappings. Do not add these peaks as a physical-memory minimum.
Samples can miss short peaks; inspector/resource observation also has overhead.
Owned data remains on G:, with no original-data or deployment operation.

## Checkpoint and alignment scope

`G:/taki-codex-work/phase2-validation-20261111/commit-scope.json` records the
pre-closeout manifest: 122 tracked changes and 44 untracked candidates, with no
staged files. Later record writes can change these counts. Ten generated browser
files from the two test-owned October task directories are separated as evidence,
not default commit candidates. Preserve them; no cleanup/stash/reset was used.
The stage commit must include required untracked migration 061/062/063, Shared
schemas and Core/Home helpers alongside tests/specs/indexes and current records.
A tracked-files-only commit would omit required runtime code.

The [independent alignment assessment](baseline-alignment-assessment-20261111.md)
verified a clean frozen T4, 95/30 unique commits since common ancestor `c3f8bc4`,
665 common changed paths and 249 conflict-marker paths in a read-only legacy text
preview. That preview excludes the main dirty tree and is not an actual `ort`
integration result. Numeric migration meanings diverge from 049; main reaches
063 and T4 072, while the current runners skip already-lower version numbers.
Governance revisions 3/1, historical Approval resolution, AI SDK locks and
Native/build wiring also need reconciliation.

Recommended next sequence: review the stage manifest and commit the integrated
main checkpoint, retain frozen T4, then prepare an isolated integration from that
checkpoint. Preserve recorded migrations and design guarded convergence beyond
both tails; validate fresh, main-lineage and T4-lineage databases plus combined
Host/governance/runtime/Home paths before updating either baseline. Native D97
release identity remains a separate prerequisite to publishing the Native tree.

The two unchanged Core failure identities remain in the gate report. True
large-memory scale, extended provider-process crash/fault cases, current real-model
quality, packaged Rust/Desktop and owner/manual/original-data acceptance remain
open. The overall parent task and later optimization/UX/stress scope are not
complete. A stage checkpoint preserves this tested state and those limits.

The prior independent wave-3 source review and main/T4 advisor assessment remain
available. An additional final independent evidence review was requested after
the runs, but the sub-agent provider returned HTTP 402 (budget pool exhausted)
before it could run. The leader completed result/cleanup/hash readback; no extra
independent final-review pass is claimed.

## Authorized main checkpoint continuation

After reviewing the completed results and alignment sequence, the owner explicitly
authorized committing the current main worktree. This authorizes the stage
checkpoint only; integration, push, archive and real-data rollout remain separate.
The pre-commit readback again matched all 134 validated application/source hashes.
The checkpoint includes the complete Shared/Core/Home changes, migrations 061-063,
tests, task harness, specifications and records. Ten generated browser files are
retained locally under narrowly ignored UUID run directories. The earlier no-Git
boundary describes the verification run; it is superseded for this approved commit.
The commit log supplies the final checkpoint identity, with a local receipt under
`G:/taki-codex-work/phase2-checkpoint-20261111/`.
