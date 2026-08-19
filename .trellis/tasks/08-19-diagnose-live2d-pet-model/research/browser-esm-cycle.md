# Browser ESM Cycle Diagnosis

## Reproduction

The T4 Core and Desktop were restarted from clean process trees. Core listened on `127.0.0.1:8974`, Desktop connected,
and Vite listened on `localhost:1420`. The Pet remained blank.

The actual Pet asset URLs were then checked:

- `/vendor/live2d/live2d.min.js`: HTTP 200
- `/vendor/live2d/live2dcubismcore.min.js`: HTTP 200
- `/spike-assets/arbeit/model.json`: HTTP 200, `application/json`
- `/spike-assets/arbeit/data/model.moc`: HTTP 200, `application/octet-stream`

The previously checked `/models/extracted/taki/arbeit/model.json` URL was not valid evidence: Vite returned its HTML
fallback with HTTP 200 and `text/html`.

## Differential Probe

The repository's standalone `spike.html` was executed in headless Edge against the same Vite server. The Cubism 2
`arbeit` model passed:

- model load
- motion start
- expression application
- legacy parameter round trip
- framing

This rules out the copied model, Cubism 2 runtime, PixiJS/Live2D engine combination, and Vite spike-asset middleware as
the cause of the blank Pet.

## Captured Failure

Headless Edge loaded `pet.html` with browser logging enabled. `#root` remained empty and the console reported:

```text
Uncaught ReferenceError: Cannot access 'DEFAULT_PAGE_ID' before initialization
source: src/windows/home/home-store.ts
```

The error occurs before `windows/pet/main.tsx` can mount `<PetStage>`, so no Pixi stage or Live2D model load is attempted.

## Import Cycle

```text
windows/pet/pet-stage.tsx
  -> features/operation-wheel/operation-wheel.tsx
  -> features/operation-wheel/wheel-items.ts
  -> windows/home/pages.ts
  -> windows/home/pages/perception/perception-page.tsx
  -> windows/home/home-store.ts
  -> windows/home/pages.ts
```

`pages.ts` has not initialized `DEFAULT_PAGE_ID` when `home-store.ts` reads it, so browser ESM temporal-dead-zone rules
throw. Vitest's existing navigation and wheel tests pass because they do not reproduce this browser entry evaluation
order.

## Recommended Boundary

Extract the default Home page id into a dependency-leaf module. Re-export it from `pages.ts` for API compatibility,
while `home-store.ts` and `wheel-items.ts` import the leaf directly. Keep `PageId` as a type-only import where needed.

This preserves `pages.ts` as the sole page registry, removes Home component evaluation from the Pet shortcut path, and
breaks the confirmed cycle without changing page behavior.
