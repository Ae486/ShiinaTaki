# Research: Skills loader — SKILL.md convention, lazy-load shape, enable/disable persistence

- **Query**: SKILL.md frontmatter standard; reuse of #6's flat-scalar frontmatter parser; load_skill tool vs auto-injection; where the skills list enters system context; state persistence
- **Scope**: mixed — external (Claude Code docs / agentskills.io spec, via web search 2026-07-10) + internal sources
- **Date**: 2026-07-10

External references:

- Claude Code skills: https://code.claude.com/docs/en/skills · SDK view: https://code.claude.com/docs/en/agent-sdk/skills
- Open standard: https://agentskills.io/specification (progressive disclosure levels, field constraints)
- Anthropic platform overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

## Verdicts (short)

1. SKILL.md = YAML frontmatter (`name` + `description` REQUIRED; everything else optional) + markdown instruction body. Our #6 flat-scalar parser is **sufficient for the required fields** with one documented restriction: single-line `description` (block scalars `description: |` exist in the wild and would fail parse -> skip-with-warning, which is acceptable for v1 where we author our own skills).
2. Lazy-load: **`load_skill(name)` built-in agent tool** (recommended) — matches the Claude Code "Skill meta-tool" convention and our existing tool registry; auto-injection rejected.
3. Skills list -> system context: append a skills section to the instructions string **in `chat-agent.ts` where instructions are composed** — do NOT touch the memory assembler (wrong ownership).
4. Enable/disable: `<dataDir>/skills-state.json` (paired-device-store pattern); skills dirs stay pristine. Malformed SKILL.md -> skip + collect into a stats/invalid list, mirroring #6's reconcile contract.

## 1. The SKILL.md convention

Layout: one directory per skill, `SKILL.md` (case-sensitive filename) at its root, optional `references/` / `scripts/` / `assets/` subdirs loaded on demand by the body's own instructions.

Frontmatter fields (agentskills.io + Claude Code docs):

| Field | Status | Notes |
|---|---|---|
| `name` | required | 1-64 chars, kebab-case `^[a-z][a-z0-9-]*[a-z0-9]$`, must match the directory name |
| `description` | required | THE routing field — loaded at startup for all skills; what + "Use when ..." trigger phrases; typically 200-800 chars |
| `allowed-tools` | optional | CSV string or YAML list; Claude-Code-runtime tool allowlist — we can ignore in v1 (no per-skill tool scoping yet) |
| `version`, `author`, `license`, `tags` | optional | catalog/identity metadata |
| `user-invokable`, `argument-hint`, `model`, `context`, `agent` | optional | Claude Code runtime extensions; not applicable to us |

