# Diagnose missing Live2D pet model

## Goal

Restore the Live2D pet overlay in T4 development by fixing the browser-ESM initialization failure that prevents the
Pet React root from mounting and the renderer teardown ordering defect exposed by React StrictMode. Preserve the
existing Home page registry contract and keep both fixes at their confirmed dependency/lifecycle boundaries.

## Confirmed Facts

- Core and Desktop start successfully and establish a WebSocket connection.
- The ignored Cubism 2/3 runtime files are present in the T4 worktree, hash-identical to the main workspace copies, and
  served with HTTP 200.
- The actual Pet fallback URL, `/spike-assets/arbeit/model.json`, and its `.moc` resource are served successfully.
- The standalone Live2D spike loads the same Cubism 2 model and passes load, motion, expression, parameter, and framing
  probes in Edge.
- `pet.html` leaves `#root` empty because module evaluation throws before `createRoot(...).render(...)`.
- The captured browser error is `Cannot access 'DEFAULT_PAGE_ID' before initialization` from
  `windows/home/home-store.ts`.
- The runtime cycle is `PetStage -> OperationWheel -> wheel-items -> home/pages -> PerceptionPage -> home-store ->
  home/pages`.
- Existing Vitest navigation and wheel tests pass, so they do not exercise the real browser ESM initialization order.
- After the cycle fix, a clean real-Tauri reload mounts two canvases. StrictMode disposes its first probe scene after a
  model attaches; `Application.destroy()` destroys the Pixi ticker before its Live2D child, so the child's Automator
  throws while unregistering from the already-destroyed ticker. The dead first canvas remains above the live second one.

## Requirements

- Break the runtime circular dependency without duplicating the Home page list or changing page behavior.
- Keep `windows/home/pages.ts` as the only Home page registry.
- Prevent the Pet operation wheel from importing all Home page components merely to obtain the default page id.
- Preserve `PageId`, `DEFAULT_PAGE_ID`, `isPageId`, Home navigation, and operation-wheel behavior.
- Add a regression check that fails when the Pet browser entry throws during module initialization.
- Destroy the attached Live2D model while the application ticker is still alive, remove the probe canvas, and make
  scene disposal idempotent.
- Maintain affected file headers and the nearest `index.md` documentation.

## Acceptance Criteria

- [x] Loading `http://localhost:1420/pet.html` mounts the React/Pixi canvas instead of leaving `#root` empty.
- [x] No `DEFAULT_PAGE_ID before initialization` error is emitted by the Pet or Home browser entry.
- [x] The Cubism 2 fallback model is visibly rendered in the Pet entry.
- [x] The real Tauri Pet window displays the Live2D character after Desktop restart.
- [x] A StrictMode development boot leaves exactly one Pet canvas and emits no renderer teardown exception.
- [x] Home opens on the default Chat page and navigation to Perception and Settings still works.
- [x] Operation-wheel shortcuts still open the intended Home page.
- [x] Focused regression tests, Desktop typecheck, lint, and the relevant Desktop test suite pass.

## Out of Scope

- Repairing unrelated Home page functionality beyond the initialization cycle.
- Changing the Live2D engine, model assets, Cubism runtime versions, or character-import lifecycle.
- Refactoring the complete Home page registry or operation wheel.
- Committing ignored model/runtime assets.

## Technical Notes

- Diagnostic evidence is recorded in `research/browser-esm-cycle.md`.
- Final runtime and automated evidence is recorded in `verification.md`.
