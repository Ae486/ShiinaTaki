# windows/pet/
Transparent, borderless, always-on-top pet overlay window (#14/#15/#16).
- main.tsx — React root mounting <PetStage> into the transparent pet.html #root
- pet-stage.tsx — the ONLY React↔Pixi bridge: mounts the renderer scene, drives render tier, wires drag/click/connection, mounts the bubble
- use-pet-drag.ts — 4px click-vs-drag dead-zone → startDragging(); fires onClick(x,y) on a click (the #16 seam)
- use-pet-click.ts — click precedence: every click plays its region reaction; a body click opens the bubble (#16)
- use-core-connection.ts — opens the operator WS, reports vocabulary, subscribes, applies avatar commands via the gate (#16)
- use-render-governor.ts — wires Tauri onFocusChanged + DOM visibilitychange into the render governor
- use-click-through.ts — one global-cursor poll drives per-pixel click-through (toggle on change) AND gaze follow (#15/#16)
- click-through-toggle.ts — pure toggle formula: ignore = !dragging && !buttonDown && !bubbleOpen && !opaque
