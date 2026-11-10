# windows/home/pages/costume/
The costume page, migrated out of the retired pet-window CharacterPanel: import a model archive and pick a costume.
The live PetScene exists only in the pet window, so a pick is COMMANDED there (pet:costume-switch) and the pet's
existing switch path stays the single executor and persister — but it REPORTS back (pet:costume-result) and this page
settles the command from that report. The current highlight comes from a correlated live Pet snapshot, never the
click, marker default or remembered selection (manual checks #74 / #75).
- costume-page.tsx — import controls/resource warnings plus retained costume list; transient import outcomes float, stable pending labels preserve geometry, and failed list reads keep retry
- costume-row.tsx — one picker row riding SelectionTile (aria-current), including the mid-switch shape: busy indicator + inline Cancel, while every other row stays clickable
- use-costume-page.ts — demand/visibility-aware cached costume reads with independent Pet switch/cancel/result/deadline ownership
- costume-scene-observer.ts — bounded correlated Pet read owner; changes/success/destroy/retirement discard stale replies and never invent a current costume
- use-costume-scene-observation.ts — visible-page native listener ordering and cleanup; requests actual Pet presentation independently of Core connectivity
- costume-result-deadline.ts — captures one Home window last-good deadline per command, independent of client-generation replacement
- costume-select-state.ts — pure switch lifecycle and live observation: a click marks pending, success requests observation, and every ending releases pending
- costume-view.ts — pure resource metadata: renderable-first ordering, missing-motion badges and missing-pack union; no worn-costume inference
