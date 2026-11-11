# Phase 2 wave 2b — Home policy review visibility

## Scope and baseline

Authorized UI implementation in `H:/TakiAgent`, `main`, HEAD `ba5be72`, with the
99 inherited dirty paths preserved. Home presentation/controllers and related
Settings labels only; no Core/Shared changes, Git writes, service start,
dependencies, original data or credentials. Current wave records supersede the
historical design's worker-isolation proposal.

## Failure cases established before implementation

- Missing review section, missing Bank row or null counts must remain unknown;
  a producer's null review state means idle and a measured zero remains zero.
- Pending, running, paused and error remain distinct. A saved result awaiting
  publication is separate from eligible work and from successful completion.
- A runtime outage may retain durable review evidence while replica evidence is
  absent; Home must preserve that review without offering unavailable sync controls.
- An in-flight refresh, failed re-read or disconnected client must identify its
  retained frame as the last read, and retired-generation reads must never replace
  current state.
- Review changes arriving mid-read must trigger one coalesced follow-up read.
- Catch-up identity persists after completion and across reconnect/reopen. It is
  historical evidence, not proof that the current pending occurrence is catch-up.
- The four live review knobs already exist in the generic metadata-driven Settings
  surface. Defaults must not acquire the stored/customized badge.

## Producer gaps reported to the leader

`PolicySchedule.save()` originally only saved its repository row, without a status
notification. Existing Home invalidation listens to operation/replica pushes;
review transitions need a producer invalidation on that existing chain. No frontend
polling will be introduced. Core's persistent `catchUpOccurrenceId` does not identify
the current pending occurrence, so Home will present it as a durable catch-up record
separately from the actual state.

## Delivery

Implemented the existing-style Home review presentation and related Settings
labels. No Core/Shared source or controller API was changed by this worker.

| Result | Source evidence |
| --- | --- |
| Per-Bank pending/running/paused/error and explicit null-state idle; missing rows/sections and null counts stay unknown, measured zero stays zero | `memory-policy-review-state.ts:19`; Shared `memory-policy-review-schema.ts:10` |
| Due-since, eligible remaining, saved-awaiting-publication and last completion are separate facts | `memory-policy-review-state.ts:22` |
| Persistent inline catch-up record remains after completion and across fresh reads; historical identity does not imply the current review is catch-up | `memory-policy-review-block.tsx:10`; `hindsight-policy-schedule.ts:153`; `hindsight-policy-review-repo.ts:58` |
| Review rows join by exact Bank id; review-only Banks survive unavailable replica evidence, with no replica controls | `memory-authority-state.ts:87`; `memory-authority-card.tsx:71` |
| Refresh, failed re-read and disconnected frames explicitly identify the retained last read and its observation time | `memory-authority-card.tsx:33` |
| Fresh fields travel with the complete authority-status response through the existing generation and coalescing owner | `use-memory-operations.ts:43`; `memory-operations-controller.ts:68`; `memory-operations-controller.ts:167` |
| Existing sync, settings, lifecycle, backup and admitted-sync Cancel controls remain | Existing authority card regression suite, 57 total affected tests |
| Four live review knobs already render via metadata; add Chinese labels/search terms only, with no duplicate form | `knob-registry.ts:206`; `settings-page.tsx:25`; `config-groups.ts:57`; `knob-field.tsx:34` |

References in the table are relative to their existing source directories:
Home Operations (`apps/desktop/src/windows/home/pages/operations`), Home Settings
(`apps/desktop/src/windows/home/pages/settings`), Core Hindsight
(`packages/core/src/memory/hindsight`), Core DB (`packages/core/src/db`), Core Config
(`packages/core/src/config`) and Shared (`packages/shared/src`).

### Files changed

- `apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx`
- `apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts`
- `apps/desktop/src/windows/home/pages/operations/memory-policy-review-state.ts` (new)
- `apps/desktop/src/windows/home/pages/operations/memory-policy-review-block.tsx` (new)
- `apps/desktop/src/windows/home/pages/operations/memory-authority-fixtures.ts`
- `apps/desktop/src/windows/home/pages/operations/memory-authority-card.test.tsx`
- `apps/desktop/src/windows/home/pages/operations/memory-authority-state.test.ts`
- `apps/desktop/src/windows/home/pages/operations/memory-operations-controller.test.ts`
- `apps/desktop/src/windows/home/pages/operations/index.md`
- `apps/desktop/src/windows/home/pages/settings/config-groups.ts`
- `apps/desktop/src/windows/home/pages/settings/config-groups.test.ts`
- `apps/desktop/src/windows/home/pages/settings/knob-field.test.tsx`
- `apps/desktop/src/windows/home/pages/settings/index.md`
- This report.