Body semantics: plain markdown instructions injected into context when the skill activates. Progressive disclosure levels (agentskills.io): (1) metadata `name`+`description` ~100 tokens, always loaded; (2) body < 5000 tokens, loaded on activation; (3) referenced files, loaded on demand. Our v1 = levels 1-2 (level 3 needs a file-read tool — out of scope, note in the doc for the model: references won't resolve).

### Parser reuse (#6)

`parseFrontmatter` at `packages/core/src/memory/frontmatter.ts:20-38` — flat scalars only, strict structure, tolerant values. Fit check against SKILL.md:

- `name: my-skill` -> OK (tolerant literal string, `frontmatter.ts:66`).
- `description: "single-line with: colons"` -> OK (JSON-quoted path). Unquoted single-line with a colon also OK — parser splits on the FIRST colon and keeps the rest as the value (`frontmatter.ts:31-35`).
- KNOWN GAPS (all throw -> our skip-with-warning path): block scalars (`description: |` + indented lines -> "line without a colon"), YAML lists (`tags:\n  - a`), uppercase keys (`KEY_RE` is lowercase-only — real-world fields are lowercase-kebab... note: kebab `allowed-tools` FAILS `KEY_RE = /^[a-z][a-z0-9_]*$/` which allows underscores, not hyphens).

**Decision point for the implementer**: `allowed-tools` and other hyphenated optional keys would make the whole file unparseable under the current `KEY_RE`. Two minimal options: (a) relax `KEY_RE` to allow hyphens (one-char regex change in the shared parser — check memory-file impact: memory keys are all underscore-free lowercase, no conflict), or (b) a skills-local copy of the parser with its own key regex. (a) is the smaller, DRY-consistent change. Multi-line descriptions remain unsupported in v1: document "single-line description" for user-authored skills; foreign skills that use block scalars get skipped with a boot warning naming the file (same UX as memory reconcile `invalid`, `packages/core/src/memory/indexer.ts:13-14,48`).

## 2. Lazy-load mechanism: `load_skill` tool (recommended)

- Matches the host convention: Claude Code exposes skills to the model as a meta-tool carrying `<available_skills>` metadata; the model invokes it to pull the body into context. Confirmed in the Claude Code SDK docs ("Model-invoked ... loaded when triggered").
- Matches our infrastructure exactly: one more `tool()` in the ToolSet handed to `ToolLoopAgent` (`packages/core/src/agents/chat-agent.ts:41` — today `tools: memory.createTools(characterId)`; becomes a merge of memory tools + skills tool + MCP tools). Tool shape mirrors `memory-tools.ts` conventions (execute never throws, `{ok:false, code, message}` envelope):

```ts
load_skill: tool({
  description: "Load the full instructions of an available skill. Available skills:\n" + list,
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }) => loader.load(name), // {ok:true, content} | {ok:false, code:"NOT_FOUND"|..., message}
})
```

- Keyword-triggered auto-injection rejected: duplicates the disclosure-gate idea for a non-memory concern, spends budget on false positives, and diverges from the ecosystem convention users already know. No counter-evidence found.
- **Where the skills LIST enters the system context**: `chat-agent.ts:40` currently sets `instructions: memory.assemble(...)`. The assembler (`packages/core/src/memory/assembler.ts`) is memory-owned (deps: repo + retriever; sections persona/emotion/pinned/retrieved/intention) — skills are not a memory layer, and threading a skills dep through `memory-engine.ts` would violate module boundaries (invariant 7). Cheapest correct insertion: compose in the chat agent — `instructions: [memory.assemble(...), skills.renderList()].join("\n\n")` where `renderList()` returns `""` or `"Skills you can load with load_skill:\n- name: description"` lines for enabled skills. One-line change at the existing seam; alternatively the list can live inside the `load_skill` tool description alone (zero instructions change) — but the instructions section is more reliably attended to and is the convention (skills metadata "loads into the system prompt at startup").

## 3. Enable/disable persistence + malformed-file handling

- **Recommend `<dataDir>/skills-state.json`** cloning `packages/core/src/devices/paired-device-store.ts` (atomic temp+rename, zod `SkillsStateFileSchema`, missing file = default): `{ disabled: string[] }` (default-enabled semantics — discovered skills are enabled unless listed, matching Claude Code SDK default). `dataDir` already flows from `TAKI_DATA_DIR` (`packages/core/src/config/server-config.ts:24`).
- Frontmatter mutation rejected: skills dirs are user-owned/pristine (possibly git-cloned or symlinked); writing into them breaks upstream updates and contradicts the files-as-user-truth stance the memory engine established. State-about-files lives beside core state, like `devices.json`.
- Malformed SKILL.md: skip + warn at scan time, never a crash — reuse the #6 contract shape: the scanner returns `{ skills, invalid: string[] }` and boot logs `invalid` (exactly like `ReconcileStats.invalid`, `indexer.ts:9-15`). Skip reasons: unparseable frontmatter, missing/invalid `name` or `description`, `name` != directory name (spec requirement — treat as invalid, warn).
- Skills root: no existing convention in-repo; suggest `<dataDir>/skills/<name>/SKILL.md` (sibling of the memory root pattern), overridable via config later. Open question for the main agent — not a blocker, just pick one and document.

## Caveats / Not Found

- No machine-readable JSON schema for SKILL.md frontmatter was located beyond agentskills.io's prose constraints; field table above merges the open standard + Claude Code docs (they agree on the required pair).
- `allowed-tools` semantics (per-skill tool scoping) intentionally not implemented in v1 — our loader only ships metadata + body; noted so the field is parsed-and-ignored, not treated as invalid.
- Did not verify how OpenClaw (pi-mono) loads skills — the Claude Code convention is the ecosystem anchor and the task's stated bias; no conflicting convention found in the searches.
