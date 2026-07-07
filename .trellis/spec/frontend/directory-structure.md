# Frontend Directory Structure

## `apps/desktop/src` (Pet UI)

```
apps/desktop/src/
├── windows/
│   ├── pet/               # pet overlay window entry (transparent, click-through)
│   │   ├── main.tsx
│   │   └── pet-stage.tsx  # PixiJS mount point — the ONLY React↔Pixi bridge component
│   ├── chat/              # full chat window: continuous timeline (ADR 0005), markdown, history
│   │   └── main.tsx
│   └── settings/          # settings window entry
│       └── main.tsx
├── features/              # feature folders: components + hooks + helpers colocated
│   ├── chat-bubble/
│   ├── approval-dialog/   # Permission Gate approval UI
│   ├── character-import/
│   └── settings-panel/
├── renderer/              # PixiJS + Live2D — NO React imports allowed here
│   ├── stage.ts           # Pixi Application lifecycle, frame-rate governor
│   ├── live2d/            # model loading, motions, expressions, hit areas
│   └── state-machine.ts   # idle/thinking/working/sleeping animation states
├── stores/                # Zustand stores (see state-management.md)
├── lib/
│   ├── ws-client.ts       # Agent Core WS client (uses @taki/shared types)
│   └── tauri.ts           # typed invoke() wrappers for Shell commands
└── components/            # small shared presentational components only
```

## Rules

- **`renderer/` is framework-free TypeScript.** React never reaches into Pixi objects directly; the bridge is `pet-stage.tsx` + store subscriptions. This keeps the render loop testable and the React tree cheap.
- Feature folders own their internals; cross-feature imports go through the feature's entry file. No barrels inside features — direct imports.
- Vite multi-entry: one HTML entry per window (`pet.html`, `settings.html`), configured in `vite.config.ts` + `tauri.conf.json`.
- Static assets for the UI live in `apps/desktop/public/`; user Live2D models do NOT — they load from the Workspace at runtime via Tauri asset protocol.
