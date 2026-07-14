# Backend Development Guidelines

> Backend = the TS Agent Core (`packages/core`, Node 24) and the Rust Shell (`apps/desktop/src-tauri`, Tauri 2).

## Pre-Development Checklist

Before writing backend code:

1. Read `CLAUDE.md` (root) — architecture invariants, naming, size caps.
2. Read `CONTEXT.md` — use domain terms exactly (Capability, Permission Gate, Node, Workspace...).
3. Protocol change? Start in `packages/shared` (zod schema) — never declare message shapes locally.
4. New system action? It is a Capability: Rust implementation + permission entry + audit; TS side only gets a client stub.
5. Verify external library APIs against current docs (AI SDK 7 moves fast) — never from memory.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Where files go in `packages/core` and `src-tauri` |
| [Database Guidelines](./database-guidelines.md) | SQLite single-writer, wrapper, migrations |
| [Error Handling](./error-handling.md) | Structured tool errors, Rust error types, IPC error shape |
| [Quality Guidelines](./quality-guidelines.md) | Size caps, lint, tests, forbidden patterns |
| [Logging Guidelines](./logging-guidelines.md) | pino / tracing, audit log |
| [E2E Harness](./e2e-harness.md) | Headless `withStack` fixture; L1 (deterministic) + L2 (real-agent) dual-track per capability |
| [Permission Authorization](./permission-authorization.md) | Authorize on `(capability, argClass)` for arg-risk capabilities, name for fixed-risk; no cross-class leakage |
| [Server-Push & Connection Auth](./server-push-and-connection-auth.md) | Fan-out channel pattern (timeline/avatar, no Rust mirror for operator-only); connection auth vs capability authz; loopback auto-trust (P3) fail-closed rules |
| [Agent Runtime](./agent-runtime.md) | Persist full turn (tool-call/result) or hallucinate; base-prompt truthfulness floor; test the deterministic root cause |

## Quality Check (run before handing off)

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` green
- No architecture invariant violated (esp. invariant 1: no OS access from TS)

**Language**: All documentation in **English**.
