# Packaged Character import: frontend correction and checks

Date: 2026-11-10. Scope: the authorized packaged-desktop acceptance continuation.
The native-flow worker owns native selected-root/scope implementation and actual packaged
verification. This note records the frontend correction, without claiming native acceptance.

## Confirmed failures and correction

Native import wrote two costumes beneath the isolated Core's selected data directory.
The already-mounted Pet refused the first Home selection using its boot-time costume list.
After Pet reload, metadata succeeded, but the frontend requested the manifest under the
daily default `.takiagent` directory and received 404. Home also highlighted the imported
default despite the empty Pet because its list model treated default/remembered intent as
current presentation.

- `character-asset-url.ts` now invokes the no-argument native `local_characters_root` command.
  Settings and every model resource use that returned root. Failure remains failure; there
  is no fallback to the daily profile, frontend environment inference or renderer scope grant.
  A remote Core's metadata does not make remote files local or authorize arbitrary local paths.
- `costume-switch-attempt.ts` reads `character.costumes` inside its existing total-budget gate
  before resolution and path composition. The current response chooses the manifest and
  classifies unknown/unrenderable. Read failures stay distinct. Cancellation, deadline and
  supersession prevent late metadata from starting the renderer.
- The Pet hook no longer retains a second mount-time costume list, and the event admission
  gate only checks busy/scene readiness. Current-attempt metadata owns resource eligibility.
- Home resource rows no longer contain a presumed current costume. A visible Home reads the
  actual `PetScene.reportSnapshot()` through a correlated, bounded native-window exchange.
  Success and data-free scene changes retire old replies and reconcile; they do not directly
  assign the result payload as current. Unknown, empty and pending observations have no highlight.
- Pet listener readiness, scene replacement/reload and attachment notify the observer. Home
  also listens to the native Pet `tauri://destroyed` target, independent of React teardown.
  The observation does not require Core connectivity and adds no polling, persistent cache or
  Core authority. Hidden/disposed/registration-failed lifetimes clear current and release all
  registered or late-arriving listeners and request timers.

## Frontend files

- `apps/desktop/src/lib/character-asset-url.ts` and tests; `costume-switch-attempt.ts` and tests;
  new `costume-scene-event.ts`; lib index.
- `features/character-import/use-costume-switch.ts`, its tests and index.
- Pet `costume-report.ts` and tests, `use-costume-switch-event.ts`, `use-initial-costume.ts`,
  `pet-stage.tsx`, new `use-costume-scene-observer.ts`, and Pet index.
- Home Costume `costume-view.ts`, `costume-select-state.ts`, `use-costume-page.ts` and affected
  tests; new `costume-scene-observer.ts`/tests and `use-costume-scene-observation.ts`/tests;
  Costume index and the shared `resource-state-pages.test.tsx` metadata fixture.
- Frontend costume-operation, Home-window and reactive-read-model specifications.

Native files/configuration are owned by the native-flow worker. No Hindsight, real profile,
paid provider, commit, push or archive action was performed by this frontend correction.

## Verification

From `H:/TakiAgent-worktrees/t4`:

- Focused Vitest run: **14 files / 100 tests passed**. This included asset-root composition,
  metadata deadline/cancellation/supersession, unknown/unrenderable/read-failure distinction,
  existing commit/report behavior, initial promotion, Home rows/results/deadlines, observation
  correlation, missing Pet, destroyed Pet, and resource-page readiness.
- After the final listener-lifetime review correction: **2 files / 9 tests passed**
  (`costume-scene-observer.test.ts` and `use-costume-scene-observation.test.ts`). The new adapter
  case exercises observed A -> hide -> changed/empty Pet -> re-entry listener failure, proving
  no old highlight and exact-once cleanup for both partial and late listener registration.
- `pnpm --filter @taki/desktop typecheck` passed after the final change.
- Scoped root `pnpm exec eslint` passed for all changed frontend files; the final observer
  files/tests were rechecked after the lifetime correction.

These are deterministic frontend checks with native/window APIs substituted. The integration
owner runs the complete Desktop suite, and the native-flow worker rebuilds the current frontend
into the actual packaged app. First attach without reload, two real costume swaps, failed
replacement preservation, Home reopen/Pet reset, native scope denial and loaded-scene resource
measurements remain separate native evidence. Owner/manual acceptance remains unclaimed.
