# Verification

## Real Tauri WebView2

The T4 Desktop was restarted with WebView2 CDP enabled and the actual `TakiAgent Pet` target at
`http://localhost:1420/pet.html` was reloaded after the fixes.

- React root mounted: 1 child.
- Canvas count: exactly 1.
- Canvas backing size: 720x960; CSS size: 480x640.
- Cubism 2 and Cubism Core runtime requests: HTTP 200.
- Fallback manifest, moc, both textures, physics, and idle motion requests: HTTP 200.
- No `DEFAULT_PAGE_ID` temporal-dead-zone exception.
- No `Ticker.remove` / `null.next` teardown exception.
- CDP screenshot visibly contains the `arbeit` Live2D character.

The connection notice read `authentication failed`; this is independent of renderer/model loading and is outside this
diagnostic task.

## Automated checks

```text
pnpm --filter @taki/desktop test -- src/renderer/pet-scene.test.ts \
  src/windows/home/navigation-boundary.test.ts \
  src/windows/home/home-navigation.test.ts \
  src/features/operation-wheel/wheel-items.test.ts
```

Result: 4 files, 18 tests passed.

```text
pnpm --filter @taki/desktop typecheck
pnpm lint
pnpm --filter @taki/desktop test
git diff --check
```

Result: typecheck passed; ESLint passed; Desktop 82 files / 421 tests passed; diff whitespace check passed.
