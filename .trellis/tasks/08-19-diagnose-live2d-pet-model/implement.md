# Implementation Plan

1. Add the default-page dependency leaf under `windows/home/` with the standard INPUT/OUTPUT/POS header.
2. Re-export the default id from `pages.ts`; keep the page registry and `PageId` derivation unchanged.
3. Redirect runtime consumers in `home-store.ts` and `features/operation-wheel/wheel-items.ts` to the leaf module, using
   type-only imports for `PageId`.
4. Add regression coverage for the Pet entry/import boundary and keep existing navigation/wheel assertions.
5. Update `windows/home/index.md` and any affected feature index entry.
6. Add a renderer lifecycle regression that reproduces the Live2D-after-ticker teardown failure.
7. Destroy the attached model before the Pixi Application and make scene disposal idempotent; update `renderer/index.md`.
8. Run focused tests, Desktop typecheck/lint/tests, headless browser verification, then restart Tauri for manual
   acceptance.
