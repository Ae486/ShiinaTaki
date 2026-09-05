# Frontend Quality Guidelines

## Size and responsibility guard (same as backend TS)

Use a 300-line baseline and a relaxed 360-line review threshold for source files; function/hook/component <= 50 lines and
max 3 params remain strict; test files are exempt. The file threshold is a responsibility signal, not a formatting target:
do not compress readable code or create artificial splits to satisfy a number. Split when distinct concerns become coupled
or a file materially exceeds the relaxed threshold. Do not append to an existing file by default — distinct concern = new
colocated file.

## Performance rules (this window is ALWAYS ON — perf is a feature, not an optimization)

- Frame-rate governor in `renderer/stage.ts` is mandatory path for all rendering: full fps only while animating/interacting; drop to low fps when idle; pause rendering entirely under Privacy Pause "sleeping" and when the model is off-screen.
- No polling loops in React (`setInterval` for data is forbidden — data arrives via WS push).
- Re-render hygiene: narrow store selectors, `memo` only where a profile shows need, stable callback identities for renderer-bridge props.
- Assets: Live2D textures load through the Tauri asset protocol lazily per character; never import model assets into the JS bundle.

## Proprietary & copyrighted assets (Live2D runtimes, models)

- Acquisition is ALWAYS script-driven into git-ignored dirs (`scripts/vendor-live2d-runtimes.mjs` → `apps/desktop/public/vendor/live2d/`; models extract under `models/`). Never commit, never hotlink a CDN at runtime; verify with `git check-ignore` + `git status --porcelain` in the same change.
- Model assets are served in dev via a dev-only Vite middleware (`apply: "serve"`) from OUTSIDE `public/` — they must never be reachable by a production build. Runtime globals (`live2dcubismcore.min.js`, `live2d.min.js`) load as plain `<script>` tags before the module entry.
- Production packaging of the vendored runtimes is a Tauri-side concern (deferred-decisions **D18**, due at #14): anything proprietary sitting under `publicDir` gets copied into `dist/` by `vite build` — do not add more proprietary files there.

## File headers & folder index.md (mandatory)

Every production source file (`.ts`/`.tsx`) opens with a 3-6 line module-contract header; tests and generated code are exempt. Every directory under `src/` carries an `index.md` (one line per source file; colocated tests implied). Touch a folder → update its `index.md` in the same change. Headers are placement cards — never what/how narration; body comments stay why-only.

```tsx
/**
 * INPUT:  avatar state events from the ws store (thinking/working/sleeping)
 * OUTPUT: <PetStage> — PixiJS canvas host mounting the Live2D renderer
 * POS:    ui/renderer bridge — the ONLY component allowed to touch renderer/ APIs
 */
```

`index.md` per directory:
```md
# hooks/
- use-ws-client.ts — WS connection lifecycle + typed method calls
- use-avatar-state.ts — avatar state machine subscription
```

## Forbidden patterns

- React imports inside `renderer/` (framework-free zone).
- Direct `ws-client`/`invoke` calls from components (must go through hooks).
- Whole-store subscriptions; `useStore()` without selector.
- localStorage/sessionStorage for durable or authoritative state (state of record lives in the Agent Core); the only
  localStorage exception is the allow-listed, schema-validated, privacy-reviewed SWR cache in `state-management.md`.
- Opaque backgrounds on the pet overlay root (breaks transparency/click-through).

## Testing

- **vitest** + jsdom for hooks/stores logic; renderer state-machine gets pure unit tests (it's framework-free by design).
- Component tests only for behavior-rich pieces (approval dialog decisions, character import flow) — not snapshot noise.
- Manual smoke before handoff: `pnpm tauri dev`, verify transparency, click-through on empty regions, and bubble interaction.
