# prompt/ — System & Character Prompt Library

Single home for all injectable prompt content. Kept at the repo root (not buried in a package) so it's easy to find and edit. These are **data files, not code** — the Agent Core READS them at assembly time and injects them; nothing here is hardcoded into `.ts`.

## Layout

```
prompt/
├── system/                 # global, shared across ALL characters
│   └── assistant-layer.md  # assistant-capability personality (injected FIRST)
└── characters/             # per-character persona cards ("souls" — freely swappable)
    └── taki/
        └── persona.md      # 椎名立希 persona (injected AFTER the system layer)
```

## Injection order (assembled by the Core)

```
[ system/assistant-layer.md ]   ← establishes: capable assistant, tools are its body, help genuinely
        +
[ characters/<active>/persona.md ]  ← colors HOW (identity, tone, speech); never overrides "do the work"
        + emotion capsule / pinned memory / retrieved memory / intention (existing assembler sections)
```

The assistant layer is global (one file, every character shares it). The persona is per-character; the active character selects which `characters/<id>/persona.md` loads.

## These are the shipped defaults

`system/assistant-layer.md` + `characters/taki/persona.md` ship as the default experience for distribution/testing. At first run they seed the user-editable copies in the Workspace; users edit their copy, and升级 never clobbers customization.

## Settings-panel "soul-swap" (M5 #24)

The settings panel exposes a persona selector that lists every `characters/<id>/` here and lets the user pick which persona the active character uses — decoupling the visual model from the persona ("soul-swap": any persona on any model). The assistant layer is separately editable there too. Registered as D22 in `docs/deferred-decisions.md`.

## Conventions

- Persona speech-style examples (口头禅, reply samples, tone) are written in the character's spoken language (Chinese for taki) — living samples for the LLM to imitate. Structural/section notes stay English.
- One character = one `characters/<id>/` dir (future: `voice-clips/`, click-preset defaults, etc. colocate here).
- Editing a card changes behavior with no code change or rebuild (the Core re-reads on load).
