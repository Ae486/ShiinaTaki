# core/characters/
- member-path.ts — THE single-sourced traversal guard; normalizes/confines every archive member + resource ref (reject-on-unsafe)
- import-error.ts — CharacterImportError: the typed hard-failure carrier (clean-room code) the layers throw + the method maps
- zst-archive.ts — clean-room `.zst` reader: node:zlib zstd streamed through tar-stream (PAX-safe) + index-member enumeration
- zip-archive.ts — generic-import zip reader: fflate unzip + the shared Zip-Slip guard on every entry
- cubism-manifest.ts — Cubism 2.1 vs 3-5 detection + validation (moc/textures hard, optional warn) + motion/expression name + file/sound ref extraction
- character-store.ts — Workspace characters/ R/W (single-writer, inv. 2); costume writes re-confined under the character dir
- character-import.ts — the import orchestrator: decode → parse → discover → resolve costumes → validate-all → extract → marker
- costume-availability.ts — on-demand renderable/missing availability + external-`../_mtn_emp/`-ref basename resolution over imported characters (#18 degrade-and-badge)
