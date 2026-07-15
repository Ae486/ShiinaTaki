# character-import/
Minimal operator affordance for #18: import a .zip/.zst model into the Workspace + switch the active character's costume live (NOT the polished M5 roster). Components reach ws-client/scene only through the hooks.
- character-panel.tsx — the operator panel: import row + costume dropdown; presentational, over the transparent overlay
- use-character-import.ts — file bytes → base64 → character.import; surfaces the returned costumes + warnings
- use-costume-switch.ts — lists costumes + switches live (renderer reload → re-report vocab via existing avatar.report)
