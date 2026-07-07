# Research: CLAUDE.md Authoring Best Practices (2025-2026)

- **Query**: Current best practices for writing a project-level CLAUDE.md (AI coding agent rules file)
- **Scope**: external
- **Date**: 2026-07-07

## Findings

### 1. Official Anthropic guidance

Sources:
- https://code.claude.com/docs/en/best-practices.md (Best practices for Claude Code)
- https://code.claude.com/docs/en/memory.md (How Claude remembers your project)

Hard numbers and rules from the official docs:

- **Target under 200 lines per CLAUDE.md file.** "Longer files consume more context and reduce adherence." (memory docs)
- **The deletion test**: "For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" (best-practices doc)
- **CLAUDE.md is context, not configuration.** It is delivered as a user message after the system prompt, not inside the system prompt. There is no guarantee of strict compliance. Anything that MUST happen (e.g. run formatter after edit, block an action) should be a **hook** (PreToolUse/Stop), not a CLAUDE.md line.
- **Include / Exclude table** (official):

| Include | Exclude |
|---|---|
| Bash commands Claude can't guess | Anything Claude can figure out by reading code |
| Code style rules that differ from defaults | Standard language conventions Claude already knows |
| Testing instructions and preferred test runners | Detailed API documentation (link instead) |
| Repository etiquette (branch naming, PR conventions) | Information easily found elsewhere |

- **Specificity: write instructions concrete enough to verify.** Official examples:
  - "Use 2-space indentation" not "Format code properly"
  - "Run `npm test` before committing" not "Test your changes"
  - "API handlers live in `src/api/handlers/`" not "Keep files organized"
- **Consistency**: if two rules contradict, Claude picks one arbitrarily. Review periodically to remove outdated/conflicting rules.
- **Scoping mechanisms** (Claude Code 2.1.x):
  - `.claude/rules/*.md` — one topic per file, discovered recursively. Files with `paths:` YAML frontmatter (globs) only load when Claude works on matching files. Files without `paths:` load every session (same priority as CLAUDE.md).
  - Nested `CLAUDE.md` in subdirectories — loaded lazily only when Claude works in that subtree (good for monorepo packages).
  - Skills — for multi-step procedures / domain knowledge that only matters sometimes; loaded on demand.
  - `@path/to/file` imports — organization only, NOT token savings; imported files load at launch. Max 5 hops of recursion (deeper imports silently dropped).
  - `claudeMdExcludes` setting — skip irrelevant sibling-team CLAUDE.md files in monorepos.

### 2. HumanLayer ("Writing a good CLAUDE.md", 2025-11)

Source: https://www.hlyr.dev/blog/writing-a-good-claude-md (also https://www.humanlayer.dev/blog/advanced-context-engineering)

- Frame CLAUDE.md as **onboarding**: WHAT (stack, project map — "especially important in monorepos: tell Claude what the apps are, what the shared packages are"), WHY (purpose of each part), HOW (how to build/test/verify changes).
- **Instruction budget**: Claude Code's own system prompt already contains ~50 instructions — roughly a third of what a model can reliably follow. So CLAUDE.md should contain **as few instructions as possible**, only ones universally applicable.
- **Length**: community consensus **< 300 lines; shorter is better. HumanLayer's own root CLAUDE.md is < 60 lines.**
- **Progressive disclosure**: keep task-specific instructions in separate self-descriptively-named markdown files; CLAUDE.md lists them with one-line descriptions and tells Claude to read the relevant ones. "Prefer pointers to copies" — use `file:line` references, not pasted code snippets (snippets rot).
- **"Claude is not an expensive linter"**: never duplicate linter/formatter rules in CLAUDE.md. Use deterministic tools (they recommend Biome) + a Stop hook that runs formatter/linter and feeds errors back to Claude. Style rules in prose waste instruction budget and degrade adherence.
- **Don't auto-generate / don't blindly use `/init`**: CLAUDE.md is the highest-leverage file in the harness; hand-craft every line. (Note: official docs do recommend `/init` as a *starter* to refine — the positions differ in emphasis, not substance.)

### 3. Builder.io ("How to Write a Good CLAUDE.md File", 2026-01)

Source: https://www.builder.io/blog/claude-md-guide

Recommended sections:
1. **Project context** — a one-liner orienting Claude ("Next.js e-commerce app with Stripe integration").
2. **Code style** — only preferences that differ from defaults; specific, not "format properly".
3. **Commands** — exact test/build/lint/deploy commands; Claude uses these verbatim.
4. **Gotchas** — project-specific traps: the module with weird retry logic, the file never to modify directly.

Practices:
- **Under 300 lines, or make every line earn its place.**
- Maintain incrementally: when correcting Claude, say "add to CLAUDE.md: always use the logger instead of console.log" — capture corrections at the moment they happen; also fold in conventions surfaced by PR review.
- Ask Claude to review/optimize the CLAUDE.md every few weeks; delete obsolete, consolidate redundant, clarify ambiguous.
- Emphasis ("IMPORTANT:", "YOU MUST") raises odds of compliance but is not a lock; "if everything is marked IMPORTANT, nothing is."

### 4. Making rules enforceable/checkable (cross-source synthesis)

Source: https://startdebugging.net/2026/04/how-to-write-a-claude-md-that-actually-changes-model-behaviour/ + official memory docs

- A CLAUDE.md that "doesn't work" means one of three things: (1) too long — rules drowned; (2) too vague to verify; (3) the instruction needed to be a hook because CLAUDE.md is advisory by design.
- **Escalation ladder**: prose rule → lint rule (deterministic, free) → path-scoped rule file → hook (guaranteed execution). "If you correct the same mistake twice, don't bury it deeper in CLAUDE.md — write a hook or lint rule."
- Every rule should ideally map to a checkable artifact: ESLint/clippy config, CI check, or hook. CLAUDE.md then only states what tools cannot express (architecture intent, where things live, workflow order).

## Caveats / Not Found

- Anthropic has no single official number; 200 lines (official memory docs) vs <300 lines (community consensus) — 200 is the safer target.
- HumanLayer discourages `/init` auto-generation while official docs endorse it as a starting point; both agree the final file must be hand-curated.
