# Research: Anti-Monolith / Anti-God-File Conventions (TypeScript + Rust)

- **Query**: Concrete engineering conventions (with numbers) that prevent god files and spaghetti growth in TS monorepos and Rust projects
- **Scope**: external
- **Date**: 2026-07-07

## Findings

### 1. File/function size limits — TypeScript (enforceable via ESLint)

| Rule | Default | Common AI-era setting | Source |
|---|---|---|---|
| `max-lines` (per file) | **300** | 250-300 (`skipBlankLines: true`) | https://eslint.org/docs/latest/rules/max-lines |
| `max-lines-per-function` | **50** | 50 | https://eslint.org/docs/latest/rules/max-lines-per-function |
| `max-params` | 3 (rule default) | 2-3 | ESLint docs / Medium article below |
| SonarJS `cognitive-complexity` | 15 | 15 | eslint-plugin-sonarjs |

- ESLint docs: "Recommendations usually range from 100 to 500 lines" per file; 300 was chosen as the "sweet spot" default (https://github.com/eslint/eslint/issues/6321).
- **AI-specific guardrail plugins exist because "AI coding assistants tend to keep appending code to the same file rather than creating new modules. This quickly produces 500+ line files"**:
  - `eslint-plugin-ai-guardrails` `max-file-lines`: default **300**, skipBlankLines true (https://github.com/isaacnewton123/eslint-plugin-ai-guardrails/blob/main/docs/rules/max-file-lines.md)
  - `eslint-plugin-llm-core` `max-file-length`: default **250**, test files excluded by default (https://github.com/pertrai1/eslint-plugin-llm-core/blob/main/docs/rules/max-file-length.md)
  - "ESLint as AI Guardrails" (Medium, 2026-01): five core rules for AI-generated code — no comments-as-crutch, max 2 params, **50 lines/function, 250 lines/file**, no magic values (https://medium.com/@albro/eslint-as-ai-guardrails-the-rules-that-make-ai-code-readable-8899c71d3446)
- Standard exemptions: generated files (codegen, migrations), test files with many inline cases.

### 2. File/function size limits — Rust (enforceable via clippy)

- `clippy::too_many_lines`: **100 lines per function** default threshold (blank lines and comment-only lines excluded). Restriction lint (opt-in), configurable via `clippy.toml` `too-many-lines-threshold`. Source: clippy conf source — `too_many_lines_threshold: u64 = 100` (https://github.com/rust-lang/rust-clippy/blob/master/clippy_config/src/conf.rs)
- `clippy::too_many_arguments`: **7 arguments** default threshold (same source).
- **No file-level line lint exists in clippy today.** A `too_many_lines_in_file` lint was proposed 2026-03 with suggested default **1000 lines** (`clippy.toml` `too-many-lines-in-file-threshold`), still open: https://github.com/rust-lang/rust-clippy/issues/16674. Rationale given: "Large files are often a sign of poor separation of concerns and can hurt navigability and reviewability." Practical takeaway: enforce a file cap by convention/CI script; 500-1000 lines is the community's rough boundary for Rust modules.
- HumanLayer reports successfully running Claude Code on 300k-LOC Rust codebases using research/plan documents rather than giant files (https://www.humanlayer.dev/blog/advanced-context-engineering).

### 3. Module-splitting heuristics (behavioral rules, from Vercel's own agent repo)

Source: https://github.com/vercel-labs/open-agents/blob/main/AGENTS.md — concrete, agent-targeted rules worth copying:

- "Do **not** append new functionality to the bottom of an existing file by default."
- "Before adding code, decide whether the behavior is a separate concern that should live in its own file."
- "Prefer creating a new colocated file for distinct concerns (components, hooks, utilities, schemas, data-access helpers, etc.)."
- "If a file is already large or handling multiple responsibilities, extract the new logic (and related helpers/types) into focused modules."
- "For large page/view/client components, default to adding new feature behavior in colocated hooks and colocated child components instead of growing the main file."
- "If a change introduces a distinct cluster of state, effects, handlers, API calls, or derived UI labels for one feature, treat that as a strong signal to extract it."
- "Keep each file focused on one primary responsibility; avoid mixing unrelated UI, business logic, and data-access code in the same file."

Rust-specific splitting (users.rust-lang.org thread + Rust Book ch07-05):
- Move Tauri commands / handlers out of `main.rs`/`lib.rs` into modules as soon as there are more than a handful; commands act as thin controllers, business logic in service modules (e.g. `services/project_service.rs`). Private module items make internal APIs invisible to the rest of the crate — modules are the encapsulation boundary. (https://users.rust-lang.org/t/putting-functions-in-a-separate-mod-project-structure-best-practice/115300)

### 4. Barrel files (`index.ts`) in 2025-2026: avoid internally, allow only at package boundaries

- **Atlassian (2025-06)**: removing barrel files from Jira frontend gave **75% reduction in build minutes**, ~70% improvement in CI test selection, faster TS/Jest. Cost acknowledged: lost "public API" encapsulation, more fragile file moves. They stopped new barrels, then codemodded imports via a fixable ESLint rule. (https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files)
- **TkDodo "Please Stop Using Barrel Files"** (https://tkdodo.eu/blog/please-stop-using-barrel-files) — canonical community reference.
- Mechanism of harm: importing one symbol through a barrel forces TS/Jest/bundler to resolve, parse, and side-effect-analyze every re-exported module; `export *` is worst (compiler must parse every file to enumerate members); barrels are the #1 source of accidental circular imports because they hide dependency direction. (https://loke.dev/blog/the-barrel-file-trap-typescript-performance, https://pvizgenerator.com/blog/typescript-module-boundaries)
- Measured (Next.js 15/React 19 experiment, 100 components, 2025-12): any barrel added 47 extra client modules (~14.4% larger); `export *` added 139 extra server modules. (https://deepak-kharah.medium.com/should-you-re-export-from-index-ts-thats-the-question-46337ecf53ec)
- **2026 consensus rule** (multiple sources agree):
  - Barrels ONLY at true public boundaries: published packages / monorepo package entry points (`package.json` `exports`), with **named re-exports, never `export *`**, and `"sideEffects": false` in package.json.
  - Direct (deep) imports for ALL internal app code: feature internals, `utils/`, components, models, test helpers.
  - Rule of thumb: "if your index.ts has more than 20 re-exports, it's a performance bottleneck" (Next.js discussion #92926).
  - Enforce with ESLint `no-restricted-imports` / custom rule; detect cycles with `eslint-plugin-import` `no-cycle`.

### 5. One-export-per-file vs feature folders

- Neither extreme is the standard. The converged pattern: **feature folders** (colocate component + hooks + schema + tests per feature) with **small single-responsibility files** inside, direct imports between them. Avoid giant type-bucket files (`types.ts` holding everything) and giant `utils.ts` — the llm-core/ai-guardrails docs explicitly name "handlers, utilities, types, constants all mixed" as the god-file signature, and prescribe splitting by responsibility: separate types, separate constants, extract related function groups.
- Architectural boundaries > import style: use a controlled "API facade" (intentional named exports) per package, keep internals private, enforce direction with lint rules (https://pvizgenerator.com/blog/typescript-module-boundaries).

## Caveats / Not Found

- All line numbers are conventions, not laws; every source notes exemptions for generated code, migrations, tables, and test files.
- Rust has no official max-file-length; 1000-line default in the open clippy proposal is the only "number" from the Rust toolchain side. Function-level 100 lines (clippy) is the enforceable anchor.
