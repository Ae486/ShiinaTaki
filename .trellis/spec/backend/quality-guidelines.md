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

## File headers & folder index.md (mandatory)

Every production source file opens with a 3-6 line module-contract header; tests and generated code are exempt. Every directory under `src/` carries an `index.md` (one line per source file; colocated tests implied). Touch a folder → update its `index.md` in the same change. Headers are placement cards — never what/how narration; body comments stay why-only.

TS:
```ts
/**
 * INPUT:  inbound WS text frames (JSON-RPC 2.0) from local clients
 * OUTPUT: startWsServer({host, port, registry, logger}) -> { port, close }
 * POS:    core/server — the only module owning sockets; zod-validates frames, dispatches via method-registry
 */
```

Rust:
```rust
//! INPUT:  capability requests dispatched by gate/
//! OUTPUT: PNG screenshot bytes via xcap
//! POS:    capabilities_impl — called ONLY from gate/, never directly from commands/
```

`index.md` per directory:
```md
# server/
- ws-server.ts — WS listener; frame validation; reply/notify plumbing
- method-registry.ts — WS method table (invariant-7 wiring point)
- methods/ — one handler file per WS method
```

## Checks before handoff

```
pnpm -r typecheck && pnpm -r lint && pnpm -r test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## The Core runs under Node strip-only type erasure — `tsc`/`vitest` green is NOT enough

`pnpm core:dev`/`start` runs `src/main.ts` directly through Node's strip-only TS mode (it deletes type annotations, it does NOT transpile). `tsc` and `vitest` (esbuild) accept syntax Node strip-only rejects — so a bug there passes every gate and only fails at real Core boot with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The whole class (TS **parameter properties** `constructor(private readonly x: T)`, `enum`, `namespace`, non-`declare` `const enum`) is now blocked at typecheck by **`erasableSyntaxOnly`** in `tsconfig.base.json` — do not remove it. Declare + assign fields explicitly instead of using parameter properties. When a change touches Core startup wiring (`main.ts`, a module it imports at boot, config loaders), a check MUST include a real boot smoke: `TAKI_WS_PORT=<nonstd> TAKI_DATA_DIR=<temp> node --env-file-if-exists=.env.local packages/core/src/main.ts` → confirm `ws server listening`, then kill the tree. A passing test suite does not prove the Core starts.
