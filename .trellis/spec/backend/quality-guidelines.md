# Backend Quality Guidelines

## Size and responsibility guard

| Scope | Cap |
| --- | --- |
| TS file | 300-line baseline; 360-line review threshold (`max-lines`, skipBlankLines) |
| TS function | 50 lines; max 3 params |
| Rust function | 100 lines (clippy `too_many_lines`) |
| Rust file | 500 lines soft cap — split modules before crossing |

Exemptions: generated code, migrations, test files.

The 300-line figure is a design signal, not a mechanical formatting target. A cohesive file may use the roughly 20%
tolerance up to about 360 lines when that keeps one responsibility readable. Do not compress statements, remove useful
whitespace, or create artificial helper files merely to pass the check. Split a file when it combines distinct
responsibilities or materially exceeds the relaxed threshold; function and parameter limits remain strict.

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
pnpm -r typecheck && pnpm lint && pnpm -r test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Scenario: Hindsight OpenAPI Client Regeneration

### 1. Scope / Trigger

- Trigger: a Taki-owned Hindsight compatibility route, schema, error envelope, or OpenAPI artifact changes.
- Regeneration is a cross-repository contract change across the Hindsight HTTP API, canonical OpenAPI, Rust/TypeScript/Python/Go clients, maintained wrappers, and Taki compatibility tests.

### 2. Signatures

- Canonical generator entry: `scripts/generate-clients.sh` in the pinned Hindsight checkout.
- Python and Go generator image: `openapitools/openapi-generator-cli:v7.10.0`.
- Go maintained module contract: checked-in `hindsight-clients/go/go.mod` and `go.sum` remain authoritative across generation.
- Taki-only schema names must be source-qualified, for example `TakiDispositionTraits`; do not rely on post-generation aliases to disambiguate native schemas.

### 3. Contracts

- Generated clients come only from the canonical OpenAPI artifact.
- The generation script preserves maintained wrappers, tests, README/config files, and Go module manifests before replacing generator-owned files.
- Generators normalize deterministic whitespace in generator-owned artifacts at generation time, including trailing spaces and excess blank lines at EOF, so clean reruns satisfy repository whitespace gates without hand-editing generated output.
- Native Hindsight public model names remain stable. Taki-specific schemas use explicit `Taki*` names at the OpenAPI source.
- Generated files may not advertise a compatibility version that has not passed the complete HTTP, OpenAPI, client, and migration gates.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Docker/generator unavailable | Keep the compatibility patch rejected; do not accept stale clients. |
| Duplicate schema name changes a public client type | Rename/isolate the Taki schema at the source and regenerate. |
| Generation changes `go.mod`/`go.sum` | Restore the checked-in manifests, fail the gate, and fix the generator script before acceptance. |
| Generated source differs after a clean rerun | Treat as untracked drift unless it is an explicit scripted generator repair. |
| Untracked or already staged generated artifacts are absent from ordinary `git diff --check` | Review and stage the intended generated artifacts, then run `git diff --cached --check`; run both commands because they inspect different diffs. |
| Live Hindsight service unavailable | Run deterministic compile/offline gates and record the missing service-backed tests as residual risk. |

### 5. Good/Base/Bad Cases

- Good: change the source schema to `TakiDispositionTraits`, regenerate every maintained client, and prove repeated generation is stable.
- Base: no OpenAPI change; the generator produces no client diff and all locked builds still pass.
- Bad: add a Python/Go alias inside generator-owned output, or accept a client while its generator could not run.

### 6. Tests Required

- OpenAPI generation plus backward-compatibility comparison against `HEAD`.
- Focused HTTP authentication, validation-envelope, and compatibility-manifest tests.
- Rust locked release build; locked TypeScript generation/build; Python import/build/offline tests.
- Go `go build ./...`, `go test ./... -run '^$'`, generated test package, and source-compatibility regressions.
- Migration/DAG/backup/replication/snapshot gates for contracts represented in the generated API.
- `bash -n scripts/generate-clients.sh`, clean-generation tree comparison, and module-manifest comparison.
- Run `git diff --check` for unstaged tracked working-tree changes; it does not inspect untracked or already staged changes. After reviewing and staging the intended generated artifacts, run `git diff --cached --check`. Of these two commands, only the cached check can inspect a new file after it is staged.

### 7. Wrong vs Correct

#### Wrong

```bash
# Generator replaces the maintained module files; tidy silently upgrades tests.
rm -f go.mod go.sum
openapi-generator-cli generate ...
go mod tidy
```

#### Correct

```bash
# Preserve maintained files, replace generator-owned output, then restore pins.
cp go.mod "$TEMP_DIR/go.mod"
cp go.sum "$TEMP_DIR/go.sum"
openapi-generator-cli generate ...
mv "$TEMP_DIR/go.mod" go.mod
mv "$TEMP_DIR/go.sum" go.sum
go mod tidy
```

## Scenario: Windows Docker Shell Entry Points

When building the local Hindsight checkout on Windows, every shell script copied
into a Linux container must be protected by repository attributes, not only by a
one-time working-tree conversion:

```gitattributes
docker/standalone/*.sh text eol=lf
```

The build gate must verify both `git check-attr eol -- docker/standalone/start-all.sh`
and the absence of CRLF byte pairs, then start the image and assert `/health`.
Without the attribute, a later Git operation can restore CRLF and make the
container fail before the API process starts even though the original smoke
passed.

## The Core runs under Node strip-only type erasure — `tsc`/`vitest` green is NOT enough

`pnpm core:dev`/`start` runs `src/main.ts` directly through Node's strip-only TS mode (it deletes type annotations, it does NOT transpile). `tsc` and `vitest` (esbuild) accept syntax Node strip-only rejects — so a bug there passes every gate and only fails at real Core boot with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The whole class (TS **parameter properties** `constructor(private readonly x: T)`, `enum`, `namespace`, non-`declare` `const enum`) is now blocked at typecheck by **`erasableSyntaxOnly`** in `tsconfig.base.json` — do not remove it. Declare + assign fields explicitly instead of using parameter properties. When a change touches Core startup wiring (`main.ts`, a module it imports at boot, config loaders), a check MUST include a real boot smoke: `TAKI_WS_PORT=<nonstd> TAKI_DATA_DIR=<temp> node --env-file-if-exists=.env.local packages/core/src/main.ts` → confirm `ws server listening`, then kill the tree. A passing test suite does not prove the Core starts.

## Scenario: Canonical Memory Provider Projection and Capability Contracts

- Rebuilds of SQLite FTS5 virtual tables use explicit `INSERT` column lists. Never rely on implicit virtual-table column order, which can silently misplace projection data after a schema or column change.
- Structured Memory Block rendering preserves whole-document semantics while enforcing its budget. Truncate with a Unicode-safe, code-point-aware binary search, and include the truncation marker itself in the budget calculation; never split a surrogate pair or budget only the source text.
- Provider coordinator capability snapshots distinguish stable identity/operation fields from dynamic vector health. Stable fields must match exactly before and after a call. Recall may accept controlled vector-health degradation only when the result reports the same post-call vector state; any non-recall drift, or a mismatched reported post-call state, is an authority mismatch.
