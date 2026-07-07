# Backend Quality Guidelines

## Size caps (hard rules; will be enforced by ESLint/clippy config)

| Scope | Cap |
| --- | --- |
| TS file | 300 lines (`max-lines`, skipBlankLines) |
| TS function | 50 lines; max 3 params |
| Rust function | 100 lines (clippy `too_many_lines`) |
| Rust file | 500 lines soft cap — split modules before crossing |

Exemptions: generated code, migrations, test files.

## Anti-sprawl behavior

- Do not append new functionality to an existing file by default — a distinct concern gets its own file (see root CLAUDE.md).
- No catch-all `utils.ts` / `types.ts` buckets; split by responsibility.
- No barrel files inside the package; `index.ts` only as public entry with named re-exports.

## Forbidden patterns

- `child_process` / `fs` outside Workspace / any OS access in `packages/core` (architecture invariant 1 — this is the one unforgivable violation).
- Hand-declared message shapes outside `@taki/shared`.
- `any` (use `unknown` + narrowing); non-null `!` outside tests; `@ts-ignore` (use `@ts-expect-error` with a reason).
- Secrets in config files, code, or logs.
- Empty catch blocks; `unwrap()` in production Rust paths.

## Testing

- **vitest** for TS: colocated `*.test.ts`. Priority order: `@taki/shared` schema round-trips > Permission Gate policy decisions > exec allowlist parser > repos (in-memory SQLite) > tool delegation.
- **cargo test** for Rust: gate policy table-driven tests are mandatory for every new Capability; blocklist patterns get regression tests.
- The exec allowlist parser and the Permission Gate are security boundaries: no change ships without tests covering the new branch.

## Checks before handoff

```
pnpm -r typecheck && pnpm -r lint && pnpm -r test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
```
