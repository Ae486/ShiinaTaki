# stores/
Per-window Zustand stores (one store per domain; windows do not share JS memory).
- avatar-store.ts — mirrors the renderer avatar FSM state (idle/thinking/working/sleeping) for React display
- interaction-store.ts — shared click-through-affecting flags: `dragging` (drag hook) + `bubbleOpen` (bubble hook); the click-through poll reads both
- connection-store.ts — the operator connection status (discriminated union) + the shared WsClient handle for consumer hooks (#16)
