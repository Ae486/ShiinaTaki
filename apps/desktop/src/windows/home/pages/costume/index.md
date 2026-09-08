# windows/home/pages/costume/
The costume page, migrated out of the retired pet-window CharacterPanel: import a model archive and pick a costume.
The live PetScene exists only in the pet window, so a pick is COMMANDED there (pet:costume-switch) and the pet's
existing switch path stays the single executor and persister — but it REPORTS back (pet:costume-result) and this page
believes that report, never the click (manual checks #74 / #75).
- costume-page.tsx — import controls/resource warnings plus retained costume list; transient import outcomes float, stable pending labels preserve geometry, and failed list reads keep retry
- costume-row.tsx — one picker row riding SelectionTile (aria-current), including the mid-switch shape: busy indicator + inline Cancel, while every other row stays clickable
- use-costume-page.ts — demand/visibility-aware cached costume reads with independent Pet switch/cancel/result/deadline ownership
- costume-result-deadline.ts — captures one Home window last-good deadline per command, independent of client-generation replacement
- costume-select-state.ts — pure switch lifecycle: a click only marks the row pending, a result moves the selection, and every ending releases pending so the next click works
- costume-view.ts — pure list model: renderable-first ordering, missing-motion badges, missing-pack union, initial highlight
