# State Management

**Library: Zustand ^5** (chosen for footprint and no-provider ergonomics in a multi-window app).

## Where state lives (decision table)

| State | Home |
| --- | --- |
| State of record (sessions, memory, config) | Agent Core DB — the UI only caches |
| Cross-component UI state (connection status, active character, pending approvals, chat transcript cache) | Zustand stores in `src/stores/` |
| Animation state (idle/thinking/working/sleeping) | `renderer/state-machine.ts` — mirrored INTO a store for React display, driven by WS events |
| Single-component state (input drafts, open/closed) | `useState` in the component |
| Settings form values | Local form state; persisted via WS config API on save — never a local settings store of record |

## Rules

- One store per domain (`connection-store.ts`, `character-store.ts`, `approval-store.ts`), each under 150 lines. No single `app-store.ts` god store.
- Stores are created with `create<T>()(...)`; state shape typed explicitly; actions defined inside the store (components never `setState` on stores directly).
- Select narrowly: `useStore(s => s.status)`, never `useStore()` whole-store subscriptions in components.
- Each window (pet, settings) instantiates its own stores; cross-window sync goes through the Agent Core (WS events) or Tauri events — never assume shared JS memory between windows.
- No persistence middleware: durable state belongs to the Agent Core, not localStorage.
