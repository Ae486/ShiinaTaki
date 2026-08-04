# features/operation-wheel/
Right-click shortcut wheel on the pet overlay: summoned at the cursor, every row opens the home window at one page (#26 batch 3/4).
- wheel-items.ts — THE row registry: adding a shortcut is one row (chat / settings / costume / home)
- operation-wheel.tsx — the radial wheel itself; keeps its own rect clickable via the keep-interactive marker
- wheel-placement.ts — pure geometry: summon point + window size → an on-window box position
- wheel-summon.ts — the pet-stage right-click rule (suppress native menu, open at the click point)
- wheel-dismiss.ts — framework-free dismissal policy: outside pointerdown / Escape / blur, never swallowing the event
- use-wheel-dismiss.ts — React lifecycle wrapper attaching those listeners only while the wheel is mounted
