# stores/
Per-window Zustand stores (one store per domain; windows do not share JS memory).
- avatar-store.ts — mirrors the renderer avatar FSM state (idle/thinking/working/sleeping) for React display
- interaction-store.ts — shared `dragging` flag (drag hook writes, click-through poll reads) so a drag never drops through
