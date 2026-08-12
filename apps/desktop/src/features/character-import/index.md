# character-import/
The costume/import hooks (#18) the home window's costume page and the pet window's switch listener share. The panel
that used to host them retired with batch 4 — costume UI now lives in windows/home/pages/costume.
- use-character-import.ts — file bytes → base64 → character.import (client passed in by the caller); surfaces the returned costumes + warnings
- use-costume-switch.ts — Pet-only manual switch owner: silently preserves last-good metadata when no imported character is available, blocks stale pre-render continuations, commits current/last-costume at attachment, and releases Home before bounded report sync
