# character-import/
Minimal operator affordance for #18: import a .zip/.zst model into the Workspace + switch the active character's costume live (NOT the polished M5 roster). Components reach ws-client/scene only through the hooks.
- character-panel.tsx — the operator panel: import row + costume list (missing-motion badges, disabled unrenderable rows under an import-packs notice); presentational, over the transparent overlay
- use-character-import.ts — file bytes → base64 → character.import; surfaces the returned costumes + warnings
- use-costume-switch.ts — lists costumes renderable-first with availability + missing-pack union; a switch fetches the costume's ref resolution, reloads in the renderer, re-reports vocab via existing avatar.report
