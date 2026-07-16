# renderer/live2d/
Live2D model loading, idle behavior, and the avatar behavior surface using untitled-pixi-live2d-engine (locked #13). Framework-free.
- load-character-model.ts — loads + centers a model from a settings URL or CostumeSource (settings fetched → pruned → every kept sub-resource rewritten to its own absolute asset: URL) on the governed ticker (#18)
- settings-prune.ts — pure settings-JSON pruning (both generations): strips motion/expression entries with unresolvable refs so `..` never reaches the asset protocol; sound-only misses just lose the sound (#18)
- costume-switch.ts — load-before-teardown model reload for a new costume source; returns the re-read vocabulary the caller re-reports (#18)
- idle-behavior.ts — starts the looping idle motion group; degrades gracefully when none is defined
- model-vocabulary.ts — reads the model's motion/expression names (Cubism 2 `name` / Cubism 3 `Name`) for avatar.report (#16)
- avatar-commands.ts — applies an LLM avatar command (validate vs vocabulary; unknown → log + no-op) (#16)
- click-regions.ts — pure 7-region bucketing of a normalized model-local point (#16)
- emotion-resolver.ts — pure fuzzy tag→name resolver (exact/prefix/boundary + synonyms) against live vocabulary (#16)
- click-presets.ts — click-reaction preset DATA (taki=tsundere region→tag); presetForCharacter picks the default (#16)
- click-reactions.ts — normalizes a click, buckets a region, resolves the preset tag, plays the reaction (#16)
- gaze.ts — reach-clamped + delta-gated focus follow; createGazeFocuser → focusAt(x, y) (#16)
- avatar-controller.ts — bundles vocabulary + command apply + click reaction + gaze into one surface pet-scene exposes (#16)
