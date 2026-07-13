# windows/pet/
Transparent, borderless, always-on-top pet overlay window (#14).
- main.tsx — React root mounting <PetStage> into the transparent pet.html #root
- pet-stage.tsx — the ONLY React↔Pixi bridge: mounts the renderer scene, drives render tier, shows-after-paint
- use-pet-drag.ts — 4px click-vs-drag dead-zone → getCurrentWindow().startDragging()
- use-render-governor.ts — wires Tauri onFocusChanged + DOM visibilitychange into the render governor
