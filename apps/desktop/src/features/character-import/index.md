# character-import/
The costume/import hooks (#18) the home window's costume page and the pet window's switch listener share. The panel
that used to host them retired with batch 4 — costume UI now lives in windows/home/pages/costume.
- use-character-import.ts — React import adapter with action-owned floating feedback and retained resource warnings/errors
- character-import-controller.ts — serialized archive reads/imports, early-refusal result clearing, client-generation guarded completion and unconfirmed-write diagnostics retained through reconnect
- use-costume-switch.ts — Pet-only manual switch owner: admits fresh metadata inside the cancellable attempt, commits current/last-costume and scene invalidation at attachment, and releases Home before bounded report sync
