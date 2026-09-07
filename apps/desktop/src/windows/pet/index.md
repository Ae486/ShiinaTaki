# windows/pet/
Transparent, borderless, always-on-top pet overlay window (#14/#15/#16).
- main.tsx — React root mounting <PetStage> into the transparent pet.html #root
- pet-stage.tsx — the ONLY React↔Pixi bridge; owns the Pet socket's single Approval modal and compact connection notice
- use-costume-switch-event.ts — the pet half of the costume seam: listens for pet:costume-switch / pet:costume-cancel from the home page, runs the existing switch path, and publishes a pet:costume-result for every phase INCLUDING the refusals that path drops silently (malformed payloads are dropped with a breadcrumb)
- costume-report.ts — pure classifier behind that hook: a settle becomes succeeded / failed(reason) / cancelled, and a command the switch path would drop gets a named refusal
- use-pet-scene.ts — owns the renderer scene's create→dispose lifecycle with bounded stage retries; surfaces the final error for pet-stage to render; reveals the window after boot settles (#18 extract)
- use-pet-drag.ts — 4px click-vs-drag dead-zone → startDragging(); fires onClick(x,y) on a PRIMARY-button click (the #16 seam)
- use-drag-release-guard.ts — ends the drag on a global release/cancel/blur the OS drag swallowed (split out of use-pet-drag)
- use-pet-click.ts — click precedence: every click plays its region reaction; body opening reveals the retained reply without resetting live activity
- use-core-connection.ts — publishes only restored fresh Pet generations into the window store; renderer lifetime keys the owner
- restore-pet-connection.ts — generation-guarded avatar report/subscription followed by shared read-only Chat activity restoration
- initial-costume-promotion.ts — scene-lifetime promotion controller; interrupted pre-commit work retries on a replacement generation while an attached costume stays latched
- use-initial-costume.ts — once connected, promotes the dev scene through the D61 whole-attempt and never reloads an already attached imported costume (#18)
- use-render-governor.ts — wires Tauri onFocusChanged + DOM visibilitychange into the render governor
- use-click-through.ts — one global-cursor poll (~31Hz, interval stopped while hidden) drives per-pixel click-through (toggle on change), gaze follow, AND the proximity reflex (#15/#16/D17); the window-origin IPC is cached and refreshed only on drag end / window moved / window resized / a ~2s TTL backstop, so an idle tick costs one IPC
- cursor-poll.ts — pure poll-economy decisions behind that hook: run-while-visible gate, origin-cache staleness (dirty flag + TTL backstop), and the physical→logical cursor transform; also owns the 32ms interval constant
- click-through-toggle.ts — pure toggle formula: ignore = !dragging && !buttonDown && !overUi && !opaque; also exports the keep-interactive attribute/selector overlays mark themselves with
