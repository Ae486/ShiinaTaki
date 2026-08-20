# Design

## Problem

The Pet entry imports the operation wheel. The wheel imports `DEFAULT_PAGE_ID` from the Home page registry, which
eagerly imports every Home page component. The Perception page imports the Home navigation store, and the store reads
`DEFAULT_PAGE_ID` from the still-evaluating registry. Browser ESM correctly throws a temporal-dead-zone error.

## Decision

Introduce a small dependency-leaf module that owns only the default Home page id.

- `pages.ts` remains the sole ordered page registry and re-exports the default id to preserve current callers.
- `home-store.ts` imports the default id from the leaf and imports `PageId` as a type only.
- `wheel-items.ts` imports the default id from the leaf and imports `PageId` as a type only.
- No page-component module is reachable from the Pet entry merely to resolve the default id.

For renderer teardown, explicitly remove and destroy the attached Live2D model before destroying the Pixi Application.
This preserves the engine's requirement that its Automator can unregister from a live ticker. The scene disposer is
idempotent so React StrictMode cleanup, HMR, and normal window teardown share one safe path.

## Alternatives Rejected

### Duplicate the `"chat"` literal in the store

This is the smallest textual change but creates a second default-page authority and can drift from `pages.ts`.

### Convert all Home page components to lazy imports

This also breaks eager evaluation but changes Home loading behavior, requires Suspense handling, and is disproportionate
to the confirmed defect.

### Redesign the complete page registry

Splitting ids, metadata, icons, and components into a new registry architecture would exceed the bug-fix scope and risk
violating the established one-row page registration contract.

## Verification Strategy

1. Add a browser-entry regression at the closest available seam, or a dependency-boundary test if browser automation
   cannot be made deterministic inside the package test runner.
2. Run focused Home navigation and operation-wheel tests.
3. Run Desktop typecheck, lint, and tests.
4. Run the headless Edge `pet.html` feedback loop and assert that the React/Pixi canvas exists with no TDZ error.
5. Reload the real Tauri Pet WebView through CDP and assert one canvas, successful fallback resources, no teardown
   exception, and visible model pixels.
6. Restart the real Tauri Desktop and confirm that the Live2D model is visible.

## Risk

The navigation risk is preserving the public import surface and page-registry invariant while removing runtime
coupling. The renderer risk is double destruction or leaving an in-flight child attached. The leaf/re-export and
idempotent model-before-application teardown shapes are intentionally narrow and reversible.
