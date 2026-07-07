# Research: Naming Conventions (TypeScript / React 19 / Rust / Tauri / Monorepo)

- **Query**: De-facto standard naming conventions in 2025-2026 for TS files, React components, hooks, zod schemas, Rust modules, Tauri commands, monorepo packages
- **Scope**: external
- **Date**: 2026-07-07

## Findings

### 1. TypeScript identifiers (uncontested standard)

Source: Google TS Style Guide (https://ts.dev/style/), typescript-eslint `naming-convention`:

| Thing | Convention |
|---|---|
| class / interface / type / enum / type parameter | `UpperCamelCase` (PascalCase) |
| variable / function / method / property / module alias | `lowerCamelCase` |
| global constants, enum values | `CONSTANT_CASE` |
| interfaces | **no `I` prefix** (modern consensus; Google/typescript-eslint discourage it) |
| React components (identifier) | `UpperCamelCase` — mandatory: JSX treats lowercase tags as HTML elements |
| hooks (identifier) | `useXxx` camelCase — required by React lint rules |

### 2. TypeScript FILE naming — kebab-case vs camelCase/PascalCase (contested, two camps)

There is **no single ecosystem standard in 2026**; there are two coherent camps:

- **Camp A — kebab-case everywhere** (rising, favored by newer tooling): Next.js, shadcn/ui, Tailwind, Chakra UI codebases use kebab-case files (`user-profile.tsx` exporting `UserProfile`). Rationale: Windows/macOS filesystems are case-insensitive while Linux is case-sensitive → git rename bugs and CI-only "module not found" failures; no per-file-type decision needed; URL-friendly. Sources: https://bressain.com/blog/kebab-casing/, https://dev.to/vikasparmar/nextjs-component-naming-conventions-best-practices-for-file-and-component-names-39o2, CRA issue https://github.com/facebook/create-react-app/issues/8473
- **Camp B — Airbnb style, file matches primary export**: `PascalCase.tsx` for components (`Sidebar.tsx`), `camelCase.ts` for hooks/utils (`useShortcuts.ts`, `markdownConverter.ts`), `PascalCase.ts` for class-as-default-export (`KnowledgeService.ts`). Still very common in React/Electron apps. Detailed real-world monorepo example: Cherry Studio naming doc https://github.com/CherryHQ/cherry-studio/blob/9ea7e850/docs/references/naming-conventions.md
- Practical tiebreaker cited by multiple 2025 writeups: **align with your UI library** — shadcn/ui projects go kebab-case; MUI projects go PascalCase (https://zenn.dev/suba/articles/3fe4ba681233da?locale=en).
- Points of agreement regardless of camp: hook files carry the `use` prefix; test files `*.test.ts(x)`; type declarations `*.d.ts`; the exported identifier casing never changes (component `PascalCase`, hook `useCamelCase`).
- Consistency is enforceable with `eslint-plugin-unicorn` `filename-case` (supports kebabCase/camelCase/pascalCase options).

### 3. Zod schema naming

Dominant pattern (multiple codebases and guides):

```ts
export const UserSchema = z.object({ ... });      // PascalCase + `Schema` suffix
export type User = z.infer<typeof UserSchema>;    // type = same name WITHOUT suffix
```

- Sources: https://github.com/carrot-foundation/schemas/blob/main/ZOD_SCHEMA_PATTERNS.md (`[Entity]Schema` / `[Entity]`), https://github.com/nxtvoid/zxkit/blob/main/.agents/skills/zod/references/type-use-z-infer.md, zod discussion https://github.com/colinhacks/zod/discussions/929
- Accepted variant: `userSchema` (camelCase const) + `User` type. Minority variant (some Zod v4 rule sets): identical name for schema and type with no suffix — exploits TS's separate type/value namespaces, but less common.
- Universal rule: derive types with `z.infer` from the schema (schema is the single source of truth); never hand-write a parallel interface.
- Input/variant schemas: `UserInputSchema` → `UserInput`.

### 4. React 19 components

- Component identifier: PascalCase (JSX requirement — unchanged in React 19; no official file-naming guide from React team exists, confirmed by SO/community: https://stackoverflow.com/questions/55221433).
- One component per file as the primary export; colocate subcomponents/hooks in sibling files inside a feature folder rather than stacking components in one file.

### 5. Rust (RFC 430 conventions — settled, compiler/clippy-enforced)

Sources: Rust API Guidelines (https://rust-lang.github.io/api-guidelines/naming.html), Rust Book ch. 7, Rust Reference (modules):

| Thing | Convention |
|---|---|
| crate name | kebab-case in Cargo.toml (`taki-shell`), referenced as snake_case in code (`taki_shell`) |
| module / file name | `snake_case` (`window_manager.rs`) |
| function / method / variable | `snake_case` |
| type / trait / enum variant | `UpperCamelCase` |
| const / static | `SCREAMING_SNAKE_CASE` |
| module file layout | **prefer `foo.rs` + `foo/` directory over `foo/mod.rs`** — the Rust Reference explicitly encourages the new (1.30+) style: "It is encouraged to use the new naming convention as it is more consistent, and avoids having many files named mod.rs" (https://doc.rust-lang.org/reference/items/modules.html) |

### 6. Tauri command naming

Source: https://v2.tauri.app/develop/calling-rust/

- Command functions are `snake_case` Rust functions annotated `#[tauri::command]`; the frontend invokes them **by the same snake_case name**: `invoke("my_custom_command")`. Module path prefixes are ignored (`commands::my_custom_command` is still invoked as `"my_custom_command"`).
- Command **arguments** are camelCase on the JS side by default (Tauri converts to the Rust snake_case parameters); `#[tauri::command(rename_all = "snake_case")]` opts into snake_case JS keys. (Documented on the same calling-rust page under argument passing — verify exact attribute syntax against the live page when writing rules.)
- Plugin-namespaced commands use `plugin:name|command_name` form (e.g. `plugin:fs|read_text_file`).

### 7. Monorepo package naming

- npm scope rule: `@scope/name`, all lowercase, URL-safe, no spaces (npm registry requirement). De-facto: **kebab-case name**, e.g. `@taki/agent-core`.
- Directory name matches the unscoped package name in kebab-case: `packages/agent-core` → `@taki/agent-core` (pattern used by Cherry Studio, vercel/ai, virtually all pnpm-workspace repos).
- pnpm workspace: internal cross-package deps via `workspace:*` protocol; package folder under `packages/` (libs) vs `apps/` (deployables) is the common split.

## Caveats / Not Found

- TS file casing genuinely has no single winner; a project rule file must simply pick one camp and enforce it with `unicorn/filename-case`. Given this project uses shadcn-adjacent Tailwind 4 + Vite and a cross-platform Windows/Linux toolchain, kebab-case has the stronger 2026 momentum, but PascalCase-component style is equally defensible.
- The Tauri `rename_all` attribute detail comes from the official calling-rust page structure but the exact snippet was not in the retrieved highlights — double-check syntax at https://v2.tauri.app/develop/calling-rust/ before encoding it as a hard rule.
