# windows/home/pages/costume/
The costume page, migrated out of the retired pet-window CharacterPanel: import a model archive and pick a costume.
The live PetScene exists only in the pet window, so a pick is COMMANDED there (pet:costume-switch) and the pet's
existing switch path stays the single executor and persister.
- costume-page.tsx — page root: import row + costume list (badges, disabled unrenderable rows, missing-pack notice)
- use-costume-page.ts — the page's ws/event touchpoint: character.costumes read + the pet-window switch command
- costume-view.ts — pure list model: renderable-first ordering, missing-motion badges, missing-pack union, initial highlight
