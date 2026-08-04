# character-import/
The costume/import hooks (#18) the home window's costume page and the pet window's switch listener share. The panel
that used to host them retired with batch 4 — costume UI now lives in windows/home/pages/costume.
- use-character-import.ts — file bytes → base64 → character.import (client passed in by the caller); surfaces the returned costumes + warnings
- use-costume-switch.ts — lists costumes renderable-first with availability + missing-pack union; a switch fetches the costume's ref resolution, reloads in the renderer, re-reports vocab via existing avatar.report; exposes switchingId + cancelSwitch (abort + release) with a ref-based re-entrancy guard. Pet-window only (it needs the live PetScene)