### Verification

Environment: Windows PowerShell, Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`, installed Vite/Chromium and Python
Playwright. All Node checks used `NODE_OPTIONS=--max-old-space-size=1536` and
`TEMP=TMP=G:/taki-codex-work/tmp-p2w2b-home`. Checks ran serially; no new dependencies
or Core/Native/PostgreSQL service was started. Browser fixtures were generated
entirely under G:, using synthetic non-secret Bank data and the production
`useMemoryOperations`/controller/card.

| Command / evidence | Actual result |
| --- | --- |
| `pnpm --filter @taki/desktop exec vitest run src/windows/home/pages/operations/memory-authority-card.test.tsx src/windows/home/pages/operations/memory-authority-state.test.ts src/windows/home/pages/operations/memory-operations-controller.test.ts src/windows/home/pages/settings/config-groups.test.ts src/windows/home/pages/settings/knob-field.test.tsx --pool=threads --maxWorkers=1` | 5 files, **57 tests passed**; `G:/taki-codex-work/tmp-p2w2b-home/focused-desktop-tests.log` |
| `pnpm --filter @taki/desktop typecheck` | **Passed**, exit 0; `desktop-typecheck.log` in the same artifact folder |
| Root `pnpm exec eslint` on all 11 owned TS/TSX paths above | **Passed**, exit 0 in the worker tool result; exact invocation in `validation-commands.ps1`. No output log was created because ESLint emitted no output. |
| `node G:/taki-codex-work/tmp-p2w2b-home/browser-fixture.mjs` | **13 browser scenarios passed**; 15 reads, zero mutations, zero page errors; `browser-result.json`, `browser.log` |
| `git diff --check -- apps/desktop/src/windows/home/pages/operations apps/desktop/src/windows/home/pages/settings` | **Passed** |

The browser harness, Python checks and exact `validation-commands.ps1` remain in
that G: folder for reproduction.
Chromium executable: `G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe`;
Python: `G:/anaconda3/python.exe`. The localhost Vite fixture closed after the run.

Browser cases cover missing evidence, all five states, real zero and both null
counts, separate saved publication, two pushes during one blocked read producing
exactly one follow-up read, marked disconnected last-good state with disabled
actions, fresh reconnect after completion, remount without duplicate notice,
historical catch-up identity alongside later pending work, and degraded review-only
Banks. Screenshots `home-pending-publication.png`, `home-completed-catch-up.png` and
`home-degraded-review.png` were visually inspected: existing layout/primitives render
the rows and notice without overlap, and sync/backup controls remain in place.

### Tradeoffs and remaining gates

- The Shared contract exposes a persistent historical catch-up identity, but no
  current pending occurrence id/reason. Presenting it as a historical record is
  truthful even after a later scheduled review. Home cannot prove that current work
  is catch-up solely from that identity; no such claim is made.
- When the runtime is down, only Core-provided review rows are added as review-only
  Bank sections. The lifecycle roster supplies a scope label when ids match; otherwise
  the actual Bank id remains visible. No unavailable sync evidence or action is
  invented.
- Settings reuse existing metadata-driven controls. Default values receive no
  `已自定义` badge; a stored row receives it only from Core's `stored` field. The four
  knobs remain in the existing Advanced group.
- These tests and browser runs prove the consumer's behavior when the existing
  replica invalidation arrives. The subsequent Core producer and actual registered
  WebSocket verification are recorded in `phase2-wave2b-notifications-20261111.md`;
  that increment closes the original missing-producer gap with controlled providers.
- Actual service/model concurrent review, provider-crash recovery, installed build
  behavior and owner UX/manual acceptance remain unperformed by this worker. The
  controlled browser run does not replace those gates.
- Suggested spec capture for the leader's consolidated update: the existing
  frontend reactive-read-model guidance should name review invalidation on the
  existing replica push, explicit last-read markers, and historical catch-up notice
  semantics. No new UI persistence, polling, timer or fake progress was added.
