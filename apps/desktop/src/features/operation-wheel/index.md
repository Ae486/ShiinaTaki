# features/operation-wheel/
Right-click shortcut wheel on the pet overlay: summoned at the cursor, every row opens the home window at one page (#26 batch 3/4).
- wheel-items.ts — THE row registry: adding a shortcut is one row (chat / settings / costume / home), each with its glyph; default-page id comes from the Home dependency leaf
- operation-wheel.tsx — the radial wheel itself: icon+label chips on the ring; keeps its own rect clickable via the keep-interactive marker
- wheel-placement.ts — pure geometry: summon point + window size → an on-window box position
- wheel-summon.ts — the right-click rules: the pet-stage summon (suppress native menu, open at the click point) and the on-wheel suppression that stops a re-summon
- wheel-dismiss.ts — framework-free dismissal policy: outside pointerdown / Escape / blur, never swallowing the event
- use-wheel-dismiss.ts — React lifecycle wrapper attaching those listeners only while the wheel is mounted
