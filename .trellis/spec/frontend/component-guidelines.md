# Component Guidelines

- Function components only; identifier PascalCase, file kebab-case (`chat-bubble.tsx` exports `ChatBubble`). One primary component per file; subcomponents get sibling files once they exceed ~30 lines or gain their own state.
- Props: explicit `type XProps = {...}` above the component (no `React.FC`). Max ~7 props — more is a signal to group into an object or split the component.
- No business logic in components: data flow is `ws-client`/`tauri` → store → hook → component. Components render and dispatch; that's all.
- Event handlers defined inside components stay under a few lines — anything more moves to the feature's hook.
- Tailwind 4 for styling; class lists longer than one line get extracted to a `cva`/helper or a subcomponent. No inline `style=` except for truly dynamic values (positions from the renderer).
- The pet overlay window must remain transparent: no opaque root backgrounds outside explicitly-rendered UI (bubbles, menus). Test any new overlay element against click-through hit-testing.
- Accessibility floor for the settings window: labelled inputs, keyboard navigation, focus states. (The pet overlay is exempt — it's a canvas.)
- Visual styling of panels/windows may temporarily reference BANDORI-PET-REV (`references/` — GPLv3: look & patterns only, NEVER copy code; clean-room per CLAUDE.md). The user restyles later — do not invest in bespoke visual design ahead of that.
