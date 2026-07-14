# Research: Persona Injection Refactor (Topic 4)

- **Query**: Replace the inline `PERSONA_PLACEHOLDER` in the assembler with disk reads of `prompt/system/assistant-layer.md` + `prompt/characters/<id>/persona.md`
- **Scope**: internal
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `packages/core/src/memory/assembler.ts` | Holds `PERSONA_PLACEHOLDER`; builds the `sections` array |
| `packages/core/src/memory/memory-engine.ts` | Wires `createAssembler({ repo, retriever })` — the injection point |
| `packages/core/src/config/server-config.ts` | Boot config (dataDir, OS-neutral paths) — where a prompt-dir knob fits |
| `prompt/system/assistant-layer.md` | The global assistant layer (inject FIRST) — already written |
| `prompt/characters/taki/persona.md` | The taki persona (inject AFTER) — already written |
| `prompt/README.md` | Injection order + "seed Workspace copies at first run" convention |

### How sections assemble today

`assembler.ts:44-63` (`assemble` is **synchronous**, returns a string):
```ts
const sections = [PERSONA_PLACEHOLDER, EMOTION_CAPSULE];      // :47
// ... pushes pinned / retrieved / intention blocks ...
return sections.join("\n\n");                                  // :62
```
- `PERSONA_PLACEHOLDER = "You are the user's companion. (Persona card pending — #16.)"`
  (`assembler.ts:14`).
- `EMOTION_CAPSULE = "Current mood: neutral."` (`assembler.ts:15`) — **stays** (decision 3a; the
  static capsule is deferred D9, not part of #16).
- `assemble` already receives `characterId` (`AssembleParams`, `assembler.ts:29-35`).

### The change

Replace the `PERSONA_PLACEHOLDER` element with the two on-disk cards, assistant layer FIRST then
persona (order fixed by `prompt/README.md:19-22`):
```ts
const sections = [assistantLayer, persona, EMOTION_CAPSULE];
```
where `assistantLayer` is global and `persona` is `persona.get(characterId)`.

Inject a **persona provider** dependency into `createAssembler`, wired in `memory-engine.ts:39`
(currently `const assembler = createAssembler({ repo, retriever });`). This mirrors how the store
injects its fs boundary and keeps the assembler testable (a test passes a fake provider; no disk).

### Critical constraint — `assemble()` is synchronous

`assemble` (`assembler.ts:45`) and `MemoryEngine.assemble` (`memory-engine.ts:61`) are sync and
called **per turn** in the hot path (`chat-agent.ts:136`). A `fs.readFile` per turn would force
async or block. **Pre-load the cards at boot** and expose a sync getter:

```ts
interface PersonaProvider {
  assistantLayer(): string;                 // global, loaded once
  persona(characterId: string): string;     // per-character, loaded/cached; safe fallback if missing
}
```
Load eagerly in the composition root (like `memory.reconcile()` at boot, `main.ts:97`); keep a
minimal built-in fallback string if a file is missing so `assemble` never throws and a
mis-configured prompt dir degrades instead of crashing a turn.

### Path resolution (OS-neutral — invariant 8)

- `prompt/` lives at the **repo root** today (not under a package). `prompt/README.md:29` says the
  shipped defaults seed **user-editable copies in the Workspace** at first run; users edit their
  copy and upgrades never clobber it.
- So the provider needs a **configurable prompt directory**, resolved with `path.join` (no
  hardcoded separators, no `%USERPROFILE%`; matches `server-config.ts:6-8,24`). Recommended: a new
  `server-config.ts` field, e.g. `promptDir` from `TAKI_PROMPT_DIR`, defaulting to the repo
  `prompt/` for dev and (later) the Workspace-seeded copy for production.
- File layout the provider reads (per `prompt/README.md:7-14`):
  - `<promptDir>/system/assistant-layer.md` (global)
  - `<promptDir>/characters/<characterId>/persona.md` (per-character)

### Active-character / prompt-dir config today

There is **no** "active character" config: `characterId` arrives per request
(`ChatSendParams.characterId`, `chat-schema.ts:17-20`) and flows into `assemble`. `agent-config.ts`
holds only `maxSteps`. So the provider keys purely on the incoming `characterId` — no new
active-character selector is needed for #16 (that selector is the M5 #24 "soul-swap" panel, D22).

### Testability

- `createAssembler` gains a `persona: PersonaProvider` dep; existing `assembler.test.ts` passes a
  stub returning fixed strings.
- A separate `persona-provider.test.ts` covers: reads both files, assistant-before-persona order,
  missing-persona fallback, missing-dir degradation.

## Caveats / Not Found

- The prompt cards are `.md` with a leading `>` note block (`assistant-layer.md:3-6`,
  `persona.md:3-6`). Decide whether to inject the file **verbatim** (including the `>` editorial
  note) or strip the note block. The note block is meta-guidance to human editors, not persona
  content — stripping the leading blockquote is likely desired but is a small content call for the
  leader. (Verbatim is simpler and harmless; the LLM will read the note as context.)
- Whether to also make the assistant layer per-something is out of scope — it is global by
  design (`prompt/README.md:25`).
