# Diagnosis validation

Date: 2026-11-01. Environment: Windows PowerShell, Python 3.12.7, Node 24.18.0, installed AI SDK 7.0.148 and OpenAI-compatible adapter 3.0.75.

## Completed checks

- `analyze_runtime.py` completed against the actual read-only database. Its independent grouped queries agree with 288 usage rows, 263 cache/input pairs, weighted cache 68.4178%, no duplicate Effect usage, and no complete input-detail sum mismatch.
- Parent and independent advisor separately rechecked active-epoch missing user witnesses 3816/3838/3847, cursor 3812, 417 pending witnesses and 22 failed compaction operations / 26 failed attempts. The parent independently joined avatar result classifications, confirming 66 new empty-object validation errors and 18 retained normal `already_active` rejections.
- `probe_replay.mjs` completed with real current production replay/repository functions and read-only SQLite. Twelve fixed-calibration points produced eight adjacent first-message/window changes. It is an offline projection experiment, not exact historical provider replay or a billed-token measurement.
- Existing October 30 diagnostic request bodies were compared structurally: only `messages[0].content` differs; 15 messages and 30 schemas stay the same. Existing usage was extracted without copying conversation bodies or issuing new requests.
- Independent review found no numerical blocker. Its two required clarifications were incorporated: authoritative settlement failure remains fail-closed, and input origin cannot replace immutable completed-span proof. One-time backlog processing is separated from steady-state cost.
- `python ./.trellis/scripts/task.py validate 11-01-cache-token-cost-diagnosis` passed for the original six-entry manifests. After the owner's accepted simplification direction, both manifests contain seven entries, including the bounded scope review; the updated validation is recorded below. The oversized monolithic agent-runtime guide is linked through focused research and explicitly required for direct section reading before activation; no global injector limit was raised.
- Task-local UTF-8 without BOM, JSON/JSONL parsing, Markdown file links, conflict markers and trailing whitespace checks passed. `git diff --check -- .trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis` passed; the explicit file checks also cover new untracked artifacts that Git diff alone would omit.
- `task.py current --source` resolves this task through the current Codex session. `task.json.status` remains `planning`.

## Ownership and limits

All writes performed by this diagnosis are under `.trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis/`. The worktree began dirty and additional prompt/tool implementation appeared during the session. Those independent changes were neither reverted nor claimed as work by this diagnosis; their checkpoint is noted in the design. Production/full-project tests reported by that separate checkpoint are not validation performed here.

No production behavior/configuration, real database rows, historical evidence, Git commits, branches or publication were changed. No application-provider experiment, real-model effectiveness test, exhaustive API-account billing reconciliation, or owner manual acceptance was performed. The normal-use database ends on October 28; code, model aliases and tariff conditions may have changed afterward. Missing usage and absent exact historical request snapshots remain explicit limits, not zero values or invented causes.

Future implementation, exact historical data reconciliation and paid validation each retain their documented scope and approval boundary. Completed diagnosis checkboxes do not mark those future stages complete.

## Accepted-direction scope assessment

The owner approved simplification of source capture and memory/compaction coupling, then asked for implementation cost and change size. An independent advisor inspected the actual writer, Local/Hindsight consumers, scheduling, source readers and migration seams. The current PRD/design/implementation sequence records the accepted direction and the estimated batches; the old synchronous-flush repair recommendation is explicitly superseded. Current scope estimates do not represent implemented production changes, run tests, or confirmed monetary savings.

All writes in this assessment remain in this task directory. Current-source inspection and plan validation were performed; production suites, model calls, data migrations and historical repairs were not executed. The expected additive migration needs an implementation-time registry check rather than a reserved version number in planning.

Updated planning validation passed: seven entries in each context manifest without truncation warnings; all 18 task files passed UTF-8/BOM, JSON/JSONL, local-link, conflict-marker and whitespace checks. Task status remains `planning`.

## Implementation verification

The historical planning-only statements above describe that stage, not the current implementation status.
After the owner approved execution, source capture/recovery, consumer gap isolation and independent compaction
were implemented. Current checks, historical-preview boundaries and full-suite results are in
[implementation-report.md](implementation-report.md); the final independent review is in [final-review.md](final-review.md).
