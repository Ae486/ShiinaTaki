# Frontend Quality Guidelines

## Size caps (same as backend TS)

File <= 300 lines; function/hook/component <= 50 lines; max 3 params; test files exempt. Do not append to an existing file by default — distinct concern = new colocated file.

## Performance rules (this window is ALWAYS ON — perf is a feature, not an optimization)

- Frame-rate governor in `renderer/stage.ts` is mandatory path for all rendering: full fps only while animating/interacting; drop to low fps when idle; pause rendering entirely under Privacy Pause "sleeping" and when the model is off-screen.
- No polling loops in React (`setInterval` for data is forbidden — data arrives via WS push).
- Re-render hygiene: narrow store selectors, `memo` only where a profile shows need, stable callback identities for renderer-bridge props.
- Assets: Live2D textures load through the Tauri asset protocol lazily per character; never import model assets into the JS bundle.

## Forbidden patterns

- React imports inside `renderer/` (framework-free zone).
- Direct `ws-client`/`invoke` calls from components (must go through hooks).
- Whole-store subscriptions; `useStore()` without selector.
- localStorage/sessionStorage for durable state (state of record lives in the Agent Core).
- Opaque backgrounds on the pet overlay root (breaks transparency/click-through).

## Testing

- **vitest** + jsdom for hooks/stores logic; renderer state-machine gets pure unit tests (it's framework-free by design).
- Component tests only for behavior-rich pieces (approval dialog decisions, character import flow) — not snapshot noise.
- Manual smoke before handoff: `pnpm tauri dev`, verify transparency, click-through on empty regions, and bubble interaction.
