# windows/pet/
Transparent, borderless, always-on-top pet overlay window (#14/#15/#16).
- main.tsx — React root mounting <PetStage> into the transparent pet.html #root
- pet-stage.tsx — the ONLY React↔Pixi bridge: mounts the renderer scene, drives render tier, wires drag/click/connection, mounts the bubble, the right-click operation wheel + the costume panel the wheel opens
- use-pet-scene.ts — owns the renderer scene's create→dispose lifecycle with bounded stage retries; surfaces the final error for pet-stage to render; reveals the window after boot settles (#18 extract)
- use-pet-drag.ts — 4px click-vs-drag dead-zone → startDragging(); fires onClick(x,y) on a PRIMARY-button click (the #16 seam)
- use-drag-release-guard.ts — ends the drag on a global release/cancel/blur the OS drag swallowed (split out of use-pet-drag)
- use-pet-click.ts — click precedence: every click plays its region reaction; a body click opens the bubble (#16)
- use-core-connection.ts — opens the operator WS, reports vocabulary (+ drift self-heal re-report), subscribes, applies avatar commands via the gate (#16/1b)
- use-initial-costume.ts — once connected, promotes the scene from the dev model to the active character's imported default costume (#18)
- use-render-governor.ts — wires Tauri onFocusChanged + DOM visibilitychange into the render governor
- use-click-through.ts — one global-cursor poll drives per-pixel click-through (toggle on change), gaze follow, AND the proximity reflex (#15/#16/D17)
- click-through-toggle.ts — pure toggle formula: ignore = !dragging && !buttonDown && !overUi && !opaque; also exports the keep-interactive attribute/selector overlays mark themselves with
