# prompt/ — System & Character Prompt Library

Home for editable Companion and persona cards. The Agent Core reads these data files at assembly time. Runtime mechanics, role protocols and capability-dependent guidance have source-owned prompts listed below; this directory is not the only model entrypoint.

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
        + emotion capsule / memory blocks / pinned memory / intention (existing assembler sections)
```

The assistant layer is global (one file, every character shares it). The persona is per-character; the active character selects which `characters/<id>/persona.md` loads.

The diagram describes the editable memory/persona portion. The full primary request starts with the authority-selected base/Memory procedure, stable date/timezone, this portion and captured run instructions. `companion-task-guidance.ts` adds primary task guidance and capability choices only for tools exposed in the current step; private inbox instructions follow when present. Deferred Skill/MCP tools gain their associated guidance only after successful disclosure.

## Source-owned prompt map

| Audience | Owner | Contract |
| --- | --- | --- |
| Primary Companion | `packages/core/src/agents/base-prompt.ts`, `companion-task-guidance.ts`, `agent-attempt.ts` | Truthful results, source rules, active Memory procedure, task completion and actual capability membership. |
| Worker / private inbox / initiative | `packages/core/src/harness/` and `agents/initiative-context.ts` | Separate role input, result and publication contracts; no primary task module injection. |
| Tool and feature consumer | Tool descriptions, `integrations/taki-co-watching/`, `integrations/taki-media-recommendations/`, avatar vocabulary | Parameters, states and feature-specific choices appear beside the capability. |
| Utility / media / external summary producers | Their owning `memory/`, `agents/`, `co-watching/` modules and QQ summary producer | Independent model calls with bounded extraction, summary or preparation duties; editing the Companion card does not change them. |

See the [coverage and independent-entrypoint audit](../docs/PROMPT-AND-TOOL-OPTIMIZATION-2026-11-01.md#6-prompt-organization-and-coverage) for reviewed surfaces and intentionally unchanged contracts.

## These are the shipped defaults

`system/assistant-layer.md` + `characters/taki/persona.md` ship as the default experience for distribution/testing. At first run they seed the user-editable copies in the Workspace; users edit their copy, and升级 never clobbers customization.

## Settings-panel "soul-swap" (M5 #24)

The settings panel exposes a persona selector that lists every `characters/<id>/` here and lets the user pick which persona the active character uses — decoupling the visual model from the persona ("soul-swap": any persona on any model). The assistant layer is separately editable there too. Registered as D22 in `docs/deferred-decisions.md`.

## Conventions

- **Layer split (binding)**: mechanics + safety that must survive a user editing these files live in the code constant `BASE_SYSTEM_PROMPT` (what an `<untrusted-observation>` block is and that only those exact tags are trusted, what the two time lines are and never to work the time out from memory, anti-recitation, and the memory floors — search-first over impression, one search + say-you-checked, pin/fix/supersede/experience duties, card-wins). Behavior norms for the same surfaces live in `system/assistant-layer.md` (how to use what is noticed, time-of-day feel, memory weighting — reading memory is remembering, not looking up a database, emote norms). Persona cards carry neither — they color HOW, never WHETHER.
- Persona speech-style examples (口头禅, reply samples, tone) are written in the character's spoken language (Chinese for taki) — living samples for the LLM to imitate. Structural/section notes stay English.
- One character = one `characters/<id>/` dir (future: `voice-clips/`, click-preset defaults, etc. colocate here).
- Editing a card changes behavior with no code change or rebuild (the Core re-reads on load).
